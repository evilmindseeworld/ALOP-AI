# Council tool calling — design

Approved 2026-07-31. Built alongside the frontend overhaul; the two share no
files, so their commits interleave without touching each other.

## The problem with what exists

The council already has search. `server.js` carries Brave, Tavily, Google CSE,
a Jina reader that fetches any URL, and a Wikipedia extractor — five real tools,
none of which a model can ask for.

A **router** decides instead. `classifyRequest` picks a category, `getSearchQuery`
asks one fast model whether to search, and the results are pasted into the
council's prompt before any member runs. So the flow is fixed at one hop:

```
route → maybe search → all members answer once → synthesise
```

A member that reads the search results and realises it needs one more query
cannot issue it. A member that would answer better after reading the actual page
behind result #3 cannot open it. The tools are there; the initiative is not.

## Shape: propose → dedupe → broadcast

Each round, every member may emit tool requests instead of a final answer. The
server unions those requests, **executes each unique call exactly once**, and
broadcasts every result to every member. Then the next round runs.

```
round 1   glm    → web_search("OLED burn-in 2026")
          kimi   → web_search("OLED burn-in 2026")   ┐ identical
          qwen   → web_search("QD-OLED vs WOLED")    │
          gemma  → read_url("rtings.com/monitor")    ┘
             ↓  dedupe: 3 unique calls, not 4
             ↓  execute once each, in parallel
             ↓  broadcast all 3 results to all 4 members
round 2   every member sees every result
             ↓
          synthesise
```

Cost is **O(unique calls)**, not O(members × calls), while every model still
directs its own research. With seven pro members asking overlapping questions —
which is exactly what a council does — the dedupe is most of the saving.

Rejected: one scout model running the loop for everyone (that is what the router
already is, only slower), and per-member independent loops (7 concurrent chains
on pro, the most expensive option by a wide margin).

## The four tools

| Tool | Backed by | New work |
|---|---|---|
| `web_search(query)` | Brave → Tavily → Google CSE, existing fallback chain | wrapper + schema only |
| `read_url(url)` | Jina reader, existing | wrapper + schema, SSRF guard |
| `read_file(id)` | new content store | upload path for non-images |
| `run_code(source)` | hosted sandbox | new, gated on a key |

### `read_file` never takes a path

A model passes an **opaque id**, never a filename and never a path. The server
resolves it against a store scoped to `(user, chat)` and refuses anything the
requesting user does not own.

This is not a stylistic preference. The repo is public, the process holds live
Stripe and Supabase credentials, and a model-issued path is attacker-controlled
the moment anyone can get text into a prompt. There is no allowlist of
directories that makes `read_file("../../.env")` safe to even attempt, so the
filesystem is not addressable at all.

Today only images can be attached. Non-image uploads — PDF, txt, md, csv — need
an accept path and text extraction before this tool has anything to read.

### `run_code` runs in a hosted sandbox or not at all

An ephemeral microVM (Vercel Sandbox or E2B), no network, no environment, fresh
per run, hard timeout. The backend sends source over HTTPS and gets stdout back.

`node:worker_threads` was considered and rejected for this: it shares the
process, so the isolation boundary is V8's rather than the operating system's,
and the thing on the other side of that boundary is a live Stripe secret key.

**The sandbox needs a vendor key that does not exist yet.** The tool is therefore
built behind an interface and **registered only when its key is present** — with
no key the council is told the tool does not exist, rather than being offered a
tool that always errors. Search, `read_url` and `read_file` ship regardless.

### SSRF guard on `read_url`

`read_url` takes a model-supplied URL, which means the model can point the
server at anything the server can reach. Blocked before the fetch: non-http(s)
schemes, and any host resolving to a loopback, link-local, or private range —
`169.254.169.254` (cloud metadata) most of all. Resolution happens once and the
resolved address is what gets connected to, so a DNS entry cannot answer
"public" to the check and "private" to the fetch.

## Ceilings

```
max_rounds          3
max_unique_calls    8   per turn
per-call timeout    8s
total tool budget   25s
```

Three rounds covers search → read → refine, which is nearly every real question.
On hitting a ceiling the loop stops, synthesises what it has, and **says so** —
a truncated answer presented as a complete one is worse than a slow one.

## Protocol: native tools if the gateway has them, text if not

`callModel` speaks to an Ollama-shaped gateway. Ollama's `/api/chat` supports a
`tools` array, but support is per-model and these are custom model names on a
hosted gateway, so it cannot be assumed.

Both paths get built behind one `parseToolRequests(response)`:

1. **Native.** Send `tools`, read `message.tool_calls`.
2. **Text.** Instruct the model to emit a fenced ```tool_call JSON block, parse
   it out of the content.

A capability probe runs once per model at startup and caches the answer. Text
mode is the floor, so a model with no tool template still participates rather
than dropping out of the council.

## Streaming

The client's SSE contract does not change shape, but the loop has real progress
to report and hiding it behind a spinner for 25 seconds would be worse than what
exists now. New event types on the same stream:

```
{ type: "tool_start",  round, name, summary }
{ type: "tool_result", round, name, ok, summary }
{ type: "chunk",       text }        ← unchanged, synthesis
```

The frontend renders these as a collapsible activity trail above the answer.
That work belongs to the frontend overhaul and lands after §4.

## Testing

Backend tests are `node:test` with zero dependencies, in `backend/lib/`, because
`server.js` calls `process.exit(1)` at import time and is untestable by
construction. Every piece below therefore lands in `lib/` as a pure module:

- `lib/tool-protocol.js` — parse native and text tool calls, malformed JSON,
  multiple blocks, a model that emits both prose and a call.
- `lib/tool-dedupe.js` — canonical key for a call, so `search("a")` from four
  members is one execution; whitespace and key order must not defeat it.
- `lib/tool-registry.js` — schema validation, unknown tool, missing argument,
  and the absent-key case where `run_code` must not be offered.
- `lib/url-guard.js` — the SSRF table: loopback, link-local, private ranges,
  metadata IP, non-http schemes, and a DNS answer that changes between check
  and fetch.
- `lib/agent-loop.js` — ceilings: stops at 3 rounds, stops at 8 calls, reports
  truncation, and terminates when every member returns a final answer.

The loop is tested against a fake model function, not the network.

## Order

1. `lib/url-guard.js` + tests — the security boundary lands first, alone.
2. `lib/tool-protocol.js` + `lib/tool-dedupe.js` + tests.
3. `lib/tool-registry.js` with search, `read_url`, `read_file` + tests.
4. `lib/agent-loop.js` + tests.
5. Wire into `/api/council` behind a flag, with the router path as fallback.
6. Non-image uploads and text extraction, enabling `read_file`.
7. `run_code` behind the sandbox interface, dormant until a key exists.
8. SSE events + the frontend activity trail.

# Why ALOP-AI could not make the Canva project

Date: 2026-08-12

Scope: investigation and plan only. No product code changed. Source references use pushed commit `a7088b6` so concurrent backend edits do not move the evidence.

## Answer

The confirmed reason is capability, not prompting: ALOP-AI has no Canva integration and its council tool registry has no creation-capable tool. Even with the agent loop live and perfectly obeyed by every model, the loop can search, read, and inspect. It cannot create or edit a Canva design, write a project file, or operate Canva on the user's behalf.

A second possible cause remains open: production may have `COUNCIL_TOOLS` unset. The loop is off by default. If production is unset or `0`, ordinary council turns use the plain router and are not agentic. I could not authenticate to the production admin console, so this is not being asserted as production fact.

A third question also remains open: whether the current OpenRouter roster reliably emits this codebase's textual tool-call format. The local checkout has no OpenRouter key, despite the investigation brief saying one was in `backend/.env`, so no live probe was possible. Zero OpenRouter requests were used.

The important conclusion does not depend on either open question. Turning on the existing loop would not make Canva creation possible. It would only let the council autonomously use the read-only tools that already exist.

## Evidence

### Production setting is not known from this machine

`backend/server.js` defines three modes:

- unset or `0`: off, plain router path;
- `shadow`: one real prompted probe round, discarded;
- `1` or `true`: live tool loop.

The source explicitly says the loop is off by default and that an incompatible model can silently fall back to plain answers at up to three rounds of cost (`backend/server.js:728-750`). The boot log reports the resolved mode (`backend/server.js`, `[BOOT] COUNCIL_TOOLS=...`).

The protected admin `config` command is the correct production check. `COUNCIL_TOOLS` is individually allowlisted to reveal its value, while credential values remain redacted (`backend/lib/admin-commands.js:45-68,141-151`; `docs/ADMIN-CONSOLE.md:133-157`). I do not have `CLERK_TOKEN` or `TERMINAL_SECRET` in this process, so I did not call it.

Run exactly:

```bash
curl -s -X POST https://alop-ai.onrender.com/api/admin/console \
  -H "Authorization: Bearer $CLERK_TOKEN" \
  -H "x-terminal-secret: $TERMINAL_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"command":"config"}'
```

Read the `COUNCIL_TOOLS` field. `not set` or `0` means off; `shadow` means probe-only; `1` or `true` means live.

### What the council agent can do today

`backend/lib/tool-registry.js` registers at most four tools. The registry is built per turn, so optional backing services control which entries appear.

| Tool | Capability | Availability | Mutates external state? |
|---|---|---|---|
| `web_search` | Search the live web and return titles, URLs, and snippets | Registered in the live loop and shadow probe through `toolSearch` | No |
| `read_url` | Fetch one safe public HTTP(S) page as text | Registered with the URL safety guard | No |
| `read_file` | Read an attached conversation file by opaque id | Only when that chat has readable attached files | No |
| `search_specialized` | Query one SerpApi engine for prices, flights, hotels, papers, reviews, jobs, or market data | Only when `SERPAPI_API_KEY` is configured | No |

The wiring is at `backend/server.js:2355-2398`; definitions are at `backend/lib/tool-registry.js:90-243`.

There is no registry tool for:

- Canva;
- creating or editing a design;
- writing or exporting a file;
- running code in a sandbox;
- generating an image as part of an agent plan;
- sending email, posting content, or mutating any third-party system.

ALOP-AI has a separate user-facing image-generation path in the frontend, but it is not a council registry tool. The agent loop cannot select it, inspect its output, revise it, or place it into a Canva design.

One source comment is stale: the header of `tool-registry.js` says `read_file` is “not here,” but the implementation now exists at lines 161-196. The implementation, not that comment, is the current capability.

### OpenRouter compatibility is unproved

The current protocol can parse either native OpenAI-shaped `message.tool_calls` or fenced text blocks (`backend/lib/tool-protocol.js:1-133`). The live path does not currently use the native route:

1. `backend/lib/openrouter.js:72-95` sends only `model`, `messages`, `temperature`, `max_tokens`, `stream`, and `reasoning`. It does not send a native `tools` array.
2. The adapter returns completion text only, not the OpenRouter message object.
3. `server.js` and `agent-loop.js` therefore parse the returned string and depend on a model emitting exactly a fenced block such as:

````text
```tool_call
{"name":"web_search","args":{"query":"..."}}
```
````

OpenRouter advertising native tool support for a model is useful evidence about the model, but it does not validate this text protocol. A real prompt probe is still required.

No probe was run here. `OPENROUTER_API_KEY` is absent from `backend/.env`, every checked repository `.env*` file except the placeholder `.env.example`, and the current process. This contradicts the supplied lead and should be treated as current checkout evidence, not evidence about Render.

## Three tiers of work

### Tier 1: turn on and validate the existing research loop

Size: small operational rollout, about half a day of active work plus an observation window. No new end-user capability beyond autonomous research.

Work:

1. Read production `COUNCIL_TOOLS` with the admin command above.
2. If off, set `COUNCIL_TOOLS=shadow`, not `1`.
3. Run a deliberately current research question and inspect `[PROBE]` logs for parsed, unparsed, failed, and emitted counts.
4. Use `1` only after at least one roster model emits a parsed call and unparsed attempts are understood.
5. Watch the `council` admin command for rounds, calls per member, ceilings, and plain-council fallbacks.

This makes the existing read-only loop agentic. It does not add creation.

### Tier 2: add creation-capable tools

Size: medium, roughly 3 to 7 engineering days for one narrow, production-quality artifact family. “Make advanced projects” without naming an artifact contract is larger and should not be estimated as one tool.

A useful first creation family could create a structured project artifact, store versions, return a preview/download, and revise it. That requires more than adding a registry name:

- a bounded schema describing what may be created;
- an executor with cancellation and per-call deadlines;
- tenant-scoped artifact storage and ownership checks;
- result size limits and safe prompt boundaries;
- preview and confirmation rules for consequential writes;
- audit events, quota accounting, and user-visible progress;
- tests for invalid arguments, retries, duplicate calls, cancellation, cross-tenant access, and partial failure.

This is the general capability layer. It should be built around a concrete first output, not a generic `do_anything` tool.

### Tier 3: integrate Canva

Size: large, roughly 2 to 4 engineering weeks for a narrow public-facing Canva workflow with production auth, tool execution, UI, token lifecycle, and tests. Truly arbitrary “advanced Canva projects” may be larger and may not be achievable through Connect API alone.

Canva Connect is a real user-authorized integration, not an API-key prompt enhancement. Canva requires an integration client id and client secret plus OAuth 2.0 Authorization Code with PKCE, requested scopes, redirect URLs, short-lived access tokens, and refresh/revoke handling. Token exchange must happen on the backend. See Canva's [authentication documentation](https://www.canva.dev/docs/connect/authentication/).

The product work includes:

- Developer Portal integration registration and Canva review/publication strategy;
- connect, callback, disconnect, refresh, and revoked-token flows;
- encrypted token storage scoped to the Clerk user;
- least-privilege Canva scopes;
- registry tools with explicit inputs, for example `canva_create_design`, `canva_upload_asset`, `canva_get_design`, and `canva_export_design`;
- idempotency and confirmation for writes;
- rate-limit, expired-token, partial-job, and user-cancellation handling;
- links/previews that return the user to the created design;
- end-to-end tests with two users to prove token and design isolation.

Canva's [Create design endpoint](https://www.canva.dev/docs/connect/api-reference/designs/create-design/) can create a blank preset/custom design, add one uploaded image, or use preview copy/template modes. The [export endpoint](https://www.canva.dev/docs/connect/api-reference/exports/create-design-export-job/) can export supported formats. Those endpoints do not amount to unrestricted remote control of Canva's editor.

For richer automated composition, the implementation must choose one supported workflow:

- template-driven autofill, which Canva documents for Enterprise organization members;
- generate a supported external document and import it as a Canva design;
- create a base design and hand the user an edit URL for finishing in Canva;
- build an in-editor Canva App, which changes the product and interaction model.

The first product definition should say which of those counts as “done.” Promising arbitrary Canva editing before that choice would overstate the API.

## Recommendation and single next action

Run the production admin `config` command now and record the exact `COUNCIL_TOOLS` value.

That is the next action because it closes the largest operational unknown without changing behavior or spending OpenRouter quota. If it is off, the following rollout step is `shadow`, not live. Canva planning should proceed as a separate integration track because the confirmed creation gap exists in every mode.

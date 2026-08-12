# Six of 817 — the cybersecurity skills worth reading for this repo

Source: `mukul975/Anthropic-Cybersecurity-Skills`, Apache-2.0, 27.6k stars.
**Not an Anthropic repository despite the name** — the owner is `mukul975`. The
skills are real work and the framework mappings (MITRE ATT&CK, ATLAS, D3FEND,
NIST CSF 2.0 / AI RMF, F3) are the best part of it.

**Installing the set is not on the table.** Measured: 817 skills, `index.json`
alone is 256 KB. That catalogue has to be resident for the model to route on it
— roughly 64k tokens of menu before a question is asked. Each `SKILL.md` is
about 10.7 KB, and skills are instructions an agent follows rather than data it
reads, so 817 unread files from a third party is also the largest
prompt-injection surface installable in one command. That is the same "slop
injection" objection the owner raised about the 100-repo sweep, at eight times
the scale.

What follows is the other shape he accepted: **a named topic with a handful of
entries**, each tied to something that actually exists in this codebase.

Install one at a time, and read the 10 KB before you do:

```
npx skills add mukul975/Anthropic-Cybersecurity-Skills --skill <name> --full-depth
```

Ranked by what they would catch here, not by how interesting they are.

---

## 1. `detecting-indirect-prompt-injection`

**Hooks onto:** `backend/lib/council-tools.js:25` — `UNTRUSTED_PREAMBLE`, which
wraps fetched page content and attached filenames before they reach a seat.

This is the app's largest AI-specific risk and the one thing on this list with
no equivalent in a conventional security review. Seven models are handed text
pulled from arbitrary web pages by `read_url`, Firecrawl and `r.jina.ai`. The
current defence is a preamble telling the model the content is untrusted — which
is a mitigation, not a boundary, and its effectiveness is unmeasured here.

**What it adds beyond `claude-security`:** that plugin reviews code. This is
about content crossing a trust boundary at runtime, which no static pass sees.

## 2. `performing-security-headers-audit`

**Hooks onto:** `backend/server.js:1124`, the `helmet()` CSP block, and
`frontend/src/__tests__/securityHeaders.test.js`, which exists because a scan
once found alop-ai.com serving no CSP at all.

There is a specific thing to check. The policy currently ships:

```
scriptSrc: ["'self'", "'unsafe-inline'", 'https://*.clerk.com']
```

`'unsafe-inline'` on `script-src` defeats the main reason a CSP exists. It may
be load-bearing for Clerk — that is exactly the question worth answering with a
method rather than a guess, and a nonce or hash is the usual answer.

## 3. `exploiting-server-side-request-forgery` (with `performing-blind-ssrf-exploitation`)

**Hooks onto:** `backend/lib/url-guard.js` — 181 lines that already resolve the
hostname and refuse any private result, with `169.254.0.0/16` called out because
"link-local is where cloud metadata lives". The guard works: the live app
refuses with *"resolves to 169.254.169.254, which is a private or reserved
address"*.

So this is not a gap, it is the one place worth **attacking what already
exists**. The file's own comment names the hard case — a DNS answer that gives a
public address to the check and a private one to the connection. The blind
variant matters because the tool path swallows failures and returns `''`, so a
successful internal fetch may leave no visible trace.

**Read the offensive framing as a test method for your own service.** That is
what the skill is for; these are your hosts.

## 4. `auditing-mcp-servers-for-tool-poisoning`

**Hooks onto:** the tool registry and its executors — `lib/tool-registry.js`,
`lib/tool-protocol.js`, `lib/tool-dedupe.js` — plus every MCP server wired into
this machine's agent stack.

Tool poisoning, tool shadowing and description rug-pulls are failure modes of
agent stacks specifically. This one applies to how ALOP is *built* as much as to
what it ships, which is the same argument that made hookify worth wiring.

## 5. `exploiting-idor-vulnerabilities`

**Hooks onto:** `lib/tenant-scope.test.js`, which is a source contract rather
than a unit test, and it exists because this exact bug already happened here:

```js
supabase.from('chats').select('conversation_summary').eq('id', chatId)
supabase.from('chats').update({ conversation_summary: ... }).eq('id', chatId)
```

`chatId` arrives in the body of `/api/council`. Neither line filtered by owner.

So, like the SSRF guard, this is a defence that exists and is now enforced —
every query sampled in `server.js` carries `.eq('user_id', userId)`. The value
of the skill is **attacking it from outside** rather than re-reading the source
that the contract test already checks: the contract can only see queries written
in the shape it greps for, and it cannot see anything reached through RPC, a
view, or a table added later without a policy.

## 6. `performing-api-rate-limiting-bypass`

**Hooks onto:** `lib/pg-rate-limit-store.js` and `lib/rate-limit-key.js`.

Worth it here for a reason most apps do not have: a council turn costs seven
paid model calls, and a blown ceiling **buys another thirty-second whip** —
the post-truncation fallback the owner deliberately kept. That makes a rate-limit
bypass a denial-of-wallet, not just a load problem. Test what the key is derived
from and whether it can be varied.

---

## Considered and left out

- **Everything Windows, Active Directory, endpoint or network.** The first skill
  alphabetically is `abusing-dpapi-for-credential-access` — Mimikatz, SharpDPAPI,
  domain backup keys. Excellent red-team material for an estate this product
  does not have. That is most of the 817.
- **The SQL-injection family** (7 skills). The backend talks to Postgres through
  the Supabase client, not by concatenating SQL. `apply_migration` is DDL run by
  hand. Real risk, wrong shape for this stack.
- **The supply-chain family** (19 skills). `detecting-malicious-npm-packages`
  and `detecting-typosquatting` are genuinely relevant to any Node project, but
  Dependabot and `npm audit` already cover the same ground here with no context
  cost.
- **`testing-for-system-prompt-leakage`.** The council's system prompts are not
  a secret worth defending — they are described in `AGENTS.md` and the repo is
  public.
- **Compliance skills** (CMMC, NIST RMF, ATO). No such obligation exists.

## The honest caveat

None of these is a plugin that runs and reports. They are procedure documents
that make an agent's attempt at a given audit less improvised. The value is in
1 and 2 having a concrete, checkable target today — the injection boundary and
`'unsafe-inline'` — and in 3 giving a method for attacking a defence that
already exists rather than reviewing it by eye.

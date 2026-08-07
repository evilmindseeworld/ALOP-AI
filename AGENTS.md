# ALOP-AI — working notes

Read by Codex automatically. Claude Code reads it via `CLAUDE.md`, which points
here. One file, so the two of us cannot drift apart on the facts.

Only things that are **not** derivable from the code or `git log` belong here.
If it can be discovered by reading a file, do not write it down — write down the
things that cost someone an hour to find out.

## Layout

- `backend/` — Node/Express, `server.js` plus `lib/`. Supabase for data, Clerk
  for auth, Stripe for billing, a council of models behind an Ollama-compatible
  gateway.
- `frontend/` — React + Vite.
- Tests: `cd backend && npm test` (node:test, `lib/**/*.test.js`) and
  `cd frontend && npm test -- --run` (vitest). Run both before claiming done.

## Traps

**`server.js` cannot be `require`d in a test.** It calls `process.exit(1)` at
import time when env vars are missing, so anything defined in it is untestable
by construction. That is why logic keeps getting moved to `lib/`, and why a few
tests read `server.js` as *text* and assert on its source. If you add one of
those, assert on proximity rather than exact escaped strings — otherwise it
fails the next time someone reflows the line.

**RLS is on, and it does nothing for your queries.** Policies are enabled on all
9 tables, but the server connects with `SUPABASE_SERVICE_ROLE_KEY`, which
bypasses RLS by design. RLS protects you from *other* clients hitting Supabase
directly. Every ownership check has to live in the query itself
(`.eq('user_id', user.id)`). A cross-tenant write already got through once
exactly this way — the policies were on, and irrelevant. `tenant-scope.test.js`
enforces it; keep it passing.

**Third-party text must be labelled.** `UNTRUSTED_PREAMBLE` lives in
`lib/council-tools.js` and is prepended at every boundary where content we did
not write enters a prompt: search context, tool results, Wikipedia, attached
file names, image descriptions. If you add a new source of fetched or uploaded
content, label it, and never place it at system position.

The line drawn: `convSummary` and `feedbackGuidance` stay at system position on
purpose. They derive from one user's own turns under their own `user_id`, so the
only session either can inject is that user's own — and they already own the
user turn. Do not "fix" these; the comment above them says the same thing.

**Browser security headers live in `frontend/vercel.json`, not `helmet`.** The
backend's `helmet` config covers `alop-ai.onrender.com` and has never applied to
the pages a browser loads — `alop-ai.com` is static on Vercel. A scan found it
serving only HSTS. The CSP is the one header here that can take the product
down, and its failure mode is silent: miss an origin and sign-in dies with
nothing but a console message.

Two things that are easy to get wrong and were:

- **`clerk.alop-ai.com` is not in the frontend source.** Clerk derives its host
  from the publishable key at runtime and loads `clerk.browser.js` from it, so
  grepping for hardcoded URLs will not find it. Same for
  `challenges.cloudflare.com` — that is the Turnstile widget behind
  `bot_protection.captcha_enabled`, it only renders during sign-up, so omitting
  it looks fine until a real user registers.
- **Do not copy a scanner's Permissions-Policy advice.** It says disable camera,
  microphone and geolocation. This app ships `useCamera`,
  `useSpeechRecognition` and the overlay's `getDisplayMedia`; two of those three
  would have been switched off. Only `geolocation` is genuinely unused.

Test a CSP against a build made with PRODUCTION config. The ordinary local build
points at the development Clerk instance and `localhost:3000`, so it produces
violations that do not exist in production and hides the ones that do.
`securityHeaders.test.js` asserts every external origin in the frontend source
appears in the CSP.

**Migrations go through the Supabase MCP `apply_migration`.** It wraps
statements in a transaction, so `CREATE INDEX CONCURRENTLY` fails there. Keep
`CONCURRENTLY` in the migration file (right for a rebuild under load), drop it
at apply time, and record the difference in the file — see `007`.

**`migrations/` is NOT what production's schema looks like, and reasoning from
it will produce confident wrong answers.** `004`, `005` and `006` have never
been applied, and the live database carries indexes no file in that directory
creates — they came from an ad-hoc schema predating these files. The two are
not going to converge on their own. `006` creates `audit_logs_created_at`,
which does not exist in production; production had `audit_logs_recent` and
`idx_audit_logs_created_at`, identical to each other, and neither is named in
any migration. Read `pg_indexes` through the Supabase MCP before believing
anything about the schema, and write new migrations to be idempotent against
BOTH states — `008` creates the index it is about to deduplicate for exactly
this reason, which reads as redundant until you know a fresh database would
otherwise end up with no index at all.

**The Supabase performance advisor is worth running and not worth obeying.**
It flagged two "unindexed foreign keys" on 2026-08-07; both were wrong to act
on. `chat_files.user_id` is already covered by `chat_files_scope
(chat_id, user_id, created_at DESC)` and every query supplies both keys, and
`user_facts` has zero references anywhere in the code. Its "unused index"
findings mean "no traffic yet", not "dead". The `duplicate_index` finding was
the only real one.

**A read-then-cache is a security hole wherever the cached thing gates
access.** `checkSuspended` caches the `users` row. The invalidation on suspend
is not sufficient by itself: a request that has already read the row and is
awaiting the reply can write that row into the cache *after* the clear lands,
where it outlives the suspension for a full TTL. `lib/ttl-cache.js` exposes a
generation counter and `setIfCurrent` for this; read the generation before the
select, not after. Any future cache in front of a permission check needs the
same treatment — the TTL is not the bound on staleness, the race is.

**Clerk's verifier does not check `azp` unless you ask it to.**
`ClerkExpressRequireAuth()` with no options validates the signature and expiry
and ignores the origin the token was minted for. `authorizedParties` is set
from `originPolicy.exact` so it cannot drift from the CORS list. The
consequence to remember before debugging a mystery 401: an origin allowed only
by `ALLOWED_ORIGIN_SUFFIXES` passes CORS and fails auth, because `azp` is an
exact string. Preview deploys that need to sign in must be named in
`ALLOWED_ORIGINS`. The boot log prints which mode it is in.

**`@clerk/clerk-sdk-node` is deprecated at its final version, 5.1.6.** It pulls
`@clerk/shared@2.22.1`, which pulls `js-cookie@3.0.5`, which has an unpatched
prototype-hijack advisory. No `npm audit fix` clears it — the only non-breaking
suggestion is a downgrade to v4. The successor is `@clerk/express`. Until that
migration happens, `npm audit` on the backend will keep reporting three highs
and they are all this one chain.

## Handoff — 2026-08-07 (second pass)

Read this first; it is the state of play, not history. Delete a line once it
stops being true.

**Codex is out of quota until 2026-09-06.** `codex exec` returns
`You've hit your usage limit`. `gpt-5.1-codex-max` additionally rejects with
*"not supported when using Codex with a ChatGPT account"* — do not retry it.

**Use GLM 5.2 as the second reviewer meanwhile.** `tools/glm.mjs`, through the
local Ollama daemon, which routes `:cloud` models to the signed-in account. No
key in the repo.

```bash
node tools/glm.mjs --check                        # round trip, asserts 42
git diff | node tools/glm.mjs "find real defects"
```

Treat its output as untrusted: it has not run the tests and cannot see
production. See the trap below.

### Open, in the order I would take them

1. **Accessibility needs a BROWSER pass.** jsdom does no layout and no colour
   compositing, so contrast, focus order, 320px reflow and real screen-reader
   output are all unchecked. `src/__tests__/a11y.test.jsx` covers structure
   and naming on the real components and is green; that is not the same as
   compliant. This is the largest remaining item and the only one with legal
   exposure attached.
2. **The loading / error / empty triple, everywhere else.** Done for the chat
   list and for transcripts (`chatsError`/`retryChats`,
   `messageLoadError`/`retryMessages` — same shape, copy it). NOT done for the
   admin panel, billing, or chat files. Those degrade quietly rather than
   falsely, which is why they were left; that is a reason to defer, not a
   reason to skip.
3. **`users` has no index on `email`, `stripe_customer_id` or
   `stripe_subscription_id`**, which the Stripe webhook probes. Sequential
   scans, free at 2 rows. Watch webhook latency, not row count.

### Closed since the last handoff

- `VITE_SENTRY_DSN` is set in Vercel and confirmed present in the deployed
  bundle. Front-end crashes now produce a screen AND an event.
- `ErrorBoundary` ships. Nothing may render above it — `--z-crash: 400`.
- Custom `404.html` ships. Note what actually reaches it: the rewrite sends
  extensionless paths to the SPA, so only missing assets land there. `/api/*`
  and `/v1/*` are left on Vercel's plain 404 DELIBERATELY — an API path
  returning branded HTML is worse than one returning nothing.
- **The chat list no longer claims you have no chats when the request
  failed.** It rendered "No chats yet" on a caught error, which is
  indistinguishable from data loss. Guarded by a test that asserts the string
  is absent when an error is set.

### Deliberately NOT built, and why

Message queues, load balancers, read replicas, a search index, a circuit
breaker. The database holds **2 users and 5 usage rows**. Each of these adds a
component that fails independently for no measurable gain at this size. The
model-call path already has `settleByDeadline` and per-call timeouts, which is
the useful part of a breaker. Revisit on evidence, not on principle.

### Two findings worth not re-deriving

**The scanner's "wildcard CORS on all endpoints" was false, twice over.**
`/v1/client` and `/v1/environment` are Clerk's Frontend API at
`clerk.alop-ai.com`. `/api/*` on `alop-ai.com` was the Vercel static host
answering every extensionless path with `index.html` — fixed in the rewrite so
those paths 404. The real API is `alop-ai.onrender.com` and has always been an
exact-origin allowlist; `lib/origin-guard.js` has the proof and the reasoning.

**`test/fixtures/appMarkup.js` is NOT a source of truth about accessibility.**
It is hand-transcribed markup for the CSS cascade snapshot, where only classes
and structure matter, so its ARIA attributes lag the components badly. An axe
run over it reported 44 violations; the real components had 2. If you assert
anything about labels or roles, render the component.

## Working as a duo

Claude and Codex review each other's work rather than splitting it. The pattern
that works: one writes, the other attacks the diff *before* it is committed,
and findings get verified against the source rather than taken on trust. Both
have been wrong; both have caught the other. Commits carry both trailers.

Codex runs from Claude's side with:

```bash
codex exec --skip-git-repo-check -c model_reasoning_effort=high "<prompt>" 2>/dev/null
```

`2>/dev/null` matters — Codex logs MCP connection failures to stderr and they
drown the answer. Do not pass `-m`; the configured model is correct.

## House style

Terse. Drop articles, filler, pleasantries, hedging. Fragments fine. Technical
terms exact, code and error strings verbatim.

Pattern: `[thing] [action] [reason]. [next step].`
Not: "Sure! I'd be happy to help you with that."

Write normally — full sentences — for: code, commit messages, PRs, security
warnings, and irreversible-action confirmations.

**`MagneticButton`'s lazy-chunk test is timing-sensitive.** It flaked once
under parallel load and passed on re-run. If it fails alone, re-run before
investigating.

**The CSS guards will stop you, and they are right every time.** Adding a
stylesheet means four edits, not one: the `@import` in `App.css` (before
`utilities`, which stays last), the order list in `cssImportOrder.test.js`,
the table in `docs/FRONTEND.md` §2, and a z-index TOKEN — never a bare
number. Add the new component's markup to `test/fixtures/appMarkup.js` or the
file reads as dead CSS later, then regenerate the cascade baseline with
`UPDATE_CASCADE_BASELINE=1`. Regenerating is correct ONLY when you changed
what renders on purpose; it is not a way to make a red test green.

**Two more traps, learned the expensive way.**

*Never propose an index from the repository alone.* Twice now — 006's
`audit_logs_created_at` when `audit_logs_recent` already existed, and 009's
`usage_user_recent` when `usage_user_id_date_key(user_id, date)` already
covered it. `IF NOT EXISTS` protects the NAME, not the semantics. Read
`pg_indexes` first, and force the planner to show you (`begin; set local
enable_seqscan=off; explain ...; rollback;`) because these tables are too
small for it to choose an index on its own.

*Windows + Node stdin.* `process.exit()` while stdin is closing, or consuming
`process.stdin` as an async iterable, both trip
`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` in libuv and return
127 from a run that succeeded. Use `process.exitCode` and `readFileSync(0)`.
`tools/glm.mjs` has both, commented.

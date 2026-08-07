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

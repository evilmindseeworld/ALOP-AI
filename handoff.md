# Handoff - 2026-08-18 (seventeenth pass): the evaluation ran, and it found the thing the suite could not

Commits `8e21264`, `ef0c02d`. Backend 1926/1926. **15/22** on the first live
evaluation run against production. No migration. TWO new owner actions, and one
of them is that production is 15 commits behind.

- **THE RUNNER COULD NOT AUTHENTICATE, AND NO KEY WOULD HAVE FIXED IT.** Every
  token the Clerk BACKEND API mints has no `azp` claim, and `server.js` mounts
  `clerkMiddleware` with `authorizedParties`. Clerk says so in a header, not in
  the body: `x-clerk-auth-message: Invalid JWT Authorized party claim (azp)
  undefined. Expected "https://alop-ai.com,…"`. `azp` is written by the
  FRONTEND API from the `Origin` of the request asking for the token, so it
  cannot be added from the back. **When a Clerk 401 makes no sense, read
  `x-clerk-auth-reason` and `x-clerk-auth-message`** — two passes were spent on
  the body, which says only "Authentication required".

- **The run signs in the way a browser does now.** Sign-in token from the
  Backend API, redeemed at the Frontend API with `Origin` set to the instance's
  primary domain, one token minted per case from that session. Session created
  for the run and revoked on exit; the user's browser session is never touched,
  and nobody has to be signed in first. Frontend API host and origin come from
  `GET /v1/domains`. `@clerk/express` is gone from the script: four `fetch`
  calls.

- **THE PRODUCT DEFECT: three of four search cases were answered with no
  search.** "What happened in the news today? Cite your sources." came back as
  "I do not have access to live news feeds", zero citations. The weather case
  searched and cited, so the tool is wired and working and what failed was the
  DECISION. The planner's prompt is not the lever — it already names news,
  versions and prices and already carries "latest react version" as an example.
  `CITATION_DEMAND_RE` in `lib/router.js` answers instead: a citation cannot
  come from memory, so asking for one is an explicit request for the web. Same
  move `namesSpecificModel` made for SKUs, except from a measurement.

- **Three of the dataset's own graders were marking correct answers wrong.**
  `mustMatch` is AND, and `fact-speed-of-light` listed two alternatives as two
  patterns; `fact-water-formula` could not match the `₂` in `H₂O`;
  `reason-bayes` demanded the literal phrase "base rate" from a correct
  base-rate answer. Every fixed pattern was checked against the recorded answer
  AND against a wrong answer it must still refuse. **A dataset is a program.**

- **`arith-order` took 31.7s for `8 + 6*3 - 4`** against a 30s cap, in a run
  where the other two arithmetic cases took 8.6s and 1.2s. One sample, no
  diagnosis. Recorded, not fixed.

- **PRODUCTION IS 15 COMMITS AND 22 HOURS BEHIND `main`.** `GET /health` reports
  the running commit; it was `74d01c6`. Render is not auto-deploying — the note
  calling it "on but slow" is wrong. So the 15/22 is a true measurement of a
  build that predates the whole file-attachment half of item 32, and the router
  fix above cannot be checked against production until someone deploys. The
  `render` CLI at `~/.local/bin/render.exe` is not authenticated and `render
  login` is a browser flow. **Check `/health`'s commit against `git log` before
  believing anything measured against production.**

- **`RATE_LIMIT_STORE=postgres` is now MEASURED, not reported.** `/health`
  answers `"rateLimitStore":"postgres"` with no authentication. The ledger had
  recorded it as unverifiable from here on the belief that only the admin
  terminal could read it; that was wrong.

- **Owner actions: deploy, and decide item 30's cadence.** The three original
  ones are closed. Item 30's remainder — a queued evaluation producer — is now
  decision-gated rather than sequenced: how often it fires, which service user
  it signs in as, and what a failing report does are three decisions an
  implementer does not get to make, and each firing spends 22 council turns
  against production.

- **The report is committed**, at `eval-runs/2026-08-18-core-v1.json`. The next
  run's value is the comparison.

---

# Handoff - 2026-08-18 (sixteenth pass): the eval runner could not start on production

Commit `318bdc3`. Backend 1924/1924. No migration, no deploy, no new owner
action. The working tree had been left mid-edit by the previous pass and the
runner was not startable.

- **The auth block referenced an `active` binding that did not exist** and an
  undeclared `sessionId`, so any run with `EVAL_CLERK_SECRET_KEY` died on a
  ReferenceError before case one. `node --check` passed it; the bug is a
  runtime reference, which is why the file looked fine.

- **Clerk will not create a session on a production instance** - 400
  `request_invalid_for_environment`. The run now lists the user's ACTIVE
  sessions and borrows one, and creates a session only when there is none to
  borrow (the development case).

- **A borrowed session is never revoked.** It is the user's own and revoking
  it signs them out of their browser. A session the run created still is
  revoked on exit, including on a crash.

- **A wrong-instance secret key was a stack trace.** It is one line now:
  `FAILED: Clerk refused the user list (HTTP 401)...`. Observed against a
  bogus `sk_test_` key, not reasoned.

- **Still never run against a real session.** Everything here was verified
  through failure branches and the dataset validator; the live run remains
  the one open owner action.

---

# Handoff - 2026-08-18 (fifteenth pass): item 32 closed, and emoji out of error messages

Workspace files are built and applied (029). **Item 32 is complete.** Backend
1924/1924. Migrations 028 and 029 are BOTH APPLIED - no owner action added; one
still remains.

- **"Workspace ingestion" had no specification anywhere**, so it was defined
  against what the app lacks: every file was bound to one chat, so the same
  syllabus had to be re-uploaded and re-extracted in every conversation.

- **A workspace file is a `chat_files` row with `chat_id IS NULL`.** No second
  table, no second store, no second retrieval path - the same row read by the
  same `read_file` and `search_files`.

- **NULL rather than a `scope` column IS the design.** A foreign key does not
  constrain a NULL, so the row leaves 003's `ON DELETE CASCADE` by
  construction. A flag beside a populated `chat_id` would not: deleting the
  chat a document was uploaded into would delete the workspace document too.
  Measured with a live probe, not argued.

- **The probe also measured something 028 had only asserted**: the delete
  trigger DOES fire on a cascade delete, so a cascaded object is queued for
  sweeping.

- **The object never moves.** Its key is fixed at upload; rewriting it on
  promotion would mean a copy, a delete, and a window where a download 404s for
  a file that exists.

- **The widening is one line and the wrong one leaks every chat.**
  `chat_id.eq.<this chat>` OR `chat_id.is.null` - DROPPING the chat clause
  would pull the user's other conversations into this one. A test now counts
  the clauses.

- **Two pre-existing guards failed when the store was widened** and were
  updated rather than deleted: `query-bounds` (still bounded, now at both
  ceilings) and `upload-wiring` (the user predicate is untouched).

- **Emoji are out of error messages.** The user-facing error bubble dropped its
  warning sign; the CLI scripts now print `FAILED:`/`OK:` instead of dingbats,
  which also survives a terminal that cannot render them and a log that is
  grepped. Four emoji remain and are deliberate: two test fixtures that exist to
  prove multi-byte handling, and the command palette's chat icon.

- **The frontend suite is flaky under load ON THIS MACHINE, and it is not this
  change.** 5 failures with these changes, 7 on unmodified HEAD in the same
  conditions; every affected file passes in isolation and the suite passed
  705/705 twice earlier today. Do not chase it as a regression.

- **NOT VERIFIED end to end.** `chat_files` has zero rows in production. Nothing
  has been uploaded, promoted, searched from a second chat, or downloaded by a
  real person.

- **Owner action, still ONE**: the evaluation run, with
  `EVAL_CLERK_SECRET_KEY` (a pasted session JWT lives ~60s and cannot survive
  a 22-case run).

---

# Handoff - 2026-08-18 (fourteenth pass): the file its own owner could not download

Item 32's object-storage half is built and applied. Backend 1915/1915, frontend
705/705. Migration 028 is APPLIED - no owner action is added; one still remains.

- **The gap was not ACLs.** `file-intake.js` extracts a PDF's text, stores it,
  and discards the original bytes. The council could answer questions about a
  document its own owner could never get back.

- **A bucket, without reopening what 003 closed.** 003 refused a bucket because
  "a bucket would reintroduce a key namespace to get wrong". So the key is
  DERIVED and never supplied - `{user_id}/{chat_id}/{file_id}`, three UUIDs the
  server already resolved - and `lib/storage-keys.js` refuses anything that is
  not hex-and-hyphens. `..`, `/`, `%2f`, a backslash and a null byte are
  rejected by the SHAPE of a UUID, not by a blocklist. The filename never
  enters the key; it is the one part a user fully controls.

- **The row authorises, the key does not.** The download resolves
  `id + user_id + chat_id` first - `read_file`'s own predicate - then derives
  the key, then signs a 60-second URL for one object. No model path changed:
  `read_file` and `search_files` still read text out of Postgres.

- **Orphans.** `chat_files` cascades from `users` and `chats`, and a cascade
  runs inside Postgres with no application code in the path, so deleting a chat
  would leak every attached document. A trigger records what outlived its row;
  `storage_sweep` drains it. Deleting in the route would have covered the
  minority path.

- **Retention cannot fail an upload.** The file is already accepted and its text
  already stored by then. A bucket that is down leaves `storage_path` NULL and
  the endpoint says the original was not kept.

- **Verified against the database, not against a success return.** Column,
  private bucket, storage policy, sweep table, trigger, forced RLS and the
  pinned `search_path` all read back out of the live catalog. The trigger was
  probed live, then a deliberately-false control was run to prove the probe
  could fail at all.

- **Rendering changed on purpose** (download button on the file chip). The
  2856-line cascade-baseline diff is index renumbering: regenerating from the
  PRE-change markup reproduces the committed baseline except for two lines
  naming the new selectors, which proves nothing existing re-rendered.

- **NOT VERIFIED end to end.** `chat_files` has zero rows and always has, so no
  real file has been uploaded and downloaded through this.

- **Owner action, still ONE**: the evaluation run. Use
  `EVAL_CLERK_SECRET_KEY`, not `EVAL_TOKEN` - a pasted session JWT lives ~60s
  and cannot survive a 22-case run.

---

# Handoff - 2026-08-18 (thirteenth pass): 027 applied, and two of the three owner actions closed

Migration 027 is applied and verified in the live catalog. Backend is
1900/1900, unchanged - nothing in this pass touches code. ONE owner action
remains.

- **027 applied through the Supabase MCP**, not by hand. Verified after:
  `users.stripe_event_at`, `timestamp with time zone`, nullable, comment
  attached, 10 rows, 0 non-null. Zero non-null is the CORRECT state - the
  migration deliberately does not backfill, because backfilling to `now()`
  would reject the next real event for every existing user as stale.
  `notify pgrst, 'reload schema'` was issued after, so PostgREST would not keep
  answering `PGRST204` from a stale cache; `stripe-apply.js` already treats that
  code as "column missing" and falls back, so the failure mode was safe either
  way.

- **The Stripe ordering guard is now live**, and it repaired nothing, because
  there was nothing to repair. Checked rather than assumed: both `plan = 'pro'`
  rows are `is_admin = true`, and the one with no `stripe_customer_id` is a
  direct grant. There are no paying non-admin customers, so the reordering bug
  has never had a real one to strand. Prophylactic, and worth saying in those
  words - "fixed" would imply a repair that did not happen.

- **`RATE_LIMIT_STORE=postgres` is REPORTED SET by the owner and NOT MEASURED
  from here.** The value is only readable through the admin terminal against a
  live session. The census warns if it is ever wrong, which is what it is for.

- **Item 30 stays partial on purpose.** Its remainder is evaluation
  producers/handlers, and the platform they would queue has never been run once
  against a real answer. Queueing a producer for something that has not run once
  is building the second thing before the first works. It closes when the eval
  run does.

- **Owner actions, now ONE**: run the evaluation dataset once against a real
  session. **Use `EVAL_CLERK_SECRET_KEY`, not `EVAL_TOKEN`** — a pasted session
  JWT lives ~60s and cannot survive the run.
  `EVAL_CLERK_SECRET_KEY=sk_… BASE=https://alop-ai.onrender.com npm run evals`
  from `backend/`, secret key from the Clerk dashboard of the same instance the
  server runs on. Costs up to 22 council turns, four of them full
  research turns. Until it happens, items 34, 35 and 30 are a platform with no
  measurement in it.

- **Everything else left in Phase 3 is decision-gated, not work-gated.** Item
  32's remainders are object storage ACLs (means moving files out of
  `chat_files` into Supabase Storage - a vendor and migration decision) and
  workspace ingestion (a new feature needing a scope). Item 44 needs real
  devices. Item 33 is closed with its revival trigger recorded.

---

# Handoff - 2026-08-18 (twelfth pass): the search that answered "not in your documents" about a document that answered

Item 32's semantic half is built. Backend is 1900/1900. Nothing is deployed by
this pass, no migration is involved, and no owner action is added.

- **The bug was not ranking, it was silence.** `scorePassages` keeps nothing
  scoring zero, so a question that paraphrased its document scored zero on every
  passage and `search_files` reported "The documents were searched; the terms do
  not appear in them" - about a document that answers the question.

- **The vector side.** `batchEmbedRequestBody`/`parseBatchEmbeddings` in
  `lib/embeddings.js` (one round trip, not N); `cosine` and `fuseDocumentHits`
  in `lib/doc-passages.js`, fused by `hybrid-retrieval.fuse` on the corpus-wide
  passage `index`; `searchAttachedFiles` in `lib/tool-registry.js` holding every
  degradation; `embedBatch`/`embedPassages` in `server.js` with a 4s deadline,
  the only impure part.

- **A batch of the wrong length is discarded whole.** One missing embedding
  would slide every later vector onto the wrong passage, and the ranking would
  look healthy. This is the same shape as the `.update().eq()` bug last pass:
  the failure reports success.

- **`cosine` returns null, not zero**, for a missing vector - zero means
  orthogonal, which is a measurement, and it would outrank everything the query
  disagrees with. A 0.5 floor on the vector side keeps "not in your documents"
  a reachable answer, since every vector has a nearest neighbour.

- **The ceiling is stated, not silent.** 50 passages (~90,000 chars) per search
  call against a 2 MB scan limit. Past it the search is lexical AND says so in
  the text the model reads. Raising it means passage vectors stored at upload
  time: migration, backfill, job-queue write.

- **Seven guards observed red.** The ceiling test failed first for the wrong
  reason - a 120-paragraph fixture is ~7 passages, not 50.

- **Never run against the live provider.** `GOOGLE_API_KEY` is Render-only. The
  request shape was checked against Google's REST docs, not a response. Item 32
  stays `partial`: object storage ACLs and workspace ingestion are untouched.

- **Owner actions, still three** - `RATE_LIMIT_STORE=postgres` in Render before
  scaling past one instance; apply `027_users_stripe_event_at.sql`; run the
  evaluation dataset once against a real session.

---

# Handoff - 2026-08-18 (eleventh pass): the money, the order, and a rebuild that did not work

Items 40, 41 and 42 are complete; 32 moved from blocked to partial. Backend is
1880/1880. Nothing is deployed by this pass. ONE new owner action: apply
migration 027.

- **Item 32, cross-file retrieval.** `search_files` searches every file
  attached to the conversation in one call. `read_file` took one id, so five
  documents meant one bounded agent-loop round per guess, guessing from the
  filename. Commit `91ce23c`.

- **Item 41, the billing read model** - and the SECOND road to the paid-and-free
  bug, found while building it. `.update(...).eq(...)` reports no error when it
  matches ZERO rows, so an event addressed to a user row that is not there
  logged the healthy line and marked itself done. `.select('id')` is the fix.
  The read model is built on `audit_logs`, so it needed no migration. Commit
  `1fa6aec`.

- **Item 40, Stripe does not promise order.** Nothing in the request path
  compared event timestamps, so a reordered `subscription.updated` /
  `.deleted` pair left a cancelled customer on `pro` permanently, invisibly,
  with the customer happy. `users.stripe_event_at` is now compared and advanced
  in one statement. Commit `b9a3b03`.

- **Item 42, the rebuild was assumed and it did not work.** 12 of 28 migrations
  failed the first time they met an empty database, all cascading from 000
  creating RLS policies that call functions 002 and 012 create. Docker's daemon
  was the blocker named last pass; it is running now.
  `scripts/rebuild-proof.sh` makes the check one command. Commit `e2cf150`.

- **What is left in Phase 3.** Item 33 (sandboxed compute) is unstarted and
  needs an architecture decision - Render cannot run Docker-in-Docker, so the
  sandbox has to be an isolate, a WASM runtime, or an external service. Item 44
  (authenticated browser release matrix) needs a real session on real devices
  and is an owner action. Item 32's remainder is embeddings, object storage
  ACLs and workspace ingestion.

- **Owner actions, now three**: `RATE_LIMIT_STORE=postgres` in Render before
  scaling past one instance; apply `027_users_stripe_event_at.sql`; run the
  evaluation dataset once against a real session.

---

# Handoff — 2026-08-17 (tenth pass): five documents, one call

Item 32's cross-file half is built. Backend is 1857/1857. Nothing is deployed
by this pass; no migration is involved and no owner action is added.

- **`search_files`** searches every file attached to the conversation in one
  call and returns the best passages labelled with file, heading and character
  offsets. `read_file` took one id, so with five documents the model spent one
  bounded round per guess, guessing from the filename. Files:
  `backend/lib/doc-passages.js` (`searchDocuments`/`renderDocuments`),
  `backend/lib/tool-registry.js`, `backend/lib/council-tools.js`,
  `backend/server.js` (`fileStoreFor.all`).
- One scoring pass over the MERGED corpus — rarity only means something across
  the corpus being searched. Nothing matching returns nothing rather than the
  beginning of an arbitrary document. The scan is capped and any file it could
  not open is named in the result.
- Three guards observed red. One of them did not exist when first claimed: the
  per-file-index revert left the suite green, and the ordering test was written
  to make the claim true.
- **Item 32 is now `partial`, not blocked.** Still unbuilt: embeddings (the
  ranker was lexical; the vector side landed 2026-08-18), object storage ACLs,
  workspace ingestion.
- **The two owner actions are unchanged** — `RATE_LIMIT_STORE=postgres` in
  Render, and one live `npm run evals` run with a Clerk session JWT.

---

# Handoff — 2026-08-17 (ninth pass): the evaluation platform, and gates that refuse what they cannot measure

Phase 3 items 34 and 35 are built and unshipped-to-a-real-run. Backend is
1823/1823. Nothing is deployed by this pass; nothing here touches a request
path.

- `backend/lib/evaluation.js` (pure), `backend/lib/release-gates.js` (pure) and
  `backend/scripts/run-evals.mjs` (the only impure part). `backend/evals/core-v1.json`
  is 22 cases: arithmetic, static facts, reasoning, four search cases graded on
  HAVING a citation rather than on what it says, routing/capability cases graded
  on taking NO tool, and two prompt-injection canaries that fail if the answer
  contains a distinctive line from `UNTRUSTED_PREAMBLE`.
- The rule the whole thing turns on: **an unmeasured metric is `inconclusive`
  and inconclusive fails.** `costCentsPerTurn` and `cachePrecision` are not
  observable over HTTP today, so their gates refuse rather than pass on a zero.
  `--allow-inconclusive` exists and is a flag a human has to type.
- `npm run evals` / `npm run evals:validate` in `backend/`. A live run needs a
  Clerk session JWT in `EVAL_TOKEN`; it has never been run against a real
  answer, and until it is, items 34 and 35 are a platform with no measurement
  in it.
- Two source-text guards in `head-selection-wiring.test.js` were already failing
  from `a921020`'s reflow. Made whitespace-tolerant, then observed red again
  against real regressions.
- **The two pending migrations did not move.** The Supabase MCP connector needs
  re-authorising and Supabase rejects its OAuth client
  (`{"message":"Unrecognized client_id"}`), so it cannot be re-authorised from
  here. 019 and 026 remain owner actions via the dashboard SQL editor or a
  `supabase login` terminal.

---

# Handoff — 2026-08-14 (seventh pass): one-seat routing and semantic answer reuse

Migration `017_answer_cache_embeddings.sql` is applied to production. Code is
locally complete with 1094 backend tests passing; commit, deploy, and the
`COUNCIL_SEMANTIC_CACHE=1` production flag remain pending at this checkpoint.

- Confidently simple questions use one lowest-latency seat. "Can you use
  Canva?" qualifies without misclassifying analytical Bayes prompts. Uncertain,
  complex, and search/current turns retain the full selected roster.
- The legacy direct-search path now runs and records the full council before
  synthesis. Its seat and synthesis requests participate in cost/request
  settlement and structured audit telemetry.
- Optional semantic lookup reuses the existing 768-dimension question
  embedding, filters exact language/country/plan/detail/execution-mode
  boundaries, and defaults to cosine similarity 0.95. Exact and semantic hits
  are separately logged and counted; errors fail open to normal generation.
- Stable no-search answers use a century-long sentinel because `expires_at` is
  non-null. Search-backed answers retain their short shelf.
- Production inspection confirmed the new vector column, invoker-rights RPC,
  empty search path, revoked anon/authenticated execution, service-role access,
  forced RLS, and a clean zero-match call. No approximate index was added for a
  one-row live cache.
- Verification: full backend suite 1094/1094, `node --check server.js`, and
  `git diff --check`. Router and semantic regressions were observed red with
  their implementations temporarily disabled, then green after restoration.

---

# Handoff — 2026-08-14 (sixth pass): durable smart expiry and the bounded cache brain

Code commit `38eb1ed` is live, confirmed by `/health`, and migration
`016_answer_cache_inputs.sql` is applied to production. Backend: 1089 tests
passing. The production boot log confirms `COUNCIL_BRAIN=1 -> brain ENABLED`.

## What changed

- Stable answers use the 90-day safety shelf; search-backed answers use 24
  hours, and explicitly fresh questions use one hour. The router's actual
  search decision controls all four write sites.
- Durable cache rows now retain the non-personal replay inputs needed to ask the
  same question again. Migration 016 added the seven columns and the partial
  `answer_cache_search_expiry` index. Production verification confirmed every
  column, the index predicate, and enabled + forced RLS.
- The background brain is now wired into server boot. It refreshes only current
  execution-mode search rows nearing expiry, pre-computes from 28 curated
  product questions, paces work, stops on 429/daily refusal, and starts only
  with `COUNCIL_BRAIN=1`.
- Background turns go through the real council handler and real request/spend
  admission. They are cancelled on shutdown; timers are unref'd. The normal
  turn remains the only cache writer and TTL authority.

## Production proof and remaining live check

- `COUNCIL_BRAIN=1` and `BRAIN_USER_ID` are set in Render; the identity was
  verified as a real `users` row before enabling. `BRAIN_CLERK_ID` keeps its
  documented internal default.
- Still owed: make one unpersonalised turn, verify its replay columns in
  `answer_cache`, and repeat it from a separate new chat for an
  `[ANSWERS] HIT ... models=0` line. That requires an authenticated product
  session; boot, schema and health checks do not substitute for it.
- The advisor run after migration added no migration-specific warning. The new
  index is reported unused because it has not yet had a deployed hourly query;
  the existing service-only/no-policy RLS infos and older function warnings are
  unchanged project state.

---

# Handoff — 2026-08-14 (fifth pass): routing tiers corrected, and the 429 fallback that cost 20 seconds

Live on `716f591`, confirmed by `/health`. 1061 tests passing.

## What was wrong, and is not now

**Capability questions cost three seats.** `LOOKUP_RE` is anchored on
what/who/when/where/which, so "can you access Canva?" matched nothing and took
the default middle tier. Now `simple`: one seat, 400 tokens. The pattern needs a
capability OBJECT and at most ten words, which is Sol's finding — "can you use
Bayes' theorem to calculate…" and "can you access the database and determine
why…" have identical grammar and are hard questions. Both are in the negative
test.

**Research turns ran on one seat.** `classifyRequest` runs on the text alone
because the roster it returns sets the spend reservation, so the router's search
decision could not be an input. A short lookup-shaped question that needed live
information got ONE seat and then the search context and the agent loop — the
most expensive path in the product run by the smallest council in it.
`escalateForResearch` widens it once the router has decided, moving quorum, the
token ceiling and the reported complexity in the same step so a seven-seat
council cannot release on a quorum of one. The budget for the wider roster is
reserved at ADMISSION (`maxSeats`), not claimed afterwards — widening below the
layer that set the budget is rule 8, and the money would already be spent.
`SEEDED_SEARCH` gates both halves, because with it off the search branch answers
and returns before the council exists.

**The 20-second 429.** `[STREAM] gemma-4-26b … Stream HTTP 429 … Falling back to
nemotron` in the Render log: a provider 429 before a single byte was buying the
fallback instead of a retry, and nemotron's median is 23.9s against gemma's
2.4s. `callModel` had that retry all along; the STREAMING path — every answer a
user reads — did not. luna's `fetchOpenRouterStream` (a9d5356) retries only what
happened before a body was returned, so "never retry after a partial answer"
holds by construction. Two defects found wiring it: the helper dropped its
parent-abort listener at handoff (the read loop never tests the signal itself,
so a closed tab kept generating), and it reports `X-RateLimit-Reset` in the
wire's own unit while the per-minute policy reads milliseconds — a ten-digit
seconds value is 1970, which reads as "already reset" and retries straight back
into the limit.

## Still open, both Sol's

1. **The request ceiling undercounts.** `callModel` may make three HTTP attempts
   for one recorded seat (`openrouter.js` retry loop), and settlement equates
   `seats.length` with requests (`spend.js:321`). The stream retry added here
   makes one more attempt the ceiling cannot see. Meter at dispatch, or reserve
   for retries pessimistically.
2. **No minute-aware pacing.** A seven-seat research turn can burst 7 requests
   at once and 28 over four rounds against an account-wide 20/minute. The daily
   reservation does not pace anything. Sol argued for three seats on
   search+simple/moderate and the full roster only when the question is also
   complex; the owner's instruction is full council on search, so pacing is the
   fix and it is unbuilt. luna judged it does not belong in the per-call helper.

---

# Handoff — 2026-08-13 (fourth pass): COUNCIL_TOOLS=1 IS LIVE, and the first real turn cost a fortune

The owner set it in Render. `[BOOT] COUNCIL_TOOLS=1 -> tools LIVE` is in the
logs from 22:10. This is the first time the tool loop has ever run against real
models on the real gateway, and the shadow-probe question in
`council-tools.js` — *do these particular models emit a parseable ```tool_call
block?* — finally has a measured answer. It is worse than "no".

## What was measured, end to end, against production

**A plain search question never reaches the loop at all.** "Search the web for
… and summarize" was classified by the ROUTER and answered above the council:
2 router calls + 1 streamed answer, 22 cited URLs, correct. Good answer, but
nothing about the tool path was exercised. **Any test of the tool loop that
asks a search-shaped question is testing the router.**

**Asked to open a result, the seats emitted nothing.**

```
[TOOLS] 1 round(s), 0 unique call(s), 1 answer(s) — 1 member(s) did not reply within the 18000ms round.
```

The seat replied *"I cannot fulfill this request because no search results or
URLs were provided in the context"* — it did not occur to it to call
`web_search`. The catalogue is in its prompt and it did not use it.

**Told explicitly to emit the fence, the plumbing worked and the loop then ate
itself:**

```
[TOOLS] r1 tool_start  web_search — OECD Digital Education Outlook 2026
[TOOLS] r1 tool_result web_search — 6 results
[TOOLS] r2 tool_start  web_search — OECD Digital Education Outlook 2026   <- identical
[TOOLS] r3 tool_start  web_search — OECD Digital Education Outlook 2026   <- identical
[TOOLS] 4 round(s), 3 unique call(s), 0 answer(s) — Stopped after 4 rounds; 1 member(s) still wanted to research.
[TOOLS] no usable answers, falling back to the plain council.
```

Three identical searches executed three times, four rounds of seats, zero
answers, then a whole fallback roster on top — against a 50-request/day
account-wide cap. **The loop's own line says "3 unique call(s)" while running
one query three times, so whatever it dedupes, it is not this.**

**`read_url` has never been called by a seat, in any turn.** The id gate is
correct and it is unexercised. Nothing in the search-result rendering tells a
seat that reading one is the next move.

## The two defects that fire on ordinary turns

- **A tool-call block reached the user's answer**, rendered as ```` ```json ````
  with `{"name": "web_search", …}` in it. `FENCE` in `tool-protocol.js` matches
  only ` ```tool_call `/` ```tool-call ` while its own comment claims it tolerates
  "json-ish casing" — so a `json` fence is neither run nor stripped. The
  observed leak came from the FALLBACK council, which may not strip at all.
- **`[EMBED] 404 models/text-embedding-004`** on every turn. The model name in
  `embeddings.js:31` is dead at Google, so every turn buys a 404 and the memory
  write behind it fails silently.

## Verified good

`read_url`'s refusals are clean, checked against the shipped registry: an
unknown id returns *"That is not a result id from this turn…"* and a
metadata-address hit returns *"That host is refused by network safety checks."*
with no address anywhere in the model-facing string.

## Fixed the same night

- **`297b02e` — repeated tool calls are cached per turn.** Shared across the
  turn's members, keyed on the registry-normalised name and args, and a repeat
  costs no executor call, no unique-call slot and no tool-time budget. A member
  that repeats its own call is told to answer next round, which is the half
  that stops the 0-answer fallback above. The regression asserts ONE executor
  invocation for two identical calls in different rounds — a test that counted
  results would have passed against the bug.
- **`cc1bf2d` — a ```` ```json ```` fence that has the SHAPE of a tool request is
  stripped and never executed**, including a truncated one, which is what
  actually leaked. An ordinary JSON example survives, because the strip requires
  a name/tool key beside args. The plain-council fallback now runs its replies
  through the same sanitiser before they can reach quorum or synthesis — it
  never went through the loop's parser at all, which is why the leak appeared
  there and not in a tool round.
- **`cc1bf2d` — the embedding model is `gemini-embedding-001`**, 768 dimensions,
  read off Google's current docs rather than guessed. Confirmed live: **zero
  `[EMBED] 404` lines since the restart**, against one on every turn before it.

  **THERE IS NO BACKFILL TO RUN, and the claim that there was is retracted.**
  It was written here as "every `text-embedding-004` vector needs a re-embed",
  which is what you would reason from a model swap and is not what the database
  says. Counted against production through PostgREST on 2026-08-13:

  ```
  user_facts total rows            2
  rows with a non-null embedding   0
  ```

  The 404 meant no vector was ever written, so there is nothing incomparable
  and nothing to migrate. The re-embed was a prior asserted as a measurement —
  the same mistake this file's own rules name. Two rows is also worth knowing
  on its own: semantic fact recall has never had data to work with.

- **`8174714` + the follow-up — a protocol blob is a FAILED ANSWER, not text to
  strip.** A seat that replies with nothing but a tool request or a
  `{"queries": […]}` plan is now reported as a seat that did not answer, so the
  whip and the fallback pick another writer. Stripping it would have rendered a
  blank reply, which looks worse than the leak. Applied at every answer boundary
  — search, Wikipedia, memory, greeting, council, tool loop, fallback, solo and
  synthesis — not only the search path where it was seen. A user who explicitly
  asks for that JSON shape still gets it.

  **THE FIRST CUT OF THAT HELD EVERY CODE ANSWER TO THE END OF THE STREAM, and
  it is the interesting part.** To avoid half-painting a blob, the streamer
  holds text back while the reply "might still be protocol" — and that test was
  the FIRST CHARACTER. A backtick opens both a ```` ```json ```` blob and an
  ordinary ```` ```js ```` code block, so the candidate flag never cleared and a
  code answer arrived in one paint with zero progressive chunks, on a product
  whose own starter card is "Debug some code". Measured that way before fixing
  it: 4 frames in, 0 emitted. `looksLikeProtocolOpening` now reads the fence as
  far as its info string and releases the moment the newline says `js` rather
  than `json`. **A correctness guard that runs on the streaming path is a
  latency change; judge it as one.**

- **`df2be19` — the search → read chain is now asked for.** `read_url` had never
  been called by a seat, and the reason was not the model: nothing ever told it
  that an id beside a search result was for anything. A seat that has search
  results in hand is now invited, AT SYSTEM POSITION, to read AT MOST ONE of
  them by id when the snippets are not enough. System position matters and is
  not a style choice — an instruction rendered inside the untrusted result block
  is an instruction an attacker's page can imitate. The final round still
  carries neither the catalogue nor the nudge; a test pins that.

  "At most one" is the cost rule: reading is a network fetch with a 16k ceiling,
  and six reads a round is the cost problem `297b02e` just fixed wearing a
  different hat.

- **`eb81d97` — a failed stream now says WHY.** `[STREAM] … (Stream failed)` was
  thrown for a 429, a 5xx and a provider that opens and closes alike, so two
  observations of `gemma-4-26b` failing could not be classified at all — the old
  log discarded the response. It now records the HTTP status and up to 300
  characters of the gateway's own detail. **The policy is deliberately
  unchanged**: one primary attempt, then fallback. No same-model retry, no
  demotion, no seat removal — this file is explicit that seat health has been
  misdiagnosed here before from a sample that measured the wrong thing, and two
  observations is not a sample. The failure still costs exactly one wasted
  request plus one fallback, which was the constraint.

- **`e48a9a1` — a 429 is now waited out, not raced.** `eb81d97` made the failure
  legible and within the hour it told us what a year of `Stream failed` never
  did: `limit_source: openrouter_free_tier_per_minute`, `X-RateLimit-Limit: 20`,
  `Remaining: 0`. **The seat was never bad — that is our own account-wide 20/min
  free-model ceiling**, and falling back to a different free model could not
  possibly help because the fallback is behind the same gate. It didn't: the
  fallback request is what killed the turn with `Council error: Stream HTTP
  429`. Now: account-wide per-minute waits for the reset (abortably) and retries
  the SAME model once when the wait fits the 75s admission budget; if it does
  not fit, it fails immediately without spending a second request. A provider's
  own 429 keeps the different-model fallback. The daily cap keeps its existing
  latch. Maximum cost is still two requests.

  `handoff.md` already warned *"an unpaced probe sweep measures our own rate
  limit, not the providers'"* — and it caught us again anyway, this time
  because a session of back-to-back test turns walked into it. Sol's earlier
  refusal to demote the seat on two observations was right.

- **The shadow probe finally answered its question, and the answer is
  `emitted=0 unparsed=0` across seven seats.** Nobody requested a tool and
  nobody even TRIED — no text the parser had to reject. This is not a parsing
  problem and no wording of the nudge fixes it. Weakened only by the probe
  question not needing a tool.

  **And the probe has a structural blind spot worth knowing before anyone
  leaves it on for a day: the router intercepts every question that needs
  current information, so the council only ever sees questions that do not need
  a tool.** The probe cannot observe the cases the feature exists for.

- **`11d4a9b` + the wiring — SEEDED SEARCH, off by default behind
  `COUNCIL_SEEDED_SEARCH=1`.** The response to the probe. Seats fail at
  AUTHORING a call; nothing suggests they fail at SELECTING from a list, and
  `read_file` already proves the selecting half works. With the flag on, a
  router-classified search question goes to the COUNCIL with the router's first
  query already executed through the registry, so a seat's only job is to pick
  an id to read. Seeded results are enveloped as untrusted, stay out of system
  position, count against tool time and the unique-call budget but not the round
  budget, and `web_search` is hidden from the prompt so the only move available
  is one `read_url`.

  **The whole search branch is skipped rather than half-run** when the flag is
  on: `comprehensiveSearch` fans out to five providers plus Wikipedia, and
  paying for that AND a council is the cost mistake the experiment exists to
  avoid. The loop runs one provider chain instead.

  **Off is the honest default.** The router path it replaces is measured good —
  2 router calls plus one streamed answer, 22 cited URLs — and this spends a
  council on the same question. It is an experiment with an env var in front of
  it, and it does nothing at all unless `COUNCIL_TOOLS=1`.

1040 backend tests green.

## Not a bug, a missing feature

**There is no `create_project` tool and no project-creation path in the repo.**
`grep -rn "create_project\|createProject"` over `backend/` and `frontend/src`
returns nothing; the registry is `web_search`, `read_url`, `read_file`,
`search_specialized`. Any request to "create a project" cannot be served today.

---

# Handoff — 2026-08-13 (third pass): read_url stopped being a URL tool

`d7cf174`, `8a62cc2`, `4082620`, `5b1fef2`, on top of `09fa8ef`. Backend
1012 tests green. Frontend NOT re-run — nothing in this pass touches it.

**`COUNCIL_TOOLS` HAS NOT BEEN FLIPPED, and the reason is now a gate rather than
a delay.** The whole pass exists because turning the tool loop on with
`read_url` accepting a model-authored URL was the shape Sol ranked highest in
`docs/attack-surface-sol.md`: a fetched page tells one seat of seven to encode
the conversation into `https://attacker/collect?d=…`, and the fetch IS the
exfiltration.

**`read_url` no longer accepts a URL.** Every search result is minted a
per-turn UUID in the registry; the tool's schema is `{ id }` and the lookup
happens BEFORE DNS validation, so a forged argument cannot even reach a
resolver query. This is the same split `read_file` already used, which is why
it needed no new machinery — the ids sit next to the results the model can see,
and the URL it cannot author is resolved server-side. Provenance matching (the
previous defence: accept a URL only if this turn's search returned it) was
replaced rather than kept, because it still let the model type a host.

**Luna's adversarial review of `09fa8ef` is `docs/review-read-url-luna.md`, and
it earned its keep.** Five findings, four of them from runtime probes rather
than from reading. The one to remember:

- **The pin was advisory whenever Node reused a socket.** `http.request()` with
  the implicit global agent, keep-alive on in this runtime, will hand back a
  pooled same-origin socket WITHOUT calling the `lookup` callback. Luna's probe
  sent a request pinned to server B down the socket connected to server A. Every
  test in the file made one request, and a single-request test cannot see this.
  `agent: false` now, deliberately, for a reader this small.
- The guard's refusal text carried the resolved address (`… resolves to
  169.254.169.254`) straight back into the council prompt — a private-network
  map handed out one refusal at a time. `UrlBlocked` now carries a separate
  `modelMessage`; the address stays in the log and in Sentry. Every other path
  in the registry that echoed `err.message` was redacted in the same pass.
- `maxRedirects: 5` bounded redirect EDGES, so six connections were made. The
  ceiling is `maxHops` now and counts the initial request.
- The character ceiling was UTF-16 code units, so a page of emoji was cut in
  half and could end on an unpaired surrogate. Counted in code points now.
- `truncated` was true for a body that ended exactly at the limit.

**What this does NOT close.** `UNTRUSTED_PREAMBLE` is still unmeasured. A
copied `tool_call` fence still spends a round and can still name any other
tool. The id gate is `read_url`'s, not the loop's — **the next tool added does
not inherit it**, and that is the thing to remember when one is added.

---

# Handoff — 2026-08-13 (second pass)

State of play: the owner's six-item list from the 2026-08-13 session. Five
shipped; the sixth is a design document. Backend 931 tests green, frontend 675
green, both re-run after the last edit.

**`migrations/015_answer_cache.sql` HAS NOT BEEN APPLIED.** Until it is, the
answer cache runs in-process only, which means every Render deploy empties it —
and Render deploys on every push, so in practice it is empty most of the time.
The feature is correct either way and logs one line naming the file. Applying it
is the single action that makes this session's biggest win actually land.

## What shipped

1. **The arithmetic grammar widened.** Exponents in every spelling, sqrt/cbrt,
   sin/cos/tan and their inverses and hyperbolics, ln/log/log2/log10/exp,
   abs/floor/ceil/round/sign, factorial, mod, π/τ/e, degrees and radians,
   superscript runs (`2¹⁰`, folded as a RUN — folding per character gives
   `2^1^0` = 1), and `x` as multiplication where it cannot be a variable. The
   owner's two reported failures were `185 x 3 plus 100 divided by 2` (the `x`)
   and `200 multipled by 6` (a typo, still refused, correctly). "divided by"
   was never broken — measured before changing anything. See AGENTS.md for the
   float lane's contract.

2. **The answer cache.** `lib/answer-cache.js`, `migrations/015`. Shared across
   users, keyed by question + language + country + plan + detail flag, refused
   entirely for any turn that read something about the person asking. Read
   before the router's two model calls, so a hit costs zero OpenRouter requests.
   AGENTS.md has the safety contract; do not touch it without reading that.

3. **The Wikipedia dead end.** `lib/wiki-relevance.js`. See AGENTS.md.

4. **Sun in light mode, moon in dark.** `Sun.jsx` beside `Crescent.jsx`, both in
   the DOM, the stylesheet chooses. The `.light .earring-wrap { opacity: 0.5 }`
   rule is gone — the light ornament was being muted because it was the wrong
   ornament, not because it was too loud.

5. **Privacy policy and terms updated** for the answer cache: what it stores,
   what it refuses to store, the three shelf lives, a legal-basis row, a
   retention row, and a plain sentence in the terms saying output for a
   non-personal question is deliberately not unique.

## What did NOT ship, and why

**Plugins.** `docs/PLUGINS-PLAN.md` is the design. It is four layers — a
credential vault, a manifest-driven registry, a SELECTOR, and the panel — and
the third is the one that decides whether the feature makes the product better
or slower. Every tool's description goes into every seat's prompt on every turn;
"dozens of plugins" is that cost with a UI on it. Do not build the registry
first and the selector later, and do not start with Gmail because it demos well:
it has the only irreversible action in the set.

---

## Previous handoff — 2026-08-13 (first pass)

State of play at commit `6ce9c1b` on `main`, pushed — local and `origin/main`
are level, nothing is being sat on. Read `AGENTS.md` first; this file is what
changed and what is still open, not a description of the project.

729 backend tests and 673 frontend tests are green at `6ce9c1b`, both re-run
2026-08-13. `6ce9c1b` IS LIVE — `GET /health` on `alop-ai.onrender.com`
returned that SHA at 2026-08-12T23:47Z.

**Do not re-derive the deploy diagnosis from 2026-08-12.** Two `Monitor`
watches on `56260aa` and `ecf6911` both expired after 30 minutes with the
commit not live, and the session concluded auto-deploy was off. The commits
did land afterwards. Which of the two happened — a manual deploy, or an
auto-deploy slower than the watch — was never established, and the earlier
conclusion is recorded here as UNPROVEN rather than as fact. If a deploy looks
stuck again, read the Render dashboard rather than inferring from a timeout.

The sections below dated 2026-08-12 describe the OpenRouter migration and were
written at `2306cf8`. Everything after that commit — the request budget, the
per-user rate-limit fix, the search-planner and tool-call-leak fixes, the
Unicode maths fix, the composer moon, the health commit report — landed after
this file's body was last revised. `git log 2306cf8..HEAD` is the authority on
that window; the prose here is not.

**A previous handoff went stale in the worst way**: it still described the
Clerk migration as "deliberately NOT attempted" three weeks after it had merged,
so anyone reading it as current state would have re-planned finished work.
Dated section headings and commit SHAs exist to stop that. If you change
something this file describes, change this file in the same commit.

---

## The arithmetic fast path, and what a turn actually costs (2026-08-13)

`backend/lib/arithmetic.js`, landed at `1765e93`, with ten defects found in
review and fixed at `38d7ffc` — read that commit message before changing this
file, because most of what it fixed looks like an improvement to re-introduce.
A sum is answered in-process and never reaches a model. The owner's report was that "80 squared" and "21600
cubed" took as long as a hard question, which they did: the router rated both
`moderate`, so three seats were polled non-streaming and then synthesised.

**Its position in `/api/council` is the feature, not an implementation detail.**
Above the router, above the spend and request reservations, above every model
call. A test asserts that order against `server.js` as text, because a fast path
that runs after the router still returns the right answer and saves nothing —
no other test in the suite would notice. If you move it, that test is the one
that should stop you.

**It refuses far more readily than it answers**, because nothing downstream can
disagree with it. One unknown word refuses the whole message; there is no way to
express a partial parse. Luna produced forty adversarial inputs before the code
existed and they are now the test file. The four worth knowing, because they
look computable and are not: `15% off 80` means 68 to a person and is not
`15% of 80`; `why is 15% of 80 the same as 80% of 15` is a reasoning question;
`80 squared metres of carpet` is a unit; `what is 2 + 2 in binary` is asking for
a representation. Arabic-Indic digits fall through on purpose — answering
`٤٢ + ٨` in Western digits answers in the wrong script.

**The review is the part worth reading.** Three of the ten would have reached
users: `15% of 80 + 2` answered 12.3 because "of" swallowed the rest of the
line; `2026-08-13` answered 2005 and `555-0100` answered 455, because a date
and a phone number tokenise as arithmetic; and a quota-exhausted account
returned 503 to `80 squared`, refusing an answer that costs no quota. The first
two are the same lesson — the parser was right about arithmetic and wrong about
which STRINGS are arithmetic — and it is the lesson to carry into any widening
of the grammar. A leading zero now means "this is a label, not a quantity",
which is the cheapest reliable signal there was.

**Do not "simplify" the rationals to floats.** Every value is a BigInt
numerator over a BigInt denominator. That is what makes `0.1 + 0.2` exactly
`0.3`, `21600³` exact rather than `1.0077696e+13`, and division by zero a
denominator test rather than an `Infinity` that would have been rendered and
shipped. `=` means exact and `≈` means rounded, and the distinction is load
bearing.

### WHAT A TURN COSTS IN REQUESTS — Sol's count, 2026-08-13, against the 50/day

Reasoned from the code, not measured from a bill:

| turn | OpenRouter requests |
| --- | --- |
| arithmetic fast path | **0** |
| greeting | 1 |
| simple council | 2 router + 1 seat + 1 synthesis = **4** |
| moderate council | 2 router + 3 seats + 1 synthesis = **6** |
| complex, pro roster | 2 router + 7 seats + 1 synthesis = **10** |
| search or memory | 2 router + 1 streamed answer = **3** |

That is what "roughly five turns per day" meant, itemised. Two of every
non-greeting turn's requests are the router's own — `isMemoryOrReferenceQuestion`
and `getSearchQuery` — before a single seat is asked anything.

### The optimisation plan, ranked, NOT IMPLEMENTED

Sol's, on the explicit constraint of not making the product dumber. Recorded
here so the next session does not re-derive it. Nothing below has been built.

1. **Measure first.** Every later change is guesswork without per-tier request
   counts and p50/p90 latency. Note while doing it: `medianMs` in `server.js` is
   **not a median** — it is one hand-recorded sample per seat from 2026-08-12,
   taken at `max_tokens: 200` while seats run at 1000, and `narrowRoster` ranks
   the roster with it. Provider drift can pin it to yesterday's fastest seat
   forever.
2. **Combine the two router calls into one structured call.** Saves 1 request on
   nearly every turn. Little latency change — they already run in parallel — so
   this is a quota win, and the risk is coupling: one malformed response damages
   both decisions. Needs a frozen routing corpus before it ships.
3. **Skip synthesis when the router dispatched exactly ONE seat**, streaming a
   final-answer call instead. Simple turns go 4 → 2 requests. The router's
   comment that quorum cannot be 1 argues about a multi-seat council and does
   not cover this case. The risk is real: the synthesis prompt carries the
   length rule, the no-invented-facts rule and the formatting rules, so a direct
   call has to inherit them deliberately rather than by accident.
4. **Everything touching seat counts comes last**, and only with quality data.

**Refused, with reasons — do not re-propose these as wins:**

- *"Stream the seats."* The wait is the k-th usable completion, not the
  transport. The synthesiser reconciles whole drafts; it cannot reconcile text
  that does not exist yet. This is in the loose-ends list above as "the real
  fix" and that entry is now considered wrong.
- *Quorum 1 on a multi-seat turn.* Synthesis becomes a paraphrase of whichever
  model finished first, and fast correlates with small.
- *Cutting moderate to one seat, or complex to the three fastest.* A capability
  cut wearing an optimisation's clothes.
- *Lower token ceilings.* Saves no requests and truncates drafts.
- *A model call to classify complexity.* Spends the budget it exists to protect.

---

## OpenRouter migration (2026-08-12)

The model layer moved from the Ollama-shaped gateway to OpenRouter. The
frontend roster, backend environment names, admin configuration reporting and
privacy policy now use `OPENROUTER_HOST` and `OPENROUTER_API_KEY`; the deployed
policy copy was updated alongside the source. The seven seats are:

`nvidia/nemotron-3-super-120b-a12b:free` (NVIDIA, 0.2, Pro),
`inclusionai/ling-3.0-tiny:free` (InclusionAI, 0.3, free),
`openai/gpt-oss-20b:free` (OpenAI, 0.4),
`poolside/laguna-s-2.1:free` (Poolside, 0.5),
`google/gemma-4-31b-it:free` (Google, 0.6, Pro),
`google/gemma-4-26b-a4b-it:free` (Google, 0.7, free), and
`nvidia/nemotron-3-nano-30b-a3b:free` (NVIDIA, 0.8, free).

The measured candidates rejected from this roster were:

- `nvidia/nemotron-3-ultra-550b-a55b:free` — never answered inside 30s on five attempts; the council whip is 30s.
- `liquid/lfm-2.5-2.6b:free` — 15.9s with empty content; its model card permits retaining prompts and outputs to train Liquid's models, disqualifying it under the subprocessor-naming privacy policy.
- `nvidia/nemotron-3.5-lightning:free` — answered in 7.2s but leaked its scratchpad into the answer despite reasoning exclusion.
- `nvidia/nemotron-nano-9b-v2:free` — 11.1s with empty content.

Live constraints: free-model requests are rate limited per minute and per day
on the zero-credit account. A 429 from an upstream provider is transient and
is retried.

### THE DAILY CAP IS THE PRODUCT'S BINDING CONSTRAINT, AND IT IS THE OWNER'S CALL

**50 model requests per UTC day, per ACCOUNT, shared across every user.**
MEASURED, from a live response body rather than from the docs — the rendered
docs page carries the table client-side and scrapes empty:

```
X-RateLimit-Limit: 50   X-RateLimit-Remaining: 0
limit_source: openrouter_free_tier_daily
"Add 10 credits to unlock 1000 free model requests per day"
```

A council turn spends seven seats plus synthesis plus the router's short calls,
so **the whole product gets roughly five turns per day.** Probing the roster
exhausted 2026-08-12's allowance, which is how the number was found.

$10 of credits raises this to 1000 requests/day — about a hundred turns — and
the models still cost $0, because the roster is entirely `:free` ids. That is
one purchase, not a per-token bill. **It is the single decision that decides
whether this product is usable, and it belongs to the owner.**

Until it is made, `/api/council` refuses with a 503 and a `Retry-After` the
moment the cap is observed, before the telemetry row and before the spend
reservation. The latch lives above `callModel` in server.js; the reason it is a
latch and not a plain catch is written there.

**THE DOLLAR CEILING NO LONGER DESCRIBES THE REAL CONSTRAINT.** `spend.js`
meters $5/day and $20/month, and every model call now costs exactly $0, so that
ceiling cannot bind on models — only on search and page fetches, which do still
cost money. The binding constraint became REQUESTS, account-wide. Sol's
recommendation, unimplemented on purpose because the numbers are the owner's:
keep the dollar ceilings as protection in case a paid model ever returns, and
add a separate account-wide request allowance that reserves request units before
a turn, reconciles against `GET /api/v1/key` periodically, and degrades the
council size or refuses explicitly when fewer than the required requests remain.
Do not delete the dollar ceiling to "simplify" — it is the thing that still works
if one seat is ever swapped to a paid model.

### Two things not to re-derive

**An unpaced probe sweep measures our own rate limit, not the providers'.** The
first sweep produced 429s on six models and every one was `free-models-per-min`
— ours. Pace requests 5s apart before concluding anything about a provider. Two
models still 429'd when paced (`gemma-4-31b`, `gpt-oss-20b`); those are real
contention and are retried rather than dropped, because both had healthy samples.

**Latencies were measured at `max_tokens: 200` and the council runs at 1000.**
Generation time is roughly linear in tokens, so the numbers in server.js are a
FLOOR, not a prediction. `nemotron-3-super-120b` at 23.9s measured is the seat
this matters most for against a 30s whip — it is a Pro seat and quorum is 3, so
the fast seats close the room without it.

### Loose ends, stated rather than tidied away

- `frontend/src/__tests__/useChats.test.jsx` "removes the row before the server
  answers" failed once in a full-suite run and passes in isolation and on a
  re-run of the full suite. Load-dependent flake, NOT caused by this migration —
  checked against pre-migration `940e457` in a scratch worktree. Unrelated to
  the model layer; recorded so the next red run is not mistaken for a new break.
- `tools/glm.mjs` is deliberately still an Ollama client. GLM is not on
  OpenRouter's free tier, and it is a dev-only diff reviewer, not part of the
  product's model layer. It is the one remaining Ollama dependency in the repo.
- `og.png` is a build artifact of `og.svg`. Confirm it was regenerated, or the
  link preview still shows the old temperature ladder — that is the copy of the
  roster the most people see and the only one invisible from inside the app.
- A peer briefly amended Claude's commit `09cee07` to fold in its own
  `tools/or-probe.mjs`, producing `43dafd3`. It then reset that away itself and
  committed the probe separately as `f4db050`, so history is clean and every
  commit is single-authored — `43dafd3` is in no branch. Recorded only as the
  near-miss it was: in a tree three agents are writing to, stage file by file and
  never amend a commit you did not make. Verified with `git merge-base
  --is-ancestor`, after an earlier note in this file asserted the amend had
  landed on the strength of the reflog alone.

---

## The one thing to read before touching the frontend

**The empty-state ornament set is the specification, and it has now been
reverted to twice.** Two hanging crescents in the gutters, the asanoha lattice
across the chat surface, a centred hero, and the starters as a 2x2 card grid.
The torii is gone — `CouncilRosette` replaced it, and the logo mark now sits
inside the rosette's centre hole.

**EVERY BRANCH CAME OFF ON 2026-08-11**, on the owner's instruction: "leave the
earrings, just delete the branches." The top pair went first as a declutter and
the rest followed in the same breath — all four corner sprigs and their four
hand-authored variants, the `Leaf` helper, the `Corner` component,
`SakuraFrame` itself, and the bough and falling petals that were only ever on
sign-in. `SakuraBough.jsx` is deleted. `SakuraBaseCorners` is the keystone
alone. The dead CSS went with the markup rather than being left to rot.

What remains is the family's harder half, and it is the half that was carrying
it: the crescents, the keystone, the seal, the composer skyline and the lattice.
The branch was the part that said "Japanese" without saying anything about THIS
product — the same charge that retired the torii. **Do not redraw it.** If a
screen needs more, it needs it from the marks that mean something here.

Everything else in this section still stands in full. The cut was inside the
family, not a licence to edit it.

Five redesigns were tried and all five rejected: one wooden bough replacing the
four sprigs; that bough moved to the bottom right; an ensō drawn as seven
overlapping arcs; a split layout with the council roster as the right column; a
day/night sky with a crescent and stars against a sun.

Several were argued for by the design skills this repo is worked on with, which
name centred heroes and grids of equal cards as anti-patterns. That did not
settle it and should not next time. This is a personal product with one owner
and his taste is the specification. **Do not "fix" the centred hero or the card
grid on the strength of a general design rule.** If a redesign is wanted it will
be asked for, and it will be asked for in terms of this ornament family rather
than in place of it.

The revert was done by restoring the design-owned files from `c513df7` rather
than by reverting five commits, because non-design work had landed in the same
files. If you ever need to do it again, that is the shape of it: check
`git log <base>..HEAD -- <file>` per file before restoring anything wholesale.

---

## How the three of us split the work (2026-08-11)

Recorded because it was got wrong twice in one session, and because the wrong
version leaves a precedent that looks like practice by the next reading.

- **Claude and sol plan, design and code.** Sol is the senior peer on
  substantive work and is not to be spent on petty jobs.
- **Luna executes**: pushing, committing, bug-hunting, the smaller tasks, and
  reviewing. It may pitch in on bigger work, but that is the exception. Luna
  has push authority — do not sit on a green branch waiting to push it yourself.
- **Bug-hunting and reviewing belong to everyone.** That list is who OWNS a
  beat, never who is allowed on it. The deepest finds this session came from the
  design pair, not the executor: sol found two synchronous-throw crash paths, a
  money leak in the dedupe, and five hover rules Claude had missed; Claude found
  a duplicate-render race in a peer's split. Never answer "that is luna's job"
  about a bug or a review.
- Review cannot come from the author, so when luna wrote the code, sol reviews
  it. That is the three-eyes rule breaking a tie, not sol changing seats.

**THE MISALLOCATION, so the precedent does not survive this file.** The
AbortSignal propagation and turn-telemetry work was given to LUNA, and it should
not have been: threading cancellation through five layers and designing a
telemetry system is architectural work, which belongs to sol and Claude. It was
assigned before the split above was set, and it was allowed to finish because it
was healthy and nearly done — killing it would have burned real work to make a
point. **From the next dispatch forward, architectural work goes to sol and
Claude.** If you are reading this and about to hand luna a cross-layer refactor
because "that is what happened last time": that is the precedent this paragraph
exists to kill.

The full protocol — invocation, the ~23k dispatch floor, file partitioning —
lives in `~/CLAUDE.md` under "Peers" and the `codex-duo-protocol` memory file.
Named rather than numbered on purpose: the rules were renumbered the same day
this line was written, and a number is the part that goes stale silently.

**How it was arrived at**, kept here rather than in the rule, because a rule
that carries its own history stops being readable as an instruction.

The split was got wrong three times in one day. First Claude delegated only
REVIEW while keeping every piece of execution, which took the owner saying it
twice — the second time as "you are fucking peers… you have friends, workers
amongst you." That was not a refusal to delegate: two peers ran all session and
found four real defects. It was handing them the errand and keeping the work.
Reviewing a diff is the errand; building the thing is the work.

Then the effort levels were set backwards. Sol was made the cheap default
worker at `low`, which inverts the allocation above — sol is the senior peer
and should be dispatched rarely, for something substantial. Before that, the
rule claimed sol needed `medium` for reviews because review is an unbounded
search. **That was a prior asserted as a measurement.** Sol has never been run
at `low` on a review here; the owner asked for the evidence and there was none.
If it matters again, test it rather than asserting it.

Third was the AbortSignal misallocation recorded above.

What has worked, every time it was tried: partitioning by file before dispatch
(zero collisions across four concurrent runs), and telling peers plainly they
may disagree and do it their way. Luna found a real defect in one of Claude's
fixes that way; sol found two synchronous-throw crash paths, a money leak in
the dedupe, and five hover rules Claude had missed after Claude claimed to have
found them all.

---

## SEAT HEALTH IS UNKNOWN, AND THE ALARMING NUMBER WAS MEASURED ON THE WRONG
## ROSTER (2026-08-11)

**Retracted before it could be acted on.** This section briefly read "THE
COUNCIL IS DELIVERING ONE SEAT OUT OF SIX" and named it the top priority. That
claim does not survive its own evidence, and the retraction is left visible
because the mistake is more instructive than the correction.

**What was measured.** A local telemetry run reported 5 of 6 seats timing out
on every turn, naming `qwen3.6`, `gemma4`, `qwen3-coder`, `gemma2` and
`mistral-nemo`, with only `glm-5.2` answering.

**Why it does not mean what it looked like.** Four of those five ARE NOT IN THE
COUNCIL. The roster in `server.js` is `glm-5.2`, `kimi-k2.7-code`, `qwen3.5`,
`gemma4`, `deepseek-v4-pro`, `nemotron-3-ultra`, `minimax-m3`. This machine's
Ollama serves exactly one of them — `gemma4` — plus `glm-5.2:cloud` under a
different tag. It has none of `kimi-k2.7-code`, `qwen3.5`, `deepseek-v4-pro`,
`nemotron-3-ultra` or `minimax-m3`. The models that "timed out" are local
odds and ends that happen to be installed here.

So the run measured a substitute roster on hardware that cannot serve the real
one. It is not evidence about production seat health in either direction — the
council may be perfectly healthy in production, or badly broken, and this says
nothing either way.

**Why the production probe could not settle it either.** This runner has no
`OPENROUTER_HOST` and no `OPENROUTER_API_KEY`; `backend/.env` does not carry them. The
gateway cannot be reached from here at all, so no measurement made on this
machine can speak for production.

**What IS established, and is worth keeping:**

- The request shape is not the problem. `{ model, messages, stream, options:
  { temperature, num_predict } }` was accepted by every model that responded —
  no 400s on options, roles or structure. That kills the malformed-request
  hypothesis for good.
- Locally, three models produce no token within 35–60s and `gemma4` cold-starts
  at 33.4s against a 30s whip. On hardware like this, a cold seat cannot make
  the whip. Whether the production gateway behaves this way is unknown.
- A model the gateway does not serve and a model that is merely slow look
  IDENTICAL from inside the whip and need opposite fixes. That distinction is
  the thing any real probe has to establish first.

**The one action that would settle it**, and it needs the owner: an
authenticated probe of the real `OPENROUTER_HOST` using the seven roster names and
the exact payload above, measuring TTFT per seat over several runs. Until that
exists, do not remove seats, do not raise the whip, and do not repeat the
"one seat in six" number — it measured something else.

---

## This session (2026-08-12) — cancellation landed, then reviewed for state

`2306cf8`, backend. The `AbortSignal` work that this file had queued "for a
session of its own" is done: the signal is threaded through
`settleByDeadline`, `askMember`, `callModel`, the registry executors and the
provider fetches, and cancelled on deadline and on quorum release. Stragglers
are now cancelled, not merely ignored.

The part worth remembering is the review brief, because a weaker one would have
passed this. Sol was asked to trace **what the state IS at each layer while an
abort propagates**, not whether the abort fires — and the named failure turned
out to be reachable: a seat released by quorum could still land its answer and
reach synthesis. `settleByDeadline` now marks the round resolved BEFORE
aborting the layers below it, closed for all four orderings (quorum-first,
abort-first, late-fulfilment, late-rejection). Three more came out of the same
pass: a provider body closing without Ollama's `done: true` frame was persisted
as a complete answer rather than an error, `signal || settleSignal` in the
search cache dropped the local deadline whenever a parent signal existed, and
quorum-during-a-round reported `stopReason: null` where the preflight path
reported `"quorum"`.

624 tests green. Each fix was reverted individually and its regression test
watched to fail before being restored.

---

## This session (2026-08-12) — the spend ceiling, and three bugs found in review

$5/day, $20/month per user, the owner's figures. It closes the half of Sol's
finding 2 that the rate-limiter fix could not: limits key on the authenticated
user now, but a request rate is not a spend ceiling.

**Priced from the telemetry the turn already produces.** Nothing here meters
tokens, so a real bill cannot be computed; what the app knows exactly is how
many model and tool calls a turn made, because `turn-telemetry` counts them for
the latency work. `lib/spend.js` is the pure cost model, `014_user_spend.sql` is
the ledger, every rate is a `SPEND_*` variable. **These are estimates and the
file says so** — a safety net, not an accounting system. Someone should compare
them against the provider dashboards; that is what the variables are for.

**Reserved, not charged.** Admission commits to a number before knowing what the
turn will do, reserves the pessimistic worst case, and refunds the difference in
the `finally`. Charging afterwards would make it a report. The reservation is
atomic in Postgres — increment, test, undo in the same transaction if refused —
so a refused caller is not charged for the refusal and two concurrent turns
cannot both read an under-limit balance.

Worst four-round-plus-fallback turn and its reservation are both **20c exactly**;
a typical turn settles to 4c, so about 125 turns/day and 500/month.

### The three bugs, all mine, all on the money path

Luna's tests exposed two and, as briefed, fixed neither. `priceTurn(null)` threw
— a default parameter fires on `undefined` only, and a partial turn is exactly
where a null appears. `reservationCents('x')` returned NaN, which is the worst
possible value here: **every comparison against a limit is false for NaN**, so
the ceiling would have admitted everything while looking like it worked.

Sol found the third and it was load-bearing: **the reservation was not an upper
bound on the turn price.** `recordSeat` pushes one record per member PER ROUND —
the record carries a `round` field for exactly that reason — so four rounds
against seven seats is 28 seat records, and the reservation priced 14. Chasing
it surfaced the real defect one level down: `priceTurn` priced the fallback
council off `seats.length`, the accumulated total, when the fallback is one more
run of the ROSTER.

**Luna's coverage test had passed over it**, modelling four rounds of tool calls
against a single round of seats — the intuitive reading of "a seven-seat turn",
and not what the loop records. Both halves were the same wrong assumption, made
independently by two of us. If the reservation had stayed under the real cost,
concurrency would have walked straight past the ceiling.

### Open on the ceiling

- **Only `/api/council` is metered.** `/api/overlay`, `/api/chat-title`,
  `/api/speech` and `/api/feedback` all call models and none of them reserve.
  A first cut, not a finished job.
- **Fails open** on a database error, inheriting `pg-rate-limit-store.js`'s
  argument. The calculus is not identical — a rate limiter failing open costs a
  window of abuse, this costs money — and it is flagged for Sol rather than
  settled.
- **The prices are uncalibrated.** Nobody has compared them to a provider bill.

---

## This session (2026-08-12) — an attacker's read of the app, and three fixes

The owner asked for the app looked at "like a hacker would think". Sol did the
review under an authorised, bounded brief — read-only against production, no
fuzzing, no payloads. Full document in `docs/attack-surface-sol.md`, and it is
worth reading whole: it ranks by what an attacker GAINS, and it says plainly
what it could not check.

Its executive judgement, which reframes the whole surface: **the valuable attack
here is not shell access, it is getting one council seat to turn private prompt
context into an outbound URL.** The tool set is read-only, capped, and has no
write or execution primitive, so an injected page cannot alter Supabase or take
a tenant. It can still cost confidentiality, an answer nobody asked for, and
paid calls.

Three findings fixed today. Each was verified in the source before being
believed, and each fix was reverted and watched to fail.

**Every rate limit in the file was an IP limit wearing a user limit's clothes.**
`rateLimitKey` prefers `u:<userId>` and falls back to IP, and its own comment
said the quiet part — "Only routes that run their auth middleware before the
limiter will have it." None did: `clerkMiddleware` was mounted about a hundred
lines BELOW the limiters, so `req.auth` never existed at limiter time. One valid
account rotating source addresses collected a fresh 30-per-minute council
allowance per address, and a council turn is seven paid model calls plus search
plus a possible fallback whip. The mount moved above the limiters; nothing else
changed, because `rateLimitKey` had been written for this and was waiting.
`middleware-order.test.js` pins it, because **no unit test can see this** — the
function passes either way when handed a `req` with `auth` set, and the defect
is the order of two `app.use` calls.

Still missing, and NOT smuggled in: a per-user SPEND ceiling. There is only a
request rate. A user inside 30/minute can still run the bill up; they just
cannot multiply themselves across addresses. Sol's proposal is an atomic
reservation against a daily budget before the first provider call, refunded on
completion. That is a product decision about money and it is the owner's.

**`/api/feedback` called a paid model with no suspension check.** Every other
paid route carries `checkSuspended`; this one had `requireAuth` alone while
invoking `FAST_MODEL` on every rating. A suspended account with a live Clerk
session kept spending — suspension was not the kill switch it is documented to
be. The test asserts the whole paid set rather than the one route, because the
next paid route added is the one at risk.

**`redirect: 'follow'` let the HTTP client outrun `url-guard`.** The link
checker vetted the URL a model produced and then followed redirects
unsupervised. An attacker publishes on a public host, gets it into a search
result, and answers `302 Location: http://169.254.169.254/…`. The check said yes
to the public host and the fetch went to cloud metadata — **every address the
guard refuses was reachable in one hop through a host it allows**, which made
the address list advisory. Now `manual`, with `assertSafeUrl` on every hop,
resolved against the previous URL, capped at four. Tested against a real
loopback redirect rather than a stubbed fetch, because the bug was in what the
client did on our behalf and a stub would only have tested the stub's opinion.

### Still open from that review

- ~~**The DNS-rebinding half of the URL guard.**~~ **Closed in `9c8462a`.**
  `fetchPageHead` now keeps the `{ address, family }` returned by
  `assertSafeUrl` and `pinnedFetch` connects to that exact address while retaining
  the hostname for Host and TLS SNI. Redirects remain caller-managed and every
  hop is revalidated. The backend pin tests cover an unresolvable hostname,
  Host preservation, no automatic redirect following, missing-address refusal,
  and abort propagation.
- **Indirect prompt injection**, ranked highest by Sol and still the queued
  research question. Its concrete shape: a page instructs a seat to encode
  conversation context into `https://attacker/collect?d=…` and call `read_url`;
  one seat of seven complying is enough, and the fetch itself is the
  exfiltration. Sol's proposed fix is structural rather than persuasive — mint
  an opaque ID per search result and let `read_url` accept only IDs, so a model
  that has consumed untrusted text cannot author a host, path or query at all.
  That is worth more than any wording of `UNTRUSTED_PREAMBLE` and it is the
  first thing to try when this is picked up.
- **Google API credentials travel in query strings.** Not a repo leak, but
  query credentials survive in outbound proxy and tracing logs where an
  Authorization header would not.
- **Several handlers return raw `err.message`**, including provider and Supabase
  failures. Sol declined to inflate it into a finding on a public-source app and
  suggested stable public codes with the original kept in Sentry.
- Sol could not verify: live RLS (service-role traffic bypasses it, so no
  source review can prove the policies work for `authenticated`), any
  signed-in route, `COUNCIL_TOOLS` state, or the Perplexity key rotation. It
  found no history evidence of that key, which is not the same as it being safe.

**What is well defended, worth knowing so effort goes elsewhere:** the URL
parser handles decimal, octal, hex and IPv4-mapped IPv6 encodings correctly —
the flaw was always callers discarding its result, never the parser. The tool
loop's blast radius is genuinely bounded: read-only tools, four rounds, twelve
unique calls, per-call and wall clocks, output clamps, untrusted text kept out
of system position, opaque file IDs bound to `(user, chat)`. Route enumeration
found no missing `requireAuth` across 30 routes; `/health` and the
signature-verified Stripe webhook are the only public ones, by design.

---

## This session (2026-08-12) — the CSP finding was aimed at the wrong CSP

Chased `'unsafe-inline'` in `server.js`'s helmet block, on the assumption it was
governing the app's scripts. **It never was**, and the correction is more useful
than the original finding.

**The document CSP is set by `frontend/vercel.json`, on the Vercel response, and
it is already clean.** Measured on live `alop-ai.com`:

```
script-src 'self' https://clerk.alop-ai.com https://challenges.cloudflare.com
```

No `'unsafe-inline'`, no nonce. Loaded production in a browser with a
`securitypolicyviolation` listener attached: Clerk initialised, the app
rendered, **zero violations**. The page ships exactly one inline block — an
`application/ld+json` data block, which is not executable and which `script-src`
does not govern. **Clerk needs neither the inline permission nor a nonce here**,
because it arrives as an external script from an allowlisted origin. Nothing to
fix on the frontend.

**The backend CSP was still worth tightening, for a different reason.** It
travels on JSON and SSE; `server.js` has zero HTML routes, zero `<script>`
tags, no `express.static`, no `sendFile`. So `script-src 'self' 'unsafe-inline'
https://*.clerk.com` was permission for a route that does not exist — dead until
someone adds one, and Express's own error handler already returns HTML. Now
`'none'`.

**And the real find, which nothing was looking for:
`xFrameOptions: 'DENY'` was silently ignored.** Helmet 8 does not accept the
string form, does not warn, and falls through to its own SAMEORIGIN default.
Reproduced locally against helmet 8.3.0:

```
default (no option)                X-Frame-Options = SAMEORIGIN
xFrameOptions: 'DENY'   (ours)     X-Frame-Options = SAMEORIGIN
xFrameOptions: {action:'deny'}     X-Frame-Options = DENY
```

and confirmed on the deployed backend, which was serving `SAMEORIGIN` while the
source read as `DENY`. Impact is small — `frame-ancestors 'none'` in the same
CSP covers every browser that matters, deliberately redundant — but **a line
that states an intent it does not carry out is worse than a missing line,
because it stops anyone looking again.** No grep could have caught it: the
source was not wrong about its intent, it was wrong about the library.

The options moved to `backend/lib/security-headers.js` so
`security-headers.test.js` can mount them on a real express app and read the
headers off a real response. It pins the helmet behaviour itself — if helmet
ever starts honouring the string, that assertion fails and says so. Both fixes
watched to fail. 635 backend tests pass.

**Queued, not done: measuring whether `UNTRUSTED_PREAMBLE` actually works.** The
owner's framing, and it is right: that is a research question, not a fix. It is
the most serious item on `docs/cyber-skills-shortlist.md` and the hardest to act
on — seven models are handed arbitrary fetched web text behind a preamble that
asks them to distrust it, and nobody has measured whether they do.

---

## This session (2026-08-12) — mist, hookify disarmed, sign-in measured

**The cloud bars were the wrong MATERIAL, not the wrong weight.** The owner:
"the bars reading as highlighter means they crossed from one material into
another. Kasumi is grey mist." He asked for half a step back on the alpha, and
the experiment says no point on that ladder works — measured over the composer
card in the light theme, the bars sat at +0.062 chroma; a half step left +0.045,
a full step left +0.030 and returned them to the invisible state that started
this. Both ends of the ladder are wrong in opposite directions because the
ladder is not the axis the fault lives on. `--ornament-mist` is a new per-theme
token: same lightness gap to within a rounding error (dark 0.166 against 0.159,
light 0.186 against 0.187), about a twentieth of the chroma. Verified live.

It is per theme and it is NOT the silhouette, though the light value matches it.
Mist is defined against the card; silhouette is defined against the light. In
the dark theme `--ornament-silhouette` is `#0a0a0a` and mist drawn in it
vanishes outright — a lightness gap of 0.014. Tried, looked at, rejected.

**hookify is installed and three of Luna's four rules had to be disarmed or
loosened before they could stay.** The install and its firing evidence are real
and good — see `docs/hookify-setup.md`. But:

- `block-outside-declared-boundary` shipped `enabled: true` with the boundary of
  the dispatch that wrote it: `.claude/**` plus one docs file. Left armed, it
  denies every write to `frontend/` and `backend/`. The next session would have
  opened to a repo where no source file could be edited, by a rule whose purpose
  is to prevent surprises. Now `enabled: false` with a placeholder pattern and
  arming instructions.
- The two stop gates were bare `not_contains` on the transcript, so a session
  that answered a question could not stop until it had run a test suite for code
  it never touched. Now conditional on the transcript mentioning a source file
  in that half.
- They also demanded one exact spelling, `cd backend && npm test`. The command
  actually used in that same session was `npm test` with the cwd already at
  `backend/`, which is correct and would have been blocked. **The rule passed its
  own false-positive check because it was tested against the string it had
  itself written** — the check tested the author's memory, not the rule.

**The hook rules are NOT in the repository.** `.gitignore:13` ignores `.claude/`
wholesale, so all four `hookify.*.local.md` files — Luna's originals and the
corrections above — exist only on this machine and will not survive a fresh
clone or reach anyone else. `docs/hookify-setup.md` is committed and describes
them, which is the worst of both: a committed document describing local-only
configuration reads as shared setup. If they should be shared, `.gitignore`
needs an exception (`!.claude/hookify.*.local.md`) — the owner's call, since
`.claude/` also holds `settings.local.json`.

**Sign-in, measured rather than redesigned.** Four defects found on the live
page, all fixed:

- **Two `<h1>`s and no `<h2>`** — the thesis title and Clerk's "Sign in to
  ALOP-AI". Clerk's `header` is now `display: none` (confirmed removed from the
  accessibility tree, not merely invisible) and `SignInPage.jsx` supplies its own
  `<h2>`, which also lets the heading differ between sign-in and sign-up.
- **The Pro tags sat 158–167px from the name they qualify**, `margin-left: auto`
  pushing them to the far edge of the ladder — a fourth column of stranded
  words. Now 12px, on the same baseline.
- **The temperature outranked the seat name.** In `--primary` at 0.85 it
  measured 8.36:1 against the page while the attribution sat at 5.62:1, so the
  first thing the eye met on every row was an internal sampling parameter. The
  column stays as texture, one step back instead of one step in front.
- The Clerk card is NOT unthemed — `lib/clerkAppearance.js` is thorough. An
  early read that it was "stock" was wrong.

Checked and NOT changed: the page is already vertically centred (the 112px below
the content is matched by 110px above it), and every small-text contrast on it
passes AA — the legal and plan text at 5.62:1. Both were suspected and both are
fine.

**Sol's critique landed and found the thing that mattered.** Full document in
`docs/signin-critique-sol.md`. Its verdict on the premise is worth keeping: the
1440/1024 steady state is NOT "really bad" — it is authored and coherent with
the app; the complaint becomes true at the information order, the collapsed
layout, and the states around Clerk.

**`/sign-up` had no route to Terms or Privacy, and a test enforced it.** The
component withheld our legal links there on the belief that Clerk renders its
own required consent checkbox with links to both documents. False in this
configuration — measured by Sol and then independently here: zero Terms/Privacy
links in the card, zero checkboxes, no occurrence of either word in its rendered
text. The flow where consent is actually taken was the only one with no route to
either document; sign-in, where the account already exists, had both. A test
asserted exactly that, so the suite agreed with the comment and neither looked
at the page. Fixed in both flows, test inverted and watched to fail.

The rule that came out of it: **our obligations must not be conditioned on what
a third-party component is believed to render.** Its markup changes on their
release schedule, silently, and the failure is invisible from inside this repo.

**The loading slot now says which state it is in** — a 700ms grace period, then
"Preparing secure sign-in…" with `role="status"`. Before, a blank 342px well sat
there with nothing to separate "on its way" from "failed" until the ten-second
down-state. Two timers, because those are different questions.

### Open from Sol's critique, not done

- **The narrow-viewport information order is backwards.** At 768 and 320 the
  auth card renders above the product headline, so the first consequential
  choice precedes the first product sentence — and DOM order is still thesis
  then card, so sighted and screen-reader users get opposite sequences. Sol's
  fix is a `grid-template-areas` split of the thesis into `signin-intro` (title
  + tagline, before the card) and `signin-proof` (ladder + seal, after it). Real,
  and a bigger change than the commit that carried the legal fix should have
  taken on.
- **Sign-in cannot render Bamboo Day at all.** With `prefers-color-scheme:
  light`, `.signin-root` still resolves `--bg: #0a0a0a` — it has no
  `.app-root.light` ancestor — and Clerk is pinned to `baseTheme: "dark"` with
  hex variables. Every screenshot of this page, including today's, is one theme.
  Describe it as Sakura Night-only until the saved `alop-dark-mode` choice is
  threaded through the signed-out gate.
- **`gallery.html` has no sign-in, sign-up, loading or down frames**, which is
  why these defects survived: every visual check ran against a fixture that does
  not contain the page.
- **Sol's surprise, not built**: a seven-bar seat meter above "3 models free.
  All 7 on Pro." in `--ornament-mist`, free seats at mid and Pro-only at faint.
  Cheap, and it explicitly uses mist rather than pink "because brand pink at the
  same visibility would read as highlighter" — the lesson from the composer
  travelling on its own.
- The council ladder announces each row starting with an unexplained decimal.
  Sol proposes a visually hidden scale description; the numbers are already
  demoted visually but a screen reader still meets them first.

---

## This session (2026-08-12) — the weather, and a green suite over a broken build

The owner asked for the sun at middle-left with clouds, for the design to be
more visible, and for the background lines, which go thin and hard to see in
both themes. He also said "surprise me", and asked that the three of us make the
idea together. Sol and Luna each wrote an independent proposal without seeing
the other's; both are committed as `docs/design-proposal-sol.md` and
`docs/design-proposal-luna.md`, and the implementation is a synthesis, not
either one.

**Where they agreed, that is the finding.** Both independently moved
`.composer-clouds` from `--ornament-a-faint` to `--ornament-a-mid`, having each
found the bars present in every screenshot and needing to be hunted for. Done.

**Where they disagreed, one of them was measuring the wrong machine, and it is
worth knowing why.** Sol measured `devicePixelRatio = 1.25` and Windows
`AppliedDPI = 120`, diagnosed subpixel smearing, and A/B'd it: doubling the
lattice mixes to 16%/12% at 1px made the smear darker and left it a smear, while
holding the mixes and widening the band to 1.6px made it crisp. Luna measured
DPR 1, concluded the fault was alpha, and proposed new per-theme lattice tokens.
Luna's DPR came from a Playwright browser at the default `deviceScaleFactor` of
1 — **the instrument reported its own configuration, not the machine.** I
measured 1.25 twice independently before choosing. The width fix shipped; the
alpha is untouched, which also keeps the banding tuning in that rule intact.

`--lattice-line` is on `:root`, not on `.chat-main::after`, because the asanoha
is drawn twice — the transcript and `.signin-lattice` — and two copies of one
pattern get one definition of how thick its line is.

**A unit inside an SVG transform is a user unit, not a CSS pixel**, and Sol's
proposal was written as if in pixels. Measured in Chrome at this viewBox,
`translateX(74px)` on the weather group moves the disc 60.3 CSS px. The
behaviour was right and the stated magnitudes were not; the comments now say so
at both sites, because this is exactly the kind of number the next person
"corrects".

Shipped: sun and clouds in one `.composer-weather` group under a bounded
`clamp` shift — measured at 28% across the visible strip at a 1068px window,
against 16% before, and unchanged at 380px where the composition already worked.
Seven cloud bars, one per council seat, four approaching and three answering,
which is Sol's surprise and the only thing here nobody asked for. Verified in
the browser rather than asserted: 7 bars, nearest 6.3px clear of the disc,
`--lattice-line` resolving to exactly 2.000 device pixels, cloud opacity 0.26.

### The part that matters more than the design

**The full frontend suite passed, 636 green, while App.css was returning 500 and
the app mounted to an empty body.** An unterminated comment in decoration.css
made PostCSS refuse the file. The cascade snapshot did not notice, and it could
not: `readStylesheet` inlines the @imports as text and hands the result to
jsdom's CSSOM, which is specified to DROP rules it cannot parse rather than
raise. The broken file arrived as slightly fewer rules, the baseline was
regenerated from that, and the diff came out clean — with two comment fragments
sitting in the baseline as selectors.

`src/__tests__/cssParses.test.js` is the missing half: it parses every
stylesheet with PostCSS itself and fails on the error the dev server would have
raised. It was watched to fail by reintroducing that exact comment. The baseline
has been regenerated from correct CSS.

The general shape, and the reason this is in the handoff rather than just in a
commit: **a test that reads CSS as text cannot tell you the CSS compiles.** The
suite was green over a build that 500s.

Not taken: Luna's per-theme lattice alpha tokens (the diagnosis under them is
the DPR-1 artefact) and Luna's `.input-wrapper::before` kasumi rail (Sol's seven
bars cost two rects and say something about the product; a second decorated edge
beside the seal was the riskier of the two, and Luna itself said to delete it if
it competed).

**Closed the same day, and the closing is the interesting part.** The owner
called it: "the bars reading as highlighter means they crossed from one material
into another. Kasumi is grey mist." He asked for half a step back on the alpha —
and running that experiment showed no point on the ladder works. Measured over
the composer card in light: ink at mid was +0.062 chroma, half a step +0.045, a
full step +0.030 AND invisible again. Both ends wrong in opposite directions,
because alpha lowers lightness and chroma together, so pink never becomes grey.
`--ornament-mist` holds the weight and drops the colour. See the 2026-08-12
section above.

---

## This session (2026-08-12) — the p90 stops lying about abandoned turns

The owner's ruling on the item the last commit left him: *"A p90 that hides
aborted turns is a lying metric."* Fixed, and the fix is in two halves because
writing the row is only half of not lying.

**`server.js` writes the row from the `finally`, fire-and-forget.** Every abort
path returned before the audit write — the `if (turnSignal.aborted) return`
guards and the catch alike — so a turn the user gave up on left no trace. It is
NOT awaited: the client is already gone, so there is nobody left to wait for the
round trip, and `.catch(() => {})` is there because an unhandled rejection in a
`finally` ends the process under Node's default policy. Only
`turnSignal.aborted` reaches it, so a 400 from `validatePrompt` still writes
nothing.

**It keeps the `council` action rather than taking a new `council.aborted`.**
The admin console selects `.in("action", ["council.tools", "council"])` and then
filters on `metadata.telemetry === "council_turn"`. A new action name would have
written rows no report reads — the same invisibility with extra steps.

**`admin-commands.js` counts them and keeps them out of the percentiles**, and
this is the half worth remembering. An abandoned turn's `turnMs` is a CENSORED
observation: the turn was still running, so the number is a lower bound on a
duration nobody measured. Folding those in would have made every percentile
improve as more users gave up — the original bug, inverted, and harder to spot
because the graph moves the way you want. They are reported as
`abandonedTurns` and `abandonedAfterMsMedian`, and an abandonment rate over one
in five now outranks every other verdict the report can print. Their seat and
tool records are dropped too: seats that had not answered yet are absent rather
than slow, which biases a seat percentile toward whichever seats are fast.

Also collapsed to one flag: `telemetryWritten` guarded only `auditTelemetry`
while the memory, greeting, no_results, search and wiki branches called
`auditLog` directly, so it read false on the paths that had already written.
Harmless until the `finally` started writing too — then a client vanishing
between a branch's `await` and its `return` meant two rows for one turn.
Everything routes through `auditBranch` or `auditTelemetry` now, and a contract
test asserts no `auditLog(user.id, 'council'` survives in the route.

**Still not audited: a non-aborted 500.** Real gap, separate one, not fixed
here.

631 backend tests pass (624 + 7). Each of the three fixes was reverted
individually and its tests watched to fail — percentiles including abandoned
rows, the `finally` firing for a 400, one branch bypassing the flag — then
restored.

---

## This session (2026-08-11), latest — response times, measured at last

The owner's report was "AI response times are quite slow". Both peers profiled
rather than guessed, and the answer is not what the phrasing suggests.

**IT IS THE TAIL, NOT THE MEDIAN. p50 first answer 1.71s. p90 71.42s.** The
wall ceiling is 75s, so the slow turns are turns running to the ceiling and
stopping there. Anyone optimising the typical turn is optimising the wrong
thing. Supporting numbers: warm Supabase reads ~200ms and the batch is already
concurrent, so the database is not it; a live Render cold start measured
22.55s, which is an infrastructure floor no prompt change touches.

**The real gap is telemetry, and it is the next thing to fix.** Per-seat model
duration and synthesis duration are not recorded separately anywhere. The
numbers that would settle where the tail actually goes DO NOT EXIST. Luna
refused to invent them, which is why this section is short.

Note for the owner, not a re-litigation: the decision to keep the
post-truncation fallback council is part of why the p90 is what it is — a
blown 75s ceiling then buys another 30s whip. The decision stands and is
recorded under "Deliberately not done". It now has a measurement attached to
it that it did not have when it was made.

Shipped on the backend: the final council round no longer carries the tool
catalogue (~596 input tokens per seat, ~4.2k across seven, on the round the
user is actually waiting through — it is answer-only and cannot request a tool
anyway), and vision now starts before the independent context reads instead of
after them.

Shipped on the frontend: **animejs was on the critical path while the chunk
config claimed it was not.** A static import in App.jsx pinned it, and because
framer-motion was grouped with it, lazily importing framer-motion's only
consumer loaded it eagerly too. Initial JS is ~20.12 kB gzip lighter. The
message entrance effect keyed on the messages ARRAY, so a 700ms animation
restarted on every reveal tick.

**And the live region was announcing a lie**: an idle transcript that had never
streamed anything announced "Answer complete" on arrival, so a screen reader
user opening an old chat was told an answer had just finished. It now
announces lifecycle transitions only, and only after something was actually
responding.

**The O(message count) reveal reconcile is fixed in `f110515`, and the size of
the win was measured before keeping it.** The arriving answer now lives outside
the persisted `chats` tree, and settled rows sit behind a memo boundary while
the draft advances. The completed draft remains mounted through the
plain-text-to-Markdown swap, while export, feedback and the PUT continue to use
the full persisted transcript. Against 200 settled messages and the earlier
replay shape — 57 network frames, 109 reveal commits, 13.4 characters per
commit — median React update work across five runs fell 45.88ms → 7.27ms
(84.1%), and median replay wall time fell 68.60ms → 14.68ms (78.6%). The commit
count is unchanged on purpose: the draft still needs every paint; the 200 old
rows do not.

The null transcript Suspense fallback is also fixed in `f110515`. A slow
MessageList chunk now paints the existing `MessageSkeleton` or
`AnswerSkeleton`; there is no new decoration and no CSS change. The regression
tests were run against actual temporary reverts: history mapping rose from 1
to 20 calls, the persisted tree lost identity, and the null boundary lost its
skeleton. All three tests passed again after restoration.

Still deliberately left: the 224ms reveal tail, which smooths bursty output
and is a cadence decision, not a bug.

**A real NVDA or VoiceOver run is still owed.** Unit semantics and axe pass,
which is not the same thing, and the peer declined to call screen-reader
behaviour cleared without running one. Windows Narrator is present on this
machine, but this automation environment cannot capture or inspect what it
speaks, so launching it would not produce evidence of what a user heard. Do not
mark it done from the test count or the browser accessibility tree.

**Seat streaming is written up as a staged plan and is NOT started.** Stage
one is worth shipping for progress telemetry and perceived waiting, but it is
not by itself a final-answer TTFB win, because synthesis still waits for
complete seat answers. Do not let anyone sell it as one. The plan runs:
provider stream parser → progressive disclosure through explicit `seat_delta`
events that must never be merged into `chunk` or persisted as the answer →
`AbortSignal` → streaming tool rounds last, because tool results have to
re-enter still-running conversations without corrupting round ordering.

Rejected on the way, and worth not re-proposing: lowering quorum to one (trades
synthesis quality for a misleading first-token metric), sending the first
seat's prose as the final answer, speculative synthesis before quorum, and
provider prompt-caching without any cache-hit telemetry to show it works.

---

## This session (2026-08-11), earlier — sign-in rebuilt, branches cut

**Sign-in was the screen nobody had improved.** Three things were wrong with it
and all three are fixed.

*It was vibe-coded where it showed.* Two blurred gradient orbs drifted behind
the form on 18s and 22s loops — the single most reproduced background on the
web, the one that arrives with the framework. Gone, along with the branch above
them. The replacement is the app's own ground: the asanoha lattice, copied in
geometry from `.chat-main::after` so that signing in is the same room as the
app rather than an entrance hall decorated in a different style.

*Nothing moved on it.* The owner's question was fair — "the earrings swing, but
when I log in nothing's swinging" — because the crescents were mounted in
`.chat-main`, behind the sign-in wall, so the one piece of motion in this app
was invisible until after you had already committed to it. They now hang on the
first screen, on the resting 7s arc rather than the active one: the wide quick
swing means the council is working, and nothing is working yet. Hidden below
900px where the grid collapses and there is no margin to hang them in.

*The seal now closes the council ladder.* A hanko is pressed at the END of a
document, as the stroke that commits to what is above it, which is what "One
reply, reconciled." does to the seven rows above it. The drawing is already the
argument — two strokes converging to a point — and it is the only mark on the
page at full opacity. It lands at 980ms, exactly where `councilResolve`
finishes, oversized and over-rotated, and lifts to -4deg because a seal set
perfectly square reads as a printed logo.

**The page's ARGUMENT was not touched.** The council ladder, the temperatures,
the headline, the tagline and both legal paragraphs are exactly as they were.
This was a change of surface. Do not read it as the copy being in play.

**And it no longer waits on Clerk to render.** `if (!isLoaded) return null` was
holding the entire screen blank until a third-party bundle had downloaded,
parsed and initialised — seconds of nothing on a cold cache, on the one page
every new user sees. Only the card waits now, in a slot that reserves the
form's height so nothing reflows when Clerk arrives. The outage screen is
deliberately unchanged: once the ten seconds are up the message is the only
thing that matters.

Two notes for whoever is next here:

- **`prefers-reduced-motion` is handled globally**, in `utilities.css`, by
  collapsing every duration to 0.01ms. Any entrance animation on this page must
  therefore use `forwards`, or it is stranded at `opacity: 0` for those users.
  The seal is written that way and says so.
- **Sign-in renders OUTSIDE `.app-root`**, so `.app-root.light` never applies
  and the screen is always the dark theme. That is pre-existing, not new, and
  it is why the light theme was not part of this work.

---

## This session (2026-08-11), earlier — the loop's ceilings, reviewed by two peers

Five defects in the agent loop's time and money ceilings. All five have a test
that was verified failing on revert by actually reverting and running, not by
assertion. 598 backend tests pass.

**Found by review, in `agent-loop.js`:**

- The wall gate was `wallLeft() <= 0`, so a round could start with a few
  milliseconds left: every member asked, every model call paid for, every one
  dropped at a whip that had already expired. Now floored at `MIN_ROUND_MS`
  (250), clamped against `cfg.roundMs` so a caller with a deliberately tiny
  round is not floored out of existence. Stopping leaves up to 250ms of the
  ceiling unspent, which is the point.
- The late-member truncation blamed `cfg.roundMs` for a whip the wall had
  clamped, sending whoever read the log at the wrong knob. It now names the whip
  that actually fired.
- **The fix for the first one introduced the same bug one level down.** The
  round deadline was computed at the gate and reused verbatim as the helper's
  `deadlineMs` — but `active.map(...)` invokes `askMember` for every member
  eagerly, before the helper's timer starts, so that duration was granted twice
  and a 300ms wall could accept a reply at ~380ms. Entry-construction time is
  now subtracted. A ceiling measured from the wrong instant is the exact defect
  the first fix addressed; watch for it whenever a budget is computed at one
  point and spent at another.
- `perCall` was `Math.max(250, Math.min(perCallMs, budgetLeft(), wallLeft()))`.
  The floor sat OUTSIDE the clamp, so a 100ms budget handed the registry a 250ms
  timeout — the overrun the clamp exists to prevent, reintroduced by the floor
  meant to keep calls worth making. The 250 is now a stop, not a floor.

**In `deadline.js`:** a throwing `enough` predicate rejected the promise
returned by `.then()`, which nobody holds — the process-level unhandled
rejection that whole file's header exists to prevent, arriving by the one path
the fallbacks did not cover. Wrapped in `enoughNow()`; a predicate that cannot
answer has not said "enough", so the deadline still governs. Not reachable from
either live caller today, so it is a contract hole rather than a live bug.

**In `tool-dedupe.js` / `tool-registry.js` — a money leak.** Dedupe keyed on the
arguments as the model wrote them, but `validateArgs` strips anything the schema
does not name before running the call. Two members proposing the same search,
one carrying a `nonce`, were two unique calls at dedupe and one identical
request at execution — billed twice, in money and in the 25s budget. The
registry now exposes `normalize(call)`, the canonical form `execute` will run,
and `dedupeCalls` takes it as an optional third argument. A call it cannot
normalise keys on its raw form, so an invalid call still reaches `execute` once
and comes back as the error the model needs to see. A registry without a
`normalize` (every test double) dedupes on raw args exactly as before.

**Two synchronous-throw paths**, same shape, both fixed: `server.js`'s periodic
audit sweep and `search-cache.js`'s sweep both invoked `supabase.rpc()` before
attaching a handler, so a synchronous client throw became an unhandled
rejection. The cache one could also turn a successful paid search into a failed
tool result.

**How this session was run.** Two Codex peers worked alongside, as peers rather
than as subagents: `gpt-5.6-sol` at medium effort on security, `gpt-5.6-luna` at
max effort adversarially attacking the diff. Luna found the reused-deadline
defect; sol found both synchronous-throw paths, the `perCall` floor and the
dedupe leak. Two things made it work and are worth repeating:

- **File ownership was partitioned up front** — luna owned `agent-loop.js` and
  `deadline.js`, sol owned the rest and reported patches for luna's files rather
  than editing them. Both ran concurrently with no collision.
- **`gpt-5.6` is not a valid model id on a ChatGPT account.** The ids are
  `gpt-5.6-sol`, `gpt-5.6-luna`, `gpt-5.6-terra`. The first launch died on a 400
  with the model name in it; the work was fine.

---

## This session (2026-08-11), later

**The double rule** on the composer and the sidebar. Asked for with two
botanical-poster references, and taken as an addition WITHIN the ornament
family rather than as a direction to replace it — the branch, the seal and the
alpha ladder are untouched, and the empty state was not opened.

The references never draw a single edge: an outer rule at the trim and a second
hairline a few millimetres inside it. Three pseudo-elements, no new markup, so
`appMarkup.js` did not need a fixture:

- `.input-wrapper::after` — inner rule, inset 4px inside the card's 12px
  padding, `--ornament-ink` at the faint step, one step up on focus-within.
- `.sidebar::after` — the second line 3px inside `border-right`. Kept in the
  collapsed rail, so toggling never changes the KIND of edge.
- `.chat-group-label::after` — the rule that runs off the caption to the trim,
  faded rather than stopped square because the label is sticky and passes over
  rows underneath it.

Rendering changed on purpose; the cascade baseline was regenerated. 620
frontend tests pass.

**The prompt bar's ornament is a town at dawn now, not a branch.** The owner's
words for the old one: it read as sitting behind the bar and looked bad, and he
was right about the cause. It hung ABOVE the card's top edge with half of it
over the transcript, so it had to be faint enough to read text through, and at
that alpha it was a smudge. An ornament that overlaps live text has no good
opacity — the rule for this surface is now **on the bar, or not on the bar,
nothing hangs off it**.

What is there: a skyline silhouette standing on the inner rule at the FOOT of
the card, with a vermilion sun rising behind the roofline. The card carries
24px of bottom padding to give the horizon a strip it owns. The drawing is
1040 units wide — wider than the card ever gets — because a 262px town centred
in an 850px bar reads as a sticker, and a horizon has to run off both ends. The
`bar` sprig variant is deleted. The hanko is unchanged.

This was asked for with two botanical-poster references and is an addition
within the ornament family, not a replacement of it. The empty state was not
opened. If it is ever reverted, the files are `SakuraFrame.jsx`
(`ComposerSkyline`) and the `.composer-skyline` block in `composer.css`.

---

## This session (2026-08-11)

**Semantic memory, Phase 2** (`c19508e`). `user_facts.embedding` is
`vector(768)` and facts are retrieved by meaning, not only by recency. Migration
`013` is APPLIED to production. Provider is Google `text-embedding-004`, named
once in `lib/embeddings.js`.

Four things about it that are decisions, not accidents:

- *A malformed vector reads as no vector.* Wrong width, NaN, Infinity — all
  null, all stored as a fact without semantic recall. The alternative is a row
  `<=>` ranks against forever without ever erroring.
- *Both reads run on every turn.* A fact written while the key was unset has a
  null embedding and is invisible to `match_user_facts` permanently, so
  semantic-only retrieval would silently DROP those facts rather than rank them
  low. Nearest first, newest filling the remaining slots.
- *The read-path embed is behind a 600ms deadline.* Past it the turn goes out
  with recency-ranked memory, which is what it had before. Nothing on the write
  path has a deadline — it runs after the user has been answered.
- *Semantic dedupe on write was deliberately not built.* Recall and dedupe fail
  in opposite directions: a wrong ranking costs one turn, a wrong merge destroys
  a statement the user made.

Verified against production: probes ranked 1.0000 / 0.9939 / 0.0000 in the right
order, a second user's id returned nothing, probes deleted, no new advisor
findings. **NOT verified: the live HTTP call to `text-embedding-004`.**
`GOOGLE_API_KEY` is set in Render and not in the local `.env`, so every
provider-dependent path was exercised through its failure branch only. The first
real turn on the deployed backend is the check — `[EMBED]` in the logs means it
is failing.

**The transcript looked dead while waiting** (`bfa7fe8`). Reported as "no
loading animation, no SSE, no animations". **Streaming was never broken.** SSE,
the 16ms backlog-proportional reveal and the answer-shaped skeleton are all
intact and reachable — an agent traced the whole path to confirm it before
anything was changed. What was wrong: `send` sets status to `loading`
immediately, but the placeholder carrying `typing: true` — the thing that
renders `AnswerSkeleton` — was inserted only after `createChat`,
`ensureMessagesLoaded` and the awaited message PUT. The question painted and
then sat alone for one round trip on a warm chat, or a whole cold start on a new
one. The skeleton now renders off `status`. Image generation got its first
in-transcript feedback of any kind from the same change; that path sets the same
status and inserts no placeholder at all.

**The council now says what it is doing** (`e7a408d`). Seats are polled with
`stream: false`, so no answer token can exist until the last seat settles —
that is most of the turn and all of it was silent. The backend opens the stream
before the council runs and reports real work: `Asking 7 seats`, then `N of 7
answered`, then `Reconciling the answers`. `runCouncil` had always accepted an
`onSeat` reporter and nothing in production ever passed one, so the information
existed and went nowhere.

**Every stage is a real event, and it must stay that way.** There is no rotating
list of plausible-sounding activities. The first time it claims to be searching
on a turn that ran no search, nothing else this product reports about its own
work is worth believing. Counts only, never model names — the roster is one
screenshot away from being public.

Two things had to move with the early stream open, and both would have been
silent damage:

- `msToFirstByte` was stamped at `openStream`, which is now seconds before any
  word. Left alone, that commit would have looked like a large latency win while
  the user waited exactly as long. It is stamped on the first chunk now, and the
  old measurement continues as `msToFirstProgress`.
- The client cleared the `typing` placeholder when headers arrived. That would
  have swapped the skeleton for an empty bubble at the moment the long wait
  BEGINS — the feature meant to fill the wait would have emptied it. It clears
  on the first chunk now, and the 16ms painter no longer paints an empty string,
  which is what used to win that race on every turn.

**The collapsed rail is closed and reports work** (`f9c8f7a`). It used to end
wherever the chat glyphs ran out, which is a list stopping rather than a column
closing. It gets the keystone at its foot, and lights while the council works —
the earrings either side of the transcript already do exactly that, so this
joins an existing signal instead of inventing a second one. Opacity and colour
only, no movement: the earrings swing because they hang from a chain; a fleuron
on the floor of a column that moved would read as a loose element. `Keystone` is
exported and takes a `className` now. Verified in a browser, not inferred from
the markup.

**Live prices were being lost for most products** (`49dd9bc`). Asked for the
best air fryers in the UAE under 700 AED, the app quoted a price range invented
by an SEO listicle. `isShoppingQuery("air fryer price")` returned **false**, so
Google Shopping — which holds real merchant prices as a field — was never
called and the council had only content farms to reason from.

The gate required a money signal AND a product noun from a hand-written list.
That list has monitors, laptops and mattresses. It does not have air fryers, and
**it cannot be completed** — there is no version covering kayaks, cat litter and
whatever is sold next year, and every gap fails silently behind an answer that
looks entirely normal. Unmistakable buying language now stands alone; the weak
signals (`best`, `recommend`) still need a noun. `"the price of freedom"` now
buys one wasted lookup, and the test that asserted otherwise records why that is
the better side to be wrong on.

**This only reaches users if `SERPER_API_KEY` is set in Render.** Without it the
provider stays absent and answers degrade exactly as before.

---

## What shipped earlier and stayed

**Clerk migration** (`7ff4c32`, merged 2026-08-09). `@clerk/clerk-sdk-node` →
`@clerk/express@2.1.52`, zero advisories. The `req.auth` call sites were kept
working by a shim rather than rewritten; both that and the conditional
`clerkMiddleware()` mount are traps written up in `AGENTS.md`. Read those before
touching auth wiring.

**Streaming cadence** (`de5dca8`, `5e7d87e`). Answers reveal against a 16ms
clock at a rate proportional to the backlog, not once per network read. The
second commit is the important one: the reveal had been gated on
`prefers-reduced-motion`, which disabled it on exactly the machines that set the
preference, including the owner's. That is the origin of the rule now applied
across the app — reduced motion is about MOVEMENT, and content arriving is not
movement.

**Skeletons, not spinners** (`93b9efa`). The three-dot typing indicator is an
answer-shaped skeleton at the prose column's width. Pending tool rows breathe
instead of spinning. Deleting a chat is optimistic and puts the chat back with a
toast if the server refuses.

**Voice out** (`c513df7`). Every assistant answer has a Listen button, markdown
stripped before speaking. `/api/speech` proxies Fish Audio and answers 501 when
`FISH_AUDIO_API_KEY` is unset, at which point the client falls through to the
browser's own voice. Defaults to `s2.1-pro-free`; Fish Audio selects the model
in a HEADER and defaults to the paid one, so omitting it is a silent bill and a
test pins that.

**Sidebar cache** (`e52b11d`). `frontend/src/lib/chatCache.js` persists the chat
list to localStorage so a reload paints instantly. Four security rules, all
tested: messages are never written, entries are keyed by Clerk user id and read
back only for the same id, the cache clears whenever the app renders with no
user, and anything older than seven days is ignored.

**Upgrade panel** (`28a5efe`), **reduced-motion exceptions** (`3f74ff6`),
**council runner extraction** (`9e2e05a`), **`cssHygiene` counter fix**
(`9e2e05a`), **corner fix** (`5f17c03`), **button press and hover** (`da727cc`),
**sign-in focus ring and tab order** (`1ae0402`, `f7a3811`), **empty-state seal**
(`0adbd36`), **composer sprigs and pointer** (`dfa654f`).

---

## Open, and needing the owner

- **The authenticated seat probe is STILL the owner's to run, and it is now the
  oldest open item.** Confirmed again 2026-08-12: this machine has no
  `OPENROUTER_HOST` and no `OPENROUTER_API_KEY`, and `backend/.env` does not carry them,
  so nothing measured here can speak for production. The probe is the seven
  roster names against the real gateway with the exact payload
  `{ model, messages, stream, options: { temperature, num_predict } }`,
  measuring TTFT per seat over several runs. Until it exists: do not remove
  seats, do not raise the whip, and do not repeat the "one seat in six" number.
- ~~**A per-user spend ceiling.**~~ **Done** — $5/day, $20/month, the owner's
  figures. See the 2026-08-12 section above. What remains of it is calibrating
  the price estimates against a real provider bill, and metering the four paid
  routes other than `/api/council`.
- **Is `COUNCIL_TOOLS=1` set in Render?** If it is off, the entire tool-calling
  path is dark in production — specialised engines, live shopping, the tool
  trail — which would be a second and larger cause of weak answers than the
  shopping gate that was just fixed. Cannot be checked from this side.
- **Is `SERPER_API_KEY` set in Render?** `49dd9bc` does nothing without it.
- **`FISH_AUDIO_API_KEY` in Render.** Voice works without it using the browser
  voice; the key upgrades it with no UI change.
- **Rotate the Perplexity API key.** It was printed into a transcript earlier in
  this project's history.
- **Two commands the sandbox classifier blocked during the Agent Reach install.**
  Both are the owner's to run in a terminal:
  ```
  ~/.local/bin/agent-reach.exe install --env=auto
  mcporter config add exa https://mcp.exa.ai/mcp --scope home
  ```
  The second is the one that matters — free semantic web search, no key, and
  the highest-value channel still dark. `mcporter` is already installed. It was
  blocked because it wires a remote MCP endpoint into the home config, which is
  a reasonable thing to gate rather than route around.

## Open, and not blocked

- **Phase 2's evaluation is still owed.** It was built before Phase 1 had
  produced data — `user_facts` was empty the day it shipped — so it was built to
  cost nothing when wrong rather than to be justified by measurement. Once real
  facts accumulate, the question is whether the nearest-first half ever surfaces
  something recency missed.
- **No vector index on `user_facts`, deliberately.** ivfflat and hnsw earn their
  cost at thousands of rows; every query filters by `user_id` first and that
  index exists. Revisit when one user's fact count reaches four figures, and
  read `pg_indexes` first — twice in this project an index has been proposed
  from the repository alone that already existed under another name.
- **Mumbai migration** is prepared and not executed. `backend/Dockerfile`,
  `fly.toml` with `primary_region = "bom"`, `scripts/verify-migration.sh` and
  `docs/MUMBAI-MIGRATION.md` all exist. Fly wants payment to deploy; Cloud Run
  `asia-south1` is the free alternative.
- ~~**Nothing is cancelled, only abandoned.**~~ **Done** — the `AbortSignal` is
  threaded through `settleByDeadline`, `askMember`, `callModel`, the registry
  executors and the provider fetches, and cancelled on deadline and on quorum
  release. Sol's review of it landed four further fixes in `2306cf8`; see the
  2026-08-12 section above. What remains of this item is one owner decision,
  listed under "Open, and needing the owner": aborted turns write no telemetry
  row at all.
- **The council is only late-streaming.** Seats are polled non-streaming, so the
  first token cannot arrive until the last seat settles. The stage line now
  covers that wait rather than removing it. Streaming the seats themselves is
  the real fix and is a much larger change.

## Deliberately not done

- **Semantic dedupe of facts on write.** See the Phase 2 note above.
- **More API keys / more tools.** The public-apis list was surveyed. Almost
  nothing there is worth wiring: search, Firecrawl and Perplexity already cover
  the general case, and each extra tool costs roughly 1,500 tokens per seat per
  turn. Same lesson that cut SerpApi's ~110 engines down to one
  `search_specialized` tool.
- **A sweep of the top 100 Claude Code repos.** Refused by the owner, in his
  words: "One idea each from 100 repos into a codebase this opinionated is slop
  injection." A named topic with five repos is the shape that was acceptable.
- **A live council view.** The `onSeat` seam now feeds a one-line status rather
  than a council table. The owner has said a council table on the main chat
  screen is not wanted; do not build one unprompted.
- **Tooltips.** Already exist in the composer.
- **Bounding the post-truncation fallback council.** When the agent loop
  exhausts its 75s ceiling without producing an answer, `server.js` starts a
  further full council run with its own 30s whip — seven more paid model calls,
  outside the ceiling that was just declared blown. This was raised as a
  resource-exhaustion finding and is **the owner's decision, made 2026-08-11:
  leave it.** If the ceiling blows, spend the calls to recover; a truncated
  answer is worse than a late one. Do not "fix" this by capping it to a single
  model or by putting one request-wide deadline across both paths. It is a
  product choice, not an oversight.

---

## Environment notes

- `jq` is not installed. Use `node -e` for JSON work.
- **The cascade snapshot cannot see a stylesheet that does not compile**, so
  `UPDATE_CASCADE_BASELINE=1` on a broken file bakes the breakage into the
  baseline. `src/__tests__/cssParses.test.js` covers that now. If a CSS change
  looks green but the page is blank, load `/src/App.css` from the dev server and
  read the 500 body — it names the file, line and column.
- **A `px` inside a `transform` on an SVG child is an SVG user unit**, not a CSS
  pixel. Measured: `translateX(74px)` on `.composer-weather` moves the disc 60.3
  CSS px at this drawing's scale.
- **A headless browser's `devicePixelRatio` is its own configuration.**
  Playwright defaults to `deviceScaleFactor: 1`, and this machine is at 1.25.
  One peer's whole diagnosis rested on reading 1 there. For anything
  resolution-dependent, read the value in the user's own Chrome.
- **The two halves use different test runners.** Backend is `node:test` —
  `npm test` from `backend/`. Frontend is vitest. Running `npx vitest` in
  `backend/` reports all 44 files as "No test suite found in file", which reads
  as a broken suite and is only the wrong runner.
- **Agent Reach is installed on this machine** (2026-08-11) and is a research
  tool for whoever is working on this repo, not a dependency of the app —
  nothing in `backend/` or `frontend/` imports it. Live web page reads via
  `curl https://r.jina.ai/<URL>`, YouTube subtitles via `yt-dlp`, RSS, V2EX,
  Bilibili search — all keyless and verified working. `agent-reach doctor`
  reports every channel. Full notes, including the two commands still to be run
  by hand, are in `~/CLAUDE.md`.
- **`~/.claude/awesome-claude-design`** is a prose reference of DESIGN.md
  prompts by aesthetic family. Read it when a named direction is asked for.
  **Do not apply a family to this app on your own initiative** — see the
  ornament warning at the top of this file.
- The frontend dev server for screenshots: `npx vite --port 5199 --strictPort`,
  then drive it with the Playwright MCP. `gallery.html` renders every component
  state without needing auth, which is the fastest way to look at the empty
  state, both themes, and the loading states. **Check whether it is already
  running before starting it** — a second one fails on the port.
- `UPDATE_CASCADE_BASELINE=1 npx vitest run src/__tests__/cssSnapshot.test.js`
  after any deliberate CSS change, and say in the commit message that rendering
  changed on purpose. New markup also has to be added to
  `src/test/fixtures/appMarkup.js` or the CSS reads as dead later.
- Screenshots written by the Playwright MCP land in the user's HOME directory,
  not the repo. Delete them when finished.
- Backend `.env` does NOT carry `GOOGLE_API_KEY`, `SERPER_API_KEY` or the search
  provider keys — those live only in Render. Anything depending on them can be
  tested here through its failure branch only, and a commit message should say
  so rather than implying end-to-end verification.
- DDL goes through the Supabase MCP `apply_migration`, which wraps statements in
  a transaction, so `CONCURRENTLY` cannot be used through it. See `AGENTS.md`.

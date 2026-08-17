# 44-feature implementation ledger

Updated 2026-08-15 while resuming `2026-08-15-073606-countine-where-you-left-off-last-session-and-all.txt`.

This ledger records implementation evidence, not intent. “Complete” means the
code is connected to the production path and has focused failure-path tests.
“Partial” means a real slice is wired but a named requirement remains. “Blocked”
means it was deliberately not started in this continuation.

## Verification snapshot

- Backend: `cd backend && npm test` — **1,633/1,633 passed**.
- Syntax: `node --check backend/server.js` — passed; `git diff --check` — passed.
- Focused additions: job queue/worker, episodic summary, usage-prefetch,
  answer-cache, brain, tenant-scope, request-budget — **188/188 passed**.
- Supabase project `tbjvnqwgnkiynqypswmb` (APOL-AI): migrations recorded as
  `20260815034232 answer_cache_provenance`, `20260815034253 memory_tiers`, and
  `20260815034322 jobs`.
- Live schema query: 6 answer-cache provenance columns, 13 memory-tier columns,
  14 job columns, 3 job indexes, and 2 chat-summary indexes; `jobs` and
  `chat_summaries` both had 0 rows at verification time.
- Supabase security advisors: the new `jobs` and `chat_summaries` tables report
  RLS enabled with no policies, which is intentional for service-role-only
  tables. Existing warnings remain for mutable function search paths, the
  public `vector` extension, and public execution of two security-definer
  helpers. Performance advisors report unused indexes, including new indexes
  that have not yet seen production traffic.
- No deployment or public `/health` verification was performed in this task.

## Phase 0 — correctness and control plane

1. **complete** — Native `message.tool_calls` preservation. Files:
   `backend/lib/openrouter.js`, `backend/lib/openrouter.test.js`,
   `backend/lib/council-runtime-contract.test.js`. Evidence: native tool-call
   fields survive parsing and the full backend suite is green.
2. **complete** — Tool IDs, arguments, results, refusals, and structured
   responses. Files: `backend/lib/tool-protocol.js`,
   `backend/lib/native-tool-seat.js`, `backend/lib/council-tools.js` and their
   focused tests. Evidence: malformed/protocol/refusal and tool-loop tests pass.
3. **complete** — Reasoning is separated from visible answer content. Files:
   `backend/lib/reasoning-rescue.js`, `backend/lib/model-reply.js`,
   `backend/lib/openrouter.js`, `backend/server.js`. Evidence:
   `reasoning-rescue.test.js`, `model-reply.test.js`, and OpenRouter tests pass.
4. **complete** — Strict schemas for route plans, tool calls, evidence, and
   answer metadata. Files: `backend/lib/schemas.js`,
   `backend/lib/tool-protocol.js`, `backend/lib/error-envelope.js` and tests.
   Evidence: schema rejection and typed-envelope tests pass.
5. **complete** — Operation and turn IDs are threaded through requests, model
   calls, retries, tools, cache, and persistence. Files:
   `backend/lib/turn-context.js`, `backend/lib/turn-telemetry.js`,
   `backend/lib/turn-ledger.js`, `frontend/src/lib/operationId.js`,
   `frontend/src/hooks/useChats.js`. Evidence: turn-context, tenant-scope,
   operation-ID, and turn-ledger tests pass.
6. **complete** — Provider/model/tool/cost/cancellation telemetry. Files:
   `backend/lib/turn-telemetry.js`, `backend/server.js`,
   `backend/lib/turn-ledger.js`, `backend/lib/admin-commands.js`. Evidence:
   telemetry, audit, cancellation, and admin-report tests pass.
7. **complete** — Physical provider attempts and background model work are
   bounded/accounted. Files: `backend/lib/spend.js`,
   `backend/lib/request-budget.js`, `backend/server.js`. Evidence: request-budget
   and spend tests pass; durable memory jobs reserve conservative request bounds
   and settle them.
8. **complete** — Bounded degraded admission replaces unlimited fail-open
   behavior. Files: `backend/lib/request-budget.js`,
   `backend/lib/reservation-ledger.js`. Evidence: degraded allowance, recovery,
   and refusal tests pass.
9. **complete** — Idempotent request reservation and settlement. Files:
   `backend/lib/reservation-ledger.js`, `backend/migrations/014_user_spend.sql`,
   `backend/migrations/022_jobs.sql` (job idempotency), and focused tests.
   Evidence: reservation-ledger and request-budget suites pass.
10. **complete** — Canonical server-side turn ledger. Files:
    `backend/lib/turn-ledger.js`, `backend/migrations/019_turn_ledger.sql`,
    `backend/server.js`. Evidence: server-history ownership and bounded-history
    tests pass.
11. **complete** — Idempotent turn writes, checkpoints, partial answers, and
    resumable SSE lookup. Files: `backend/lib/turn-ledger.js`,
    `backend/migrations/019_turn_ledger.sql`, `frontend/src/hooks/useChats.js`.
    Evidence: turn-ledger and `useChats` tests pass.
12. **complete** — Partial answers survive interruption and network recovery
    paths retain usable client state. Files: `backend/lib/turn-ledger.js`,
    `frontend/src/hooks/useChats.js`, `frontend/src/__tests__/useChats.test.jsx`.
    Evidence: transcript/recovery and frontend test suites pass.

## Phase 1 — speed and adaptive execution

13. **complete** — Execution DAG with dependencies, deadlines, budgets, and
    abort signals. Files: `backend/lib/execution-dag.js`,
    `backend/server.js`. Evidence: DAG deadline, dependency, optional-step, and
    abort tests pass.
14. **complete** — Unnecessary embeddings, vision, memory, searches, and seats
    are skipped. Files: `backend/lib/work-plan.js`, `backend/server.js`,
    frontend/backend route tests. Evidence: work-plan and council-path skip tests
    pass.
15. **complete** — Provider/model health tracking. Files:
    `backend/lib/provider-health.js`, `backend/server.js`. Evidence:
    `provider-health.test.js` and full suite pass.
16. **complete** — Adaptive routing uses task, complexity, risk, freshness,
    personalization, latency, quality, and cost signals. Files:
    `backend/lib/adaptive-routing.js`, `backend/lib/work-plan.js`. Evidence:
    adaptive-routing tests pass.
17. **complete** — Pacing, concurrency limits, circuit breakers, and controlled
    fallback. Files: `backend/lib/pacer.js`, `backend/lib/provider-health.js`,
    `backend/lib/stream-policy.js`, `backend/server.js`. Evidence: pacer,
    stream-policy, and provider-health failure tests pass.
18. **complete** — Progressive council waves, bounded seats, early agreement,
    and risk-sensitive verification. Files:
    `backend/lib/progressive-council.js`, `backend/server.js`. Evidence:
    progressive-council and council runtime suites pass.
19. **complete** — Single-flight deduplication for identical in-progress work.
    Files: `backend/lib/single-flight.js`, `backend/server.js`. Evidence:
    single-flight tests pass.
20. **complete** — Cache identity includes prompt/policy/model/tool/retrieval/
    freshness plus language, region, plan, detail, and branch. Files:
    `backend/lib/cache-identity.js`, `backend/lib/answer-cache.js`,
    `backend/server.js`. Evidence: cache-identity and answer-cache tests pass.
21. **complete** — Cache provenance, quality, adaptive TTL, invalidation, hit
    tracking, and stale protection. Files: `backend/lib/answer-cache.js`,
    `backend/migrations/020_answer_cache_provenance.sql`, `backend/server.js`.
    Evidence: live migration, 6-column schema query, cache tests, and the
    verification path in `cacheAnswer`.
22. **complete** — Deployment configuration is consolidated around the live
    backend. Files: `render.yaml`, `deploy/targets.json`, `backend/.env.example`,
    `backend/lib/deployment-config.test.js`. Evidence: deployment/config tests
    pass. Deployment itself was not re-run here.

## Phase 2 — intelligence and memory

23. **complete** — Claim/evidence ledger with source identity/date/freshness and
    confidence. Files: `backend/lib/evidence-ledger.js`,
    `backend/server.js`. Evidence: evidence-ledger tests and cache verification
    wiring pass.
24. **complete** — Contradiction resolution and final-answer verification. Files:
    `backend/lib/contradiction.js`, `backend/lib/progressive-council.js`,
    `backend/server.js`. Evidence: contradiction tests cover numeric, polarity,
    freshness, unresolved, and cacheability cases.
25. **complete (rollout-gated)** — Working context, per-chat episodic hierarchy,
    cross-chat facts, preferences, and procedures. Files:
    `backend/lib/memory-kinds.js`, `backend/lib/episodic-summary.js`,
    `backend/server.js`, `backend/migrations/021_memory_tiers.sql`.
    Evidence: live schema is applied; `MEMORY_TIERS` remains an explicit flag,
    default off, with memory-kind and episodic tests green.
26. **complete** — Memory provenance/confidence/expiry/conflict/source-turn
    fields plus user deletion/export controls. Files:
    `backend/migrations/021_memory_tiers.sql`, `backend/server.js`,
    `frontend/src/hooks/useUserFacts.js`, `frontend/src/components/panels/SettingsPanel.jsx`.
    Evidence: tenant-scope, memory-kind, embedding-lifecycle, and frontend
    memory-control tests pass.
27. **complete (rollout-gated)** — Hierarchical conversation summaries and
    episodic retrieval. Files: `backend/lib/episodic-summary.js`,
    `backend/server.js`, `backend/migrations/021_memory_tiers.sql`.
    Evidence: `episodic-summary.test.js` covers windows, roll-ups, overlap
    suppression, relevance, and budget; the server DAG reads tenant-scoped
    summaries and the durable worker writes them when `MEMORY_TIERS=1`.
28. **complete** — Hybrid lexical plus vector memory retrieval. Files:
    `backend/lib/hybrid-retrieval.js`, `backend/lib/memory-kinds.js`,
    `backend/server.js`, `backend/migrations/021_memory_tiers.sql`. Evidence:
    hybrid-retrieval and memory-kind tests pass; the live `fact_tsv` column is
    present.
29. **complete** — Embedding lifecycle metadata, dimension/model checks, retry
    state, stale detection, and backfill path. Files:
    `backend/lib/embedding-lifecycle.js`, `backend/server.js`,
    `backend/migrations/021_memory_tiers.sql`. Evidence: embedding-lifecycle
    tests pass; live schema reports model/dimension/status/attempt columns; the
    worker has a tenant-scoped `embedding_backfill` handler.
30. **partial** — Durable asynchronous queue is implemented for summaries, fact
    extraction, embedding backfill, cache warming, and brain refreshes. Files:
    `backend/lib/job-queue.js`, `backend/lib/job-worker.js`,
    `backend/server.js`, `backend/migrations/022_jobs.sql`.
    Evidence: 37 queue/worker tests pass, full suite passes, and the live jobs
    table/indexes exist. Evaluation producers/handlers remain part of the
    intentionally deferred evaluation platform, so this item is not claimed
    fully complete.
31. **complete** — Curated brain questions are replaced by ranked durable cache
    candidates using demand, miss cost, freshness, quality, quota pressure, and
    live account quota. Files: `backend/lib/usage-prefetch.js`,
    `backend/lib/answer-cache.js`, `backend/lib/brain.js`, `backend/server.js`.
    Evidence: usage-prefetch and answer-cache tests pass; the brain producer reads
    `or_request_budget` and queues `cache_warm`/`brain_refresh` jobs.

## Phase 3 — started 2026-08-17

The scope instruction that blocked these was lifted on 2026-08-17. Items still
marked **blocked** below are the ones not yet reached; 32, 36, 37, 39 and 42
have moved, and the dated sections at the end of this file carry the evidence.

Two of the three items marked complete here were ALREADY complete when the
ledger called them blocked — 36's reconnect half and the whole of 37. The
earlier entry recorded the scope instruction rather than the code, which is the
same defect as a checker that reads the migration files instead of the database.
**Read the code before writing an item's state, including to write "blocked".**

32. **partial** — Extraction, chunking, citations, cross-file retrieval and
    semantic retrieval are built; object storage ACLs and workspace ingestion
    are not.
    Files: `backend/lib/doc-extract.js`, `backend/lib/doc-passages.js`,
    `backend/lib/file-intake.js`, `backend/lib/tool-registry.js`,
    `backend/lib/council-tools.js`, `backend/lib/embeddings.js`,
    `backend/server.js`. Evidence: see the two 2026-08-16 sections, the
    2026-08-17 cross-file section and the 2026-08-18 semantic section below.
    **What is NOT claimed, and it is the part to read first**: the vector side
    embeds passages AT QUERY TIME, so it is bounded by `MAX_EMBED_PASSAGES`
    (50 passages, about 90,000 characters). A larger attached corpus is
    searched lexically and the result says so in words the model reads — it is
    a stated ceiling, not a silent one. Raising it means passage vectors stored
    at upload time: a migration, a backfill and a job-queue write. Files still
    live in a `chat_files` row rather than object storage, so there are no
    per-file ACLs. **Nothing here has been run against the live provider** —
    `GOOGLE_API_KEY` is set in Render only, so every test on this path exercises
    the fake embedder or the failure branch.
33. **not applicable as written; the trigger that revives it is named below** -
    Sandboxed computation/data/file-analysis tool with restricted credentials,
    network and resources. Taken against what is actually here, the same way
    item 43 was:
    - **There is no user code to run.** The whole tool inventory is four
      read-only tools in `lib/tool-registry.js` - `web_search`, `read_url`,
      `read_file`, `search_specialized` - plus `search_files` added on
      2026-08-17. Not one of them executes anything a model or a user wrote.
    - **`lib/arithmetic.js` is not a sandbox and does not pretend to be.** It
      is a parser and a BigInt evaluator over numbers the parser itself built;
      there is no `eval`, no `Function`, and no path from model text to
      execution. Calling it "the existing sandbox" would be the claim this
      ledger exists to prevent. It needs no isolation because it runs no code.
    - **The obvious implementation does not deploy.** Render does not run
      Docker-in-Docker, so a container sandbox is not available on the
      production target at all. The real options are a V8 isolate
      (`isolated-vm`, a native module, and an escape is a full process
      compromise), a WASM interpreter such as QuickJS (deploys anywhere, but
      no Python and therefore no pandas, which is most of why anyone wants
      this), or an external microVM service (Vercel Sandbox, E2B - strongest
      isolation, a new vendor, a per-run cost, and a network round trip inside
      a tool call the user is waiting on). Choosing between those is a product
      decision about what "analyse my spreadsheet" should mean, not an
      implementation detail, and building any of them now would be the largest
      speculative subsystem in the repo.
    - **The trigger.** Revive this item the day a tool executes code that a
      model or a user supplied - a `run_code` tool, a formula evaluator over an
      uploaded sheet, a plugin that runs anything. That is the first thing
      whoever adds one should read, and the decision above is the one they will
      have to make first.
34. **complete (the platform and the first dataset; one live run is owed)** —
    Evaluation platform and datasets. Files: `backend/lib/evaluation.js` (new),
    `backend/lib/evaluation.test.js` (new), `backend/evals/core-v1.json` (new),
    `backend/scripts/run-evals.mjs` (new), `backend/package.json`. Evidence: 17
    grader/metric tests pass and the shipped dataset is validated BY a test, so
    a typo'd expectation key is a red suite rather than a case that silently
    grades nothing. `npm run evals:validate` reports 22 cases and spends
    nothing. **What is NOT claimed**: no live run has been made — the council
    route is behind `requireAuth` and needs a real Clerk session JWT, so the
    dataset has never been graded against a real answer. That is the one owner
    action this item leaves.
35. **complete (enforcement; two of seven gates are inconclusive by design)** —
    Release gates for latency, cost, factuality, citations, cache/memory
    precision, tools, and acceptance. Files: `backend/lib/release-gates.js`
    (new), `backend/lib/release-gates.test.js` (new). Evidence: 9 tests pass,
    and the one that matters was observed red with the "unmeasured means fine"
    shortcut in place — a missing number is `inconclusive` and fails the run,
    never a pass, because zero clears every max-threshold gate in the list.
    A MEASURED breach fails at any sample size; `minSample` only withholds a
    PASS. That distinction was wrong when first written and was caught by
    running the thing (see the dated section below).
    `cost-per-turn` and `cache-precision` are inconclusive TODAY because the
    HTTP surface exposes neither the settled price nor `textSource`; the two
    additive fixes are named in `lib/evaluation.js`.
36. **complete** — Frontend reconnect/offline retry/durable turn status.
    Files: `frontend/src/hooks/useChats.js`, `frontend/src/lib/pendingTurn.js`
    (new), `frontend/src/App.jsx`, `frontend/src/__tests__/pendingTurn.test.jsx`
    (new). Evidence: reconnect, offline detection, bounded backoff and the retry
    affordance already existed and are rendered by `MessageList` (`status ===
    "reconnecting"` / `"offline"`); the half that did not exist was surviving
    the TAB — the operation id lived only in `send`'s closure, so a reload
    orphaned a turn the server was still paying for. 705/705 frontend tests
    pass; four of the eleven new ones were observed red with the pending record
    forced to null. **Depends on an owner action**: `019_turn_ledger.sql` is not
    applied in production, so the ledger this reads is empty there.
37. **complete** — Frontend Markdown/syntax-highlight code splitting. Files:
    `frontend/src/App.jsx`, `frontend/src/components/CodeBlock.jsx`. Evidence is
    MEASURED from `npx vite build`, not read from the source: `markdown` is its
    own 161.62 kB chunk (49.38 kB gzipped), `CodeBlock` another 39.43 kB, and
    each Prism language is a chunk of its own (2–8 kB) — none of it inside
    `index` (141.20 kB). It was already shipped when this item was written as
    blocked.
38. **complete** — Typed errors, carried through the whole request path and
    held there. Files: `backend/lib/error-envelope-wiring.test.js` (new).
    Evidence: reading every producer found no live leak — the HTTP routes all
    answer through `sendError`/`fail`, and the SSE path builds its frame from
    `errorEnvelope(...).body.error` — so what was missing was the guard, not a
    fix. The new test reads `server.js` and refuses `res.status(NNN).json(`,
    a raw `res.status().send()` outside the Stripe webhook (pinned by the
    route's brace span, not a lookback window), a thrown message interpolated
    into a response body, and an SSE error frame without a code or an operation
    id. One 5xx exception is pinned by name: `POST /api/image` returns the
    model's own refusal. All four guards were observed red against the precise
    regression each claims to catch.
39. **complete (the enforcement half; the rollout is one owner variable)** —
    Required distributed rate-limiter rollout before multi-instance deployment.
    Files: `backend/lib/instance-census.js` (new),
    `backend/lib/instance-census.test.js` (new),
    `backend/lib/census-wiring.test.js` (new), `backend/server.js`,
    `backend/.env.example`. Evidence: the instance count is now MEASURED — every
    instance heartbeats one row a minute into the existing `rate_limits` table
    and the live rows are counted, so "more than one instance while
    `RATE_LIMIT_STORE` is unset" is a named log line carrying the multiplier and
    two fields on `/health` (`instances`, `limitsMultiplied`) rather than a
    sentence in a comment. It warns rather than refusing to boot, because a
    rolling deploy runs two instances by design. 1779/1779 backend tests pass;
    both wiring guards were observed red. **Owner action remains**: set
    `RATE_LIMIT_STORE=postgres` in Render before scaling past one instance —
    the census reports the mistake, it does not prevent it.
40. **complete (enforcement; the migration is one owner action)** — Stripe
    identity/billing release work. Files: `backend/lib/stripe-apply.js` (new),
    `backend/lib/stripe-apply.test.js` (new),
    `backend/migrations/027_users_stripe_event_at.sql` (new, NOT APPLIED),
    `backend/lib/stripe-webhook-wiring.test.js`,
    `backend/lib/billing-read-model.js`, `backend/server.js`. Evidence: the
    release blocker was found by reading, not guessed — NOTHING in the request
    path compared event timestamps, so a reordered `customer.subscription.*`
    pair left a cancelled customer on `pro` permanently. The high-water mark is
    now compared and advanced in ONE statement. 1880/1880 tests; five guards
    observed red. **Owner action**: apply 027; until then the code falls back
    to the unguarded write and says so on every event, in the log and in the
    read model's `unguarded` list.
41. **complete** — Stripe event state machine, durable retries, and the billing
    read model. Files:
    `backend/lib/stripe-event-ledger.js` (new),
    `backend/lib/stripe-event-ledger.test.js` (new),
    `backend/lib/stripe-webhook-wiring.test.js`, `backend/server.js`,
    `backend/migrations/026_stripe_event_state.sql` (new, NOT APPLIED).
    `backend/lib/billing-read-model.js` (new),
    `backend/lib/billing-read-model.test.js` (new).
    Evidence: the ledger row was claimed before the work and never released, so
    a handler that threw answered 500, Stripe retried, and the retry was dropped
    as a duplicate — paid, and permanently on the free plan. The row now carries
    a state and only `done` skips; `failed` retries at once, an unfinished claim
    is taken over after the in-flight window with the attempt counted. The read
    model is now built on `audit_logs` and needs no migration; see the
    2026-08-18 section below, including the SECOND road to the same
    paid-and-free bug that building it exposed. Four wiring guards observed
    red.
42. **complete** - Migration lineage, drift detection in both directions, and
    a rebuild that is PROVEN rather than assumed. Files:
    `backend/migrations/000_base_schema_lineage.sql`,
    `backend/migrations/011_advisor_findings.sql`,
    `backend/migrations/024_or_requests_search_path.sql`,
    `backend/scripts/rebuild-proof.sh` (new),
    `backend/scripts/rebuild-expects.mjs` (new),
    `backend/scripts/check-drift.mjs`, `backend/lib/rpc-lineage.test.js`.
    Evidence: MEASURED against `pgvector/pgvector:pg16` in Docker on
    2026-08-18 - 12 of 28 migrations failed on the first run against an empty
    database, 0 after the fix, and every table and RPC the code calls exists in
    the rebuilt catalogue. See the dated section below.
43. **not applicable as written; its applicable half is already built** —
    Capability-based plugin/OAuth isolation, least privilege, outbound
    allowlists, confirmations, and per-turn plugin limits. There is no plugin
    platform and no third-party OAuth surface in this product: the whole tool
    inventory is four read-only tools in `lib/tool-registry.js` — `web_search`,
    `read_url`, `read_file`, `search_specialized`. Building a capability system
    for plugins that do not exist would be the largest speculative subsystem in
    the repo. Taken clause by clause against what IS here:
    - **Outbound allowlist** — built. `lib/url-guard.js` resolves the hostname,
      refuses if ANY resulting address is private, and RETURNS the vetted
      address so `lib/pinned-fetch.js` connects to that rather than
      re-resolving; without the second half the check proves nothing against
      DNS rebinding. Fails closed on any address shape it cannot classify.
      28 tests across the two modules pass.
    - **Least privilege** — built. `read_url` cannot be handed a URL by a model
      at all; it takes an opaque per-turn id minted by the registry from a
      search result, and `read_file` takes a per-turn file id rather than a
      name.
    - **Per-turn limits** — built. `lib/agent-loop.js` bounds both the rounds
      and `maxUniqueCalls`, and a cached repeat is not counted as a unique
      billed call.
    - **Confirmations** — moot. Every tool is read-only; there is no tool call
      whose effect could need confirming.
    - **OAuth isolation** — moot for the same reason.
    Revisit this item as written the day a tool takes an action rather than
    reading something. That is the trigger, and it should be the first thing
    anyone adding one reads.
44. **blocked** — Authenticated browser release matrix for SSE, reconnects,
    speech, camera, screen sharing, mobile/touch, attachments, themes, billing,
    and tools. No Phase 3 browser release run was started.

## 2026-08-16 — vision, multi-image and image generation

Added outside the 44-item numbering because none of the items covers "the
council can see and draw"; the closest, item 32, is document ingestion and is
tracked separately below.

- **Vision no longer pins a retired model id.** `backend/lib/vision.js` (new,
  with `vision.test.js`) takes a candidate list, stable id first, and falls
  through only on a model-not-found; a 429 or 500 still fails the turn rather
  than silently downgrading the model. Both call sites in `backend/server.js`
  (council and overlay) previously pinned `gemini-2.5-flash-preview-05-06` /
  `gemini-2.5-pro-preview-05-06`. Commit `af92359`.

  **Not verified against production.** There is no `GOOGLE_API_KEY` in the
  local environment, so the claim "the reported failure was a retired id" is
  reasoned from the 502 path (the 503 no-key gate sits above it, so the key is
  set and the call itself failed), not measured. What is measured: the code no
  longer fails permanently when one id is retired, and errors now name the
  model and status they came from.

- **Several images per turn.** `backend/lib/attached-images.js` (new, with
  tests); `images` is an array, `image` still works, vision describes them
  concurrently and fails as a unit, and over the limit (4) is a 400 rather than
  a silent slice. Commit `a3df273`.

- **Image generation and editing.** `backend/lib/image-gen.js` (new, with
  tests) and `POST /api/image` — auth + suspension check + its own 10/min
  limiter + one request against the daily budget; a 200 carrying no image is
  treated as the refusal it is. No object storage: the image returns as a data
  URL. Commit `bdc43aa`.

- Frontend surfaces for all three (multi-attach UI, generated-image rendering)
  are **not built**. The backend accepts them; nothing sends them yet.

## 2026-08-16 — the head ladder's price, and its order

Follow-ups to commit `2e89f7e`, which added the ladder and wrote down what it
left undone.

- **Synthesis is priced per model.** `lib/spend.js` charged a flat
  `synthesisTenths` calibrated for Luna while the head could fall to Sonnet 5 at
  roughly 17x Luna's completion rate — an under-charge, and a ceiling may only
  err the other way. `SYNTHESIS_MODEL_TENTHS` prices the metered rungs,
  `recordSynthesis` now carries the rung that really answered into the SNAPSHOT
  (the settlement reads the snapshot, not the audit row's extra), and
  `reservationCents` takes `SYNTHESIS_MODEL_CANDIDATES` so the reservation still
  bounds the settlement. Commit `caa2b7d`.

  **Reasoned, not measured.** The rates are OpenRouter's catalogue figures
  applied to the tool seat's 30k-prompt/4k-completion worst case; there is no
  OpenRouter key on this machine. Calibrate against the provider dashboard.

- **Gemini before Sonnet.** The owner's ordering, given 2026-08-16. Commit
  `9de296a`.

- **Still open: every rung is an OpenRouter rung.** The ladder survives one
  model or one upstream provider failing. It does not survive the OpenRouter
  ACCOUNT — a daily free-tier cap, a billing stop, a gateway outage — because
  all five rungs are reached through it. A direct Google GenAI call using the
  `GOOGLE_API_KEY` the vision path already holds would be the first genuinely
  independent rung. Not built.

## 2026-08-16 — item 32, in part: a document is retrieved from, not cut

Chunking and citations, the halves of item 32 that do not need object storage.
Embeddings, ACLs and workspace ingestion remain unbuilt.

- **The rest of the document is now kept.** `prepareUpload` sliced to 20,000
  characters BEFORE storing, so page 90 of a two-hundred-page PDF had never
  existed in the row. `MAX_CHARS` is now a bound on a database row (1,000,000)
  rather than a model's context budget; for text `MAX_BYTES` (512KB) bites
  first, so an accepted text file is stored whole.

- **`read_file` retrieves.** `lib/doc-passages.js` (new, with tests) splits on
  paragraph boundaries into overlapping ~1,800-character passages, ranks them
  by rarity-weighted term overlap against a new optional `query` argument, and
  returns the best two in document order with character offsets and the nearest
  heading. Short files return whole exactly as before; no query returns the
  beginning, exactly as before. Gaps between passages are marked, so a model
  cannot read three excerpts as one continuous text.

- **Lexical, not vector.** There is no embedding call on this path and adding
  one would put a network round trip inside a tool call made while the user
  waits. `scorePassages` returns scored passages, so a vector re-rank fits over
  it later without changing a caller — `lib/hybrid-retrieval.js` is the model.

  **Reasoned, not measured.** The ranker was verified against fixtures, not
  against real user documents; no corpus of those exists to measure on.

- Verification: backend suite 1757/1757, `node --check server.js`. The
  retrieval test was observed red with the passage branch disabled.

## 2026-08-16 — item 32 continued: the extractor gets a caller

`lib/doc-extract.js` reads PDF, DOCX and XLSX, hardens the ZIP path, and had
been fully tested since it was written. Nothing called it. The upload route
called `prepareUpload` — the synchronous text-only sibling — which refuses
every binary kind, so a PDF upload was rejected at the door while every test in
`doc-extract.test.js` passed.

- **The route awaits `prepareUploadAsync`**, with `GOOGLE_API_KEY`, the plan's
  vision model list, and a 120s deadline of its own. Text still takes the
  identical synchronous path inside it.
- **A body limit that clears the file.** Express parses before the handler
  runs, and this path took the 1mb default against ~10.7mb of base64 for an 8MB
  document, so it would have 413'd every PDF with the right function wired.
  `docJson` is 16mb and is selected only for `POST /api/chats/:id/files`; the
  50mb image ceiling is deliberately not reused.
- **The picker offers them.** `InputBar.jsx` `accept` and its tooltip listed
  text kinds only.
- `lib/upload-wiring.test.js` (new) holds all three against `server.js`'s
  source; observed red with the route reverted.

**Not verified against production.** There is no `GOOGLE_API_KEY` on this
machine, so no PDF has been through the live extractor from this route. DOCX
and XLSX are pure local parsing and are covered by their own tests.

## 2026-08-16 — the model ids were measured, and most of them were dead

The owner supplied a Google API key, so the vision, embedding and image ids
could be called for the first time from this machine rather than reasoned about.

- **Every vision id was 404.** `gemini-2.5-pro`, `gemini-2.5-flash` and
  `gemini-2.0-flash` all refused, the first two with "no longer available to
  NEW USERS" — so the identical list can work on an older key and refuse every
  image on this one. The list written to survive a retirement had expired.
  Both ladders now lead with an ALIAS (`gemini-pro-latest`,
  `gemini-flash-latest`), the only id Google repoints instead of retiring.
- **ListModels is not evidence.** It still advertises `gemini-2.5-flash`, which
  `generateContent` then refuses. Only a call to the endpoint you will use
  proves an id, and that is what was done: one PDF per candidate.
  Measured 200s: `gemini-flash-latest`, `gemini-flash-lite-latest` (861ms),
  `gemini-3.1-flash-lite` (3.9s). `gemini-pro-latest` answered 429 — alive and
  out of quota, which is why it is kept and why a 429 must not fall through.
- **Two image-generation fallbacks were dead weight.**
  `gemini-2.5-flash-image-preview` and `gemini-2.0-flash-preview-image-generation`
  are 404; `gemini-2.5-flash-image` and `gemini-3.1-flash-image` answer 429, so
  the ids live and only the quota is spent. Image generation itself remains
  unverified end to end for that reason.
- **`gemini-embedding-001` answers 200** at 768 dimensions. No change needed.

**MEASURED, not reasoned: the document path works end to end.** A real PDF
through `prepareUploadAsync` → Gemini extraction → `findPassages` returned its
sentence and its character offsets in 3.3s.

## 2026-08-16 — item 42: 023 applied, and the two functions it could not see

- **`023_function_search_path.sql` is applied to production**, and
  `run-migration.mjs` now has the verification it was missing: `searchPathPinned`
  reads `pg_proc.proconfig` rather than asking whether the function exists —
  the three functions existed before 023 and would have passed `functionExists`
  with a mutable search_path intact. All three verified green.

- **`024_or_requests_search_path.sql` (new, applied and verified).** Listing
  `pg_proc` directly turned up two more unpinned project functions,
  `reserve_or_requests` and `settle_or_requests`, the OpenRouter request
  budget called from `lib/request-budget.js`. They were observed red before the
  migration and green after.

- **The reason 023 missed them is the finding.** `lib/migration-lineage.js`
  reads the migration FILES, and neither function is created by any file in
  `migrations/` — they were applied by hand, like the duplicate `audit_logs`
  index AGENTS.md records. A checker over the files can only verify what the
  files say. **Known drift, not yet closed:** no migration creates those two
  functions, so a rebuild from `migrations/` produces a database where
  `lib/request-budget.js` fails at its first RPC.

- Neither migration is an escalation: none of the five functions is SECURITY
  DEFINER. Both are catalogue-only, idempotent, no rewrite, no lock.

## 2026-08-16 — item 42 closed on the file side: the lineage now describes the database

Asking `pg_proc` and `information_schema` instead of reading the migration
files turned up drift in **both** directions.

- **`019_turn_ledger.sql` was never applied.** `turns`, `turn_reservations`,
  `claim_turn_reservation`, `settle_turn_reservation` and `checkpoint_turn` do
  not exist in production, while `lib/turn-ledger.js` and
  `lib/reservation-ledger.js` call them on every turn. Both fail open by
  design, so resume-after-drop and idempotent admission have simply been OFF —
  silently, with a green suite. **Still unapplied:** the sandbox refused the
  apply twice; it needs an owner run.
- **`000_base_schema_lineage.sql` (new, applied).** `users`, `chats`, `usage`,
  `audit_logs` and `user_facts` were created by hand before `migrations/`
  existed, so every migration since 001 has been ALTERing tables no file
  creates and 019's foreign keys pointed at nothing on a rebuild. Numbered 000
  because it has to run before them. Transcribed from the catalogues, with two
  divergences reproduced rather than fixed and named in the header:
  `user_facts` is ENABLE-not-FORCE where its siblings are forced, and
  `audit_logs` keeps its duplicate index.
- **`025_or_request_budget_lineage.sql` (new, applied)** does the same for
  `or_request_budget`, `reserve_or_requests` and `settle_or_requests`.
- **`scripts/check-drift.mjs` (new)** compares migrations to production in both
  directions and exits 1 on anything missing. It now reports zero untracked
  objects; the only MISSING entries are 019's.
- **`lib/rpc-lineage.test.js` (new)** is the half that runs without a token:
  every `rpc('…')` and `.from('…')` in the code must be created by a migration
  file. Observed red with 025 removed.

**Applied but not proven by a rebuild.** 000 and 025 were applied to
production, where every object already existed, so each statement was a no-op —
that proves the SQL parses and executes, not that an empty database ends up
matching. Proving that needs a scratch Postgres with pgvector and a catalogue
diff. Docker is installed here but its daemon was not running.

## 2026-08-17 — Phase 3 resumed, and the peers were not available

The scope block on Phase 3 was lifted. Work was partitioned across three tracks
by file, as `~/CLAUDE.md` requires for separable pieces, and dispatched to both
Codex peers — sol on items 34/35 (evaluation platform and release gates), luna
on 38/39 (typed errors, rate-limiter rollout).

**Both dispatches died on the same error and produced nothing:** `You've hit
your usage limit ... try again at Aug 20th, 2026 4:56 PM.` The tree was
untouched; no partial work landed. Codex is unavailable on this account until
2026-08-20, so everything below was done solo and the remaining Phase 3 items
are single-threaded until then.

- **Item 36's missing half: a turn now survives the tab that asked for it.**
  `lib/pendingTurn.js` leaves the operation id where a reload can find it,
  under `chatCache.js`'s three rules (keyed by user id and read back only for
  the same id, cleared on sign-out, expired by age — fifteen minutes). No
  message text is stored; the answer comes back from
  `GET /api/turns/:operationId`. Recovery runs once per mount, AFTER the chat
  list because `ensureMessagesLoaded` answers null for a chat it cannot find,
  and polls for up to 30s in case the turn is still being written. A transcript
  already ending in an assistant message has nothing to recover, which is what
  stops two reloading tabs appending the answer twice. Commit `151ffd1`.

  One non-obvious defect fixed on the way: cancellation is tied to UNMOUNT via
  a no-dependency effect, not to the recovery effect's own cleanup. The effect
  depends on callbacks that are re-created when the chat list changes — which
  the recovery itself causes — so a cleanup-based cancel abandoned the wait it
  was in the middle of, and the once-per-mount guard meant nothing restarted it.

  **Blocked on the owner to be worth anything in production.**
  `019_turn_ledger.sql` has never been applied, so `findForResume` has no table
  and every recovery will 404 there.

- **Item 39: the instance count is measured rather than remembered.** See the
  item above. The one design decision worth repeating: it warns and does not
  refuse to boot, because refusing would fail every rolling deploy of a
  correctly configured single-instance service, and too-generous limits are not
  data at risk.

- **Item 37 was already done, and item 36 was half done, while both were
  recorded as blocked.** The Phase 3 header now says why that happened.

## 2026-08-17 (continued) — items 38 and 41

- **Item 38 needed a guard, not a fix.** Every producer in the request path
  already answered through the envelope; nothing stopped the next route from
  going back to `res.status(500).json({ error: err.message })`, which is the
  shape anybody writes by hand and the one the sweep removed thirty times. The
  envelope's own unit tests stay green while that line ships, so the guard reads
  `server.js` instead. Commit `fecf925`.

- **Item 41 found a live defect worth the whole item.** The Stripe webhook
  claimed the event id before the work and never released the claim, so the
  retry Stripe sends after a 500 was dropped as a duplicate: the customer pays,
  `plan` stays `free`, and every line the retry logs reads healthy. Only `done`
  now skips. Commit `3e5872b`.

  The design point worth keeping: the `failed` check sits ABOVE the in-flight
  window check. Stripe's first retry can arrive inside the window, so testing
  the clock first would read a KNOWN failure as a live attempt and skip it —
  the original bug wearing a new status.

## 2026-08-17 (continued) — items 34 and 35, and why the migrations did not move

- **The evaluation platform is three modules because one of them cannot be
  tested.** `lib/evaluation.js` is pure (cases in, grades and metrics out),
  `lib/release-gates.js` is pure, and `scripts/run-evals.mjs` — the only part
  that spends money, keeps time and talks HTTP — carries no judgement at all.
  That split is what makes 25 tests possible over work whose subject is live
  model answers.

- **The design decision the whole thing rests on: an unmeasured metric is
  `inconclusive`, and inconclusive fails.** Two of the seven gates cannot be
  measured over HTTP today — no frame carries the settled price and `textSource`
  reaches the client on no path — and the ordinary shape of this mistake is to
  default them to 0, which passes every "must be below" gate in the list. A run
  therefore refuses by default and `--allow-inconclusive` is a flag a human has
  to type. Observed red with the shortcut in place.

- **Cache PRECISION, not hit rate.** Of the turns served from cache, how many
  still answered the question. A stale or mis-keyed row is a hit and a wrong
  answer simultaneously, and hit rate scores that as a success.

- **RUNNING IT FOUND TWO DEFECTS THE 25 TESTS COULD NOT.** The backend was
  launched locally on 3001 and the runner pointed at it with a deliberately bad
  token, which exercises every part of the path except the model call.

  1. **`process.exit()` aborts on Windows.** With undici still holding the
     keep-alive sockets from the last turn, exiting there trips
     `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\\win\\async.c`
     and the shell reads **127**. A refusal still looked like a refusal, so this
     hid; a PASSING run aborting the same way would have read as a failed
     release. Now `process.exitCode`, and both paths were checked: 1 on refusal,
     0 on pass.
  2. **`--allow-inconclusive` blessed a run in which every case failed.** Three
     cases, all answering 401, acceptance rate 0 — and because three is below
     the ten-case minimum the gate said `inconclusive`, which the flag forgives.
     The sample floor now sits BELOW the threshold comparison: it withholds a
     PASS on thin evidence and has no business forgiving a breach you can
     already see. Observed red against the old order.

  Neither is a mistake the unit tests were pointed at, and both are the kind
  only launching the thing produces.

- **Two things were confirmed live rather than reasoned about.** The instance
  census (item 39) immediately reported `instances: 2` and
  `limitsMultiplied: true` on `/health`, because production's own heartbeat row
  was in the table next to the local one — the census works against the real
  database. And the typed-error envelope (item 38) answered the unauthenticated
  POST with `{error, code: 'unauthenticated', operationId}` and answered a
  misconfigured Clerk with a safe `internal_error` carrying the cause in
  `detail`, which is the shape item 38 claims and had only ever been read from
  source text.

- **Two pre-existing source-text guards were failing before any of this**, from
  `a921020` reflowing `HEAD_CANDIDATES` and `ADAPTIVE_HEAD` across lines without
  changing what either builds. Fixed by making the patterns whitespace-tolerant,
  which is what `AGENTS.md` already says to do, and both were observed red again
  against a real regression (candidates narrowed to the configured head, kill
  switch deleted). Backend is 1823/1823.

- **The two pending migrations did not move, and it was not for want of
  trying.** The Supabase MCP connector needs re-authorising and its OAuth
  client is rejected by Supabase — `{"message":"Unrecognized client_id"}` from
  the authorize URL, so the connector cannot be re-authorised from here at all.
  The Management API path needs an `sbp_` personal access token, which the owner
  was previously unable to copy out of the dashboard. Both migrations are still
  owner actions and the two paths that remain are the dashboard SQL editor and
  `supabase login` from a terminal the owner drives.

## 2026-08-17 (continued) — the migrations were already applied, and a wrong answer with no search

**019 and 026 ARE in production, and the entry above saying otherwise was
wrong.** Verified through the Supabase MCP connector against `pg_catalog`, not
against the migration files: `turns` and `turn_reservations` exist with
`turns_operation_idx` and `turns_chat_idx`; all three functions
(`claim_turn_reservation`, `settle_turn_reservation`, `checkpoint_turn`) exist
with `proconfig = search_path=""`; `stripe_events` carries `status`, `attempts`
and `last_error` plus the partial `stripe_events_unfinished` index; RLS is
ENABLE + FORCE with zero policies on all three, which is the service-role-only
specification. The ledger is being written and read: 8 `turns` rows, 8
`turn_reservations`, newest turn `2026-08-17 03:00Z`. Both `stripe_events` rows
are `done`, so 026's backfill ran rather than marking history reprocessable.
Item 36's reload recovery and item 41's retry path are therefore live, not
waiting.

**A named product model no longer lets a model decide whether to search.**
Reported with the transcript: "i just bought the xg27aqwmg what are some things
i should do and watch out for" was answered, with no search, as a 27" 1440p
180 Hz IPS monitor. It is a 280 Hz WOLED. Panel type, refresh rate, HDMI limits,
OSD settings — the whole answer was invented, formatted confidently, and logged
as a success.

The prompt was not the lever, and that is the part worth keeping. `planTurn`'s
system prompt already says to search "specs, reviews and comparisons of real
products", already says "if in doubt, search", and already carries
`Q: XG27AQWMG` with the correct answer as a worked example. It is FAST_MODEL at
a 120-token ceiling, and it still answered NO once the same SKU sat inside a
chatty sentence. A small model's classification is the wrong mechanism for a
decision whose failure mode is silent fabrication.

`namesSpecificModel` in `lib/router.js` now settles it in the rule router, which
runs ABOVE the planner: a token mixing letters and digits (`xg27aqwmg`,
`15ixr10`, `a7iv`) or a real word followed by a number (`rtx 5060`, `iphone 15`)
forces two queries — the designation alone, which finds the spec sheet, and the
user's own sentence, which finds the rest. Units (`1440p`, `280hz`, `240fps`),
formats (`mp4`, `sha256`, `utf8`), version numbers (`3.12`) and code shapes are
excluded, so arithmetic and "should I cap my fps" turns are untouched.

This is the FIRST rule here that overrides the planner rather than only saving
it a call, and the comment in `server.js` claiming that could never happen was
corrected in the same commit. Ceiling, stated: a bare two-character SKU (`s9`,
`s7`) is not caught — four characters is the floor that keeps `x8` in "3 x 8"
out — so "is the s7 or the s9 better" still goes to the planner. 1832/1832
backend tests pass; three were observed red with the rule disabled.

## 2026-08-17 (continued) — the deterministic layer was more literal than a person

Four reports from one transcript. All four are the same shape: a regex read
words, a person typed words, and the two disagreed.

- **Typos, for every word the router reads.** `lib/spelling.js` corrects a
  message towards the router's OWN closed vocabulary before any decision reads
  it. It is not a spell checker and must not become one — no dictionary, no
  prose correction — because a general one could "correct" a product name into an
  English word, which is the single thing this area cannot afford. Nothing under
  five characters is corrected: `and` is one edit from `add`, and that alone
  would let the arithmetic parser answer 14 to "average of 4 and 10". A tie
  refuses.

  **The corrected text is a DECISION copy and never reaches a model.** Every
  prompt still carries `pv.value`. A guard test enforces it, because answering a
  rewritten question is answering a question the user did not ask and the answer
  would look perfectly healthy.

- **Spoken maths.** "6 multipled by 8" bought a full council while "6 x 8" was
  free. Operator words now match through a bounded Damerau-Levenshtein where a
  transposition costs ONE edit, which is what `mutliplied` is. Added with it:
  ordinal powers ("2 to the 4th power", "3 to the fourth power") and multiplier
  words ("half of 60", "double 21"). sin/cos/tan, cubed, roots, mod and factorial
  already worked — verified by running them, not assumed.

- **Short SKUs.** The ceiling written down in the previous commit was the next
  bug report: "is tienco s7 stretch ... or the s9 ... better" answered from
  memory with a spec table and prices. A two-character token cannot force a
  search alone (`x8` in "3 x 8" is the same shape), so the SENTENCE has to prove
  it: two or more of them, or a real word in front of one. The brand travels into
  the query — "s9 specs review" finds a phone, a headphone and a vacuum. The
  brand in the report is misspelled, which is precisely why the fix is a search
  and not a brand list.

- **Three seats instead of seven, and this reverses an instruction.**
  `escalateForResearch` widened EVERY search turn to the full roster, so a
  two-product comparison bought seven models. Seven readings of the same two
  pages is one answer seven times, at seven times the request cost, and slower —
  a seven-seat burst against an account-wide 20/minute ceiling collects 429s and
  their retries. Simple and moderate research turns now take three; complex
  research still takes everything. Three rather than one because a lone seat
  reading a lone page with nothing to disagree with it is the failure that
  function was written to fix.

  The owner's earlier instruction was "full council on search" and this replaces
  it, on the owner's own evidence. Sol proposed exactly this split on 2026-08-14
  and was overruled; the reversal is recorded in the code so the next reader does
  not restore the old behaviour as a bug fix. A three-seat turn is also no longer
  labelled `complex` in the audit row.

1845/1845 backend tests pass; the three new behaviours were each observed red
with their implementation disabled. Live on `bb3de93`, confirmed by `/health`.

## 2026-08-17 (continued) — item 32: five documents, one call

`read_file` takes one id, so a question whose answer sits in one of five
attached files cost one round per guess — and `agent-loop` bounds the rounds,
so past a few documents the model was out of turns before it was out of files.
The guess was made from the FILENAME, which is the one part of a document that
is not its contents.

- **`search_files` (new tool)** ranks passages across every file attached to
  the conversation and returns the best few, each labelled with its file, its
  nearest heading and its character offsets. `lib/doc-passages.js` gains
  `searchDocuments`/`renderDocuments`; `fileStoreFor` gains `all()`, one query
  rather than a `get()` per id, because twenty round trips inside a tool call
  the user is waiting on would cost more than the guessing it replaces.

- **One scoring pass over the merged corpus, not a ranking per file.** Rarity
  is the whole point of the ranker and it only means anything across the corpus
  being searched. Ranking each file alone and taking each winner hands back the
  least-bad passage of four irrelevant documents.

- **Nothing matching returns nothing.** `findPassages` opens one NAMED file at
  page one when nothing matches, which is what a reader would do; across five
  documents the beginning of an arbitrary one answers nothing and would read as
  a hit. The tool answers `ok` with the file names and "the terms do not appear
  in them", because "it is not in your documents" is an answer and "no results"
  is not.

- **The scan is capped and the files it drops are named.** Twenty files at
  `MAX_CHARS` is twenty megabytes. `SCAN_CHARS` bounds it, and a file that was
  never opened is listed in the result — "the answer is not in your documents"
  and "I did not open three of them" are different answers.

- **The same (user, chat) binding, and the same reason.** `all()` is the
  store's, so there is no parameter in `search_files`' signature that could
  name another user's documents. `upload-wiring.test.js` pins both predicates
  and the `content` column against `server.js`'s source, because every unit
  test builds its own fake store and none of them would notice the tool
  quietly ceasing to register.

- Verification: 1857/1857 backend tests, `node --check server.js`,
  `git diff --check`. Three guards were observed red against the precise
  regression each claims to catch: the store's missing `all()`, the
  fall-back-to-the-beginning shortcut, and the per-file index. **The third had
  no test when it was first claimed** — the ordering assertion was written only
  after reverting the reindex left the suite green, which is rule 4's "a test
  you have not watched fail is not a test" catching a claim in this same pass.

## 2026-08-18 — item 41's read model, and the same bug by a different road

Item 41 built the state machine and said so; what it could not answer was "why
is this customer on free when they paid", because the ledger records that an
event ARRIVED and the `users` row records the CURRENT plan and nothing joins
them.

- **The second road to paid-and-free.** `.update(patch).eq(column, value)`
  reports NO ERROR when it matches zero rows. So an event attributed to a user
  row that is not there logged the healthy line, marked the event `done`, and
  left the customer paid and on free — 026's bug exactly, reached without
  going anywhere near the retry path. `.select('id')` is the fix: it turns "no
  error" into "no rows", and it is also where the read model gets the user id.
  Found while building the projection, not by looking for it.

- **The obvious reconciliation is wrong, and quietly.** "A row with a
  `stripe_subscription_id` and `plan = 'free'` is someone who paid and did not
  get it" matches every customer who has ever cancelled, because
  `customer.subscription.deleted` sets the plan to `free` and leaves the
  subscription id in place. That check runs green against a broken system and
  red against a healthy one. It was designed, then discarded before it was
  written, by asking what would let it pass while the thing it checks is
  broken.

- **No new table and no migration, therefore no owner action.**
  `audit_logs` already exists, is already swept on the retention schedule, and
  is already indexed on `(action, created_at DESC)` — which is this query.
  `recordBillingEvent` writes one row per event carrying `eventId`, type,
  confidence, reason, the patched field names, and the two questions that are
  not the same one: `attributed` (a column matched) and `applied` (a row
  changed).

- **`audit_owner_read` lets a user read their own audit rows**, so that bag is
  user-visible by design and `decision.match.value` — which can be an email —
  is deliberately absent from it. A guard asserts that, because the natural
  thing for the next person to add is exactly the identity that must not be
  there.

- **`GET /api/admin/billing`** is three bounded selects and one pure function:
  failing and stuck events, unattributed and unapplied events, plans that
  diverge from the last event that claimed one, and `healthy` as a single
  boolean. Only the users an event actually touched are read.

- Verification: 1869/1869 backend tests, `node --check server.js`,
  `git diff --check`. Four guards observed red against the precise regression
  each claims: the reverted `.select('id')`, an identity written into the audit
  bag, reconciling from events that changed nothing, and taking the newest
  event rather than the newest PLAN-BEARING one.

## 2026-08-18 (continued) — item 40: Stripe does not promise order, and the webhook assumed it did

Found by tracing the entitlement invariant through every producer rather than
by looking for a bug: `resolveStripeTarget` decides a plan from an event, and
nothing between it and the `users` row ever asked WHEN the event was created.
`grep -n "created|timestamp|order" lib/stripe-identity.js` returns one line,
and it is the string `customer.subscription.created`.

So, with two events five seconds apart and delivered in the other order — which
a redelivery after a 500 produces on its own, minutes apart:

    customer.subscription.updated (active)   created 12:00:00
    customer.subscription.deleted            created 12:00:05

the cancelled customer keeps `pro` permanently. Every log line reads healthy,
and unlike the paid-and-free bugs this one is invisible from the customer's
side too, because the customer is happy. It is found by reconciling the ledger
against Stripe by hand, which is to say it is not found.

- **The guard is in the PREDICATE.** `users.stripe_event_at` is compared and
  advanced in one statement (`stripe_event_at IS NULL OR stripe_event_at <= $1`),
  because reading the row, comparing in JavaScript and then writing has a race
  exactly the width of the round trip — and two concurrent deliveries of two
  events is the case the whole thing exists for. `IS NULL` is not redundant: a
  NULL comparison is NULL, so without that clause the FIRST event for every
  user is rejected as stale, and the guard eats the thing it protects.

- **`lte`, not `lt`.** A redelivery of the same event carries the same
  timestamp and must still be able to finish work its first delivery failed at.
  Two DIFFERENT events inside one second remain order-dependent, and that is
  the one case this does not cover.

- **Zero rows now means two things, and only one is a fault.** A stale event
  and an event that matched no user row both change nothing. The zero-row path
  costs one extra select to tell them apart, because reporting the guard
  working as the paid-and-free failure would turn this fix into a permanent
  error stream — and the read model's new `superseded` bucket is the same
  distinction on the reporting side.

- **A bogus `created` makes no ordering claim.** Zero, missing or unparseable
  becomes `null` rather than 1970 — an event stamped at the epoch is older than
  everything and would be permanently unappliable — and a far-future stamp is
  refused because it would pin the row and reject every later event.

- **It works before 027 is applied**, falling back to the unguarded write and
  reporting `ordered: false`, which the read model collects into `unguarded` so
  the exposure window is dated rather than inferred. That fallback exists
  because this repo has shipped a migration that sat unapplied for weeks while
  the code needing it failed in silence.

- Verification: 1880/1880 backend tests, `node --check server.js`,
  `git diff --check`. Five guards observed red: the dropped predicate, the
  dropped `IS NULL`, a webhook writing `users` directly, a stale event reported
  as a missing row, and the read model counting a superseded event as a
  failure. **One of the five was reported red before it had run** — the perl
  substitution failed with `bad substitution` and the suite it printed was the
  UNMODIFIED one; caught by reading the command's own output rather than the
  test count under it, and redone.

- **Three existing wiring guards failed and were RETARGETED, not deleted.** The
  users write moved into `lib/stripe-apply.js`, so guards pinning
  `.update(decision.patch).eq(...)` against `server.js` no longer matched. The
  invariants they hold — addressed by the column the decision chose, `.select()`
  so zero rows is visible, `done` marked only after the work — are unchanged and
  now assert at the new call site.

## 2026-08-18 (continued) - item 42: the rebuild was assumed, and it did not work

The previous pass said this exactly: 000 and 025 were applied to production
where every object already existed, so each statement was a no-op - which
proves the SQL parses, not that an empty database ends up matching - and that
proving it needed a scratch Postgres with pgvector, whose daemon was not
running. The daemon is running now, and the answer was NO.

**12 of 28 migrations failed on the first run, all cascading from one root
cause.** `000_base_schema_lineage.sql` creates RLS policies calling
`current_app_user_id()` and `current_app_is_admin()`. The first is created in
002 and the second in 012 - two files and twelve files later. Against
production both already existed, so 000 was a clean no-op and looked correct.
Against an empty database it died at its first policy, and since `chats`,
`audit_logs` and `user_facts` are created further down that same file, eleven
later migrations then failed on missing tables. The fix puts both function
definitions - 012's, verbatim - above the policies that call them; 002 and 012
still `CREATE OR REPLACE` them afterwards, so the last writer is unchanged and
this copy cannot become the authority.

Two failures survived that fix and were a different thing entirely - objects
this schema does not own:

- **`rls_auto_enable` is Supabase's**, an event-trigger function no migration
  here creates; `check-drift.mjs` already lists it under `AD_HOC` for that
  reason. 011's unguarded `REVOKE` ended the file on any database that is not
  Supabase.
- **024 hardens `reserve_or_requests`/`settle_or_requests`, which 025
  creates** - the migration written afterwards to put hand-made production
  functions under lineage. On a rebuild, 024 runs before its objects exist, and
  025 creates them with `SET search_path` already applied, so skipping reaches
  the same catalogue state.

Both are now guarded by an `IF EXISTS` on `pg_proc`, and each guard says which
of the two reasons it is there for.

- **`scripts/rebuild-proof.sh` (new)** is the whole thing as one command:
  scratch container, the platform baseline Supabase provides and plain Postgres
  does not (the `anon`/`authenticated`/`service_role` roles, `vector`,
  `pgcrypto`), every migration in order, exit 1 on the first failure.

- **`scripts/rebuild-expects.mjs` (new)** is the half that stops the first half
  from lying. A file of guarded `DO $$ ... IF EXISTS ...` blocks applies
  perfectly and creates nothing, and this repo now contains two such guards on
  purpose - so "0 failures" alone would stay green while the schema emptied
  out. It reads every `.from()` and `.rpc()` in the source and requires each
  name in the catalogue the rebuild actually produced: 15 tables and 10 RPCs,
  all present. It is `lib/rpc-lineage.test.js`'s question asked of a database
  rather than of the files.

- Verification: the proof was observed red - reverting only the 000 fix puts
  the rebuild back to 14 failing files and exit 1. Backend 1880/1880.
  **What is NOT claimed**: this proves `migrations/` builds a working database
  from nothing, NOT that the result is byte-identical to production. That is a
  catalogue diff against the live database and needs credentials this machine
  does not have; `check-drift.mjs` is the tool for it and remains owner-run.

## 2026-08-18 (continued) - item 32: the lexical ranker could not fail quietly, so it failed loudly instead

**The defect, stated exactly.** `scorePassages` keeps only passages scoring
above zero. A question that paraphrases its document rather than quoting it
scores zero on every passage, so `search_files` did not return a worse ranking
- it returned NOTHING, and the tool then reported "The documents were searched;
the terms do not appear in them" about a document that answers the question.
That sentence was written to be trustworthy, and on this path it was false.

**What was built.**

- `lib/embeddings.js` gains `batchEmbedRequestBody` and `parseBatchEmbeddings`.
  One `:batchEmbedContents` round trip instead of N. The parser's rule is
  stricter than the single one and the reason is worth reading: a malformed
  single embedding costs one fact its vector, but a batch of the WRONG LENGTH
  slides every later vector onto the wrong passage, and nothing in the response
  would let a caller notice. A length mismatch discards the whole batch.
- `lib/doc-passages.js` gains `documentCandidates`, `takeWithinBudget`, `cosine`
  and `fuseDocumentHits`, all pure. The fusion is `hybrid-retrieval.fuse`, the
  same reciprocal-rank fusion memory uses, keyed on the corpus-wide passage
  `index` - which is the only reason two rankings holding different objects for
  one passage collide instead of double-counting it.
- `cosine` returns **null, never zero**, for a missing or mismatched vector.
  Zero is a measurement: it means orthogonal. An unembedded passage entering the
  ranking as zero would outrank every passage the query actively disagrees with.
- A **floor** (0.5) on the vector side, because every vector has a nearest
  neighbour. Without it, a question these documents do not answer comes back
  with the least-unrelated paragraph, and "not in your documents" stops being a
  possible answer at all.
- `lib/tool-registry.js` gains `searchAttachedFiles`, which is where every
  degradation lives: no embedder, an oversized corpus, a throwing provider, a
  null result - each returns exactly what `searchDocuments` returned before.
- `server.js` gains `embedBatch` and `embedPassages` (the only impure part),
  with a 4s deadline of its own because this runs inside a tool call the user is
  waiting on. Query and passages go in ONE batch: two would let the query vector
  land after the passage vectors had already timed out.

**The ceiling, stated rather than hidden.** `MAX_EMBED_PASSAGES` is 50 - about
90,000 characters - against a `SCAN_CHARS` that admits 2 MB, roughly 1,100
passages. Past the ceiling the search is lexical and `renderDocuments` says so
in the text the model reads, because a silently lexical answer to a paraphrased
question is indistinguishable from an honest "not in your documents". The
upgrade is passage vectors stored at upload time.

**Evidence.** Backend 1900/1900, up from 1880. Seven guards were mutated and
watched fail before being kept: the batch length check, `cosine`'s null,
the vector floor, the fusion key, the reading-order sort, the lexical-only
notice, and the corpus ceiling. The ceiling test failed first for the wrong
reason - a 120-paragraph fixture is only about seven passages, not fifty - which
is the test catching the author rather than the code.

**What is NOT verified.** No live provider call. `GOOGLE_API_KEY` lives in
Render only, so `embedBatch` and `embedPassages` have never run against Gemini
from this machine. The request shape was checked against Google's REST
documentation (`embedContentConfig.outputDimensionality`, and each batch entry
carrying its own model and config), not against a response. The first live run
is the thing that would confirm this works at all.

## Owner actions this Phase 3 has accumulated

Three remain. The two migrations that led this list are DONE — see the dated
section above, verified in `pg_catalog`.

1. **Set `RATE_LIMIT_STORE=postgres` in Render before scaling past one
   instance.** The census added in item 39 reports the mistake; it does not
   prevent it.
2. **Apply `027_users_stripe_event_at.sql`.**
   `node scripts/run-migration.mjs 027_users_stripe_event_at.sql`, or the
   dashboard SQL editor. Until it runs, the Stripe ordering guard is inactive
   and a reordered event pair can leave a cancelled customer on `pro`. The
   webhook warns on every event and `GET /api/admin/billing` lists the exposed
   events under `unguarded`.
3. **Run the evaluation dataset once against a real session.**
   `EVAL_TOKEN=<clerk jwt> BASE=https://alop-ai.onrender.com npm run evals`
   from `backend/`. Until that happens items 34 and 35 are a platform with no
   measurement in it, and the gates have never judged a real answer. It costs up
   to 22 council turns, four of them full research turns.

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

32. **blocked** — Full PDF/DOCX/spreadsheet/code/workspace ingestion, object
    storage ACLs, chunking, indexing, embeddings, and citations. Adjacent files:
    `backend/lib/file-intake.js`, `backend/server.js`; full ingestion was not
    started and no new Phase 3 tests were added.
33. **blocked** — Sandboxed computation/data/file-analysis tool with restricted
    credentials/network/resources. Existing local arithmetic is not a sandbox.
    Adjacent files: `backend/lib/arithmetic.js`; no Phase 3 change made.
34. **complete (the platform and the first dataset; one live run is owed)** —
    Evaluation platform and datasets. Files: `backend/lib/evaluation.js` (new),
    `backend/lib/evaluation.test.js` (new), `backend/evals/core-v1.json` (new),
    `backend/scripts/run-evals.mjs` (new), `backend/package.json`. Evidence: 14
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
    (new), `backend/lib/release-gates.test.js` (new). Evidence: 11 tests pass,
    and the one that matters was observed red with the "unmeasured means fine"
    shortcut in place — a missing number is `inconclusive` and fails the run,
    never a pass, because zero clears every max-threshold gate in the list.
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
40. **blocked** — Complete Stripe identity/billing release work. Existing
    `backend/lib/stripe-identity.js` foundation was not extended in this task.
41. **partial** — Stripe event state machine and durable retries. Files:
    `backend/lib/stripe-event-ledger.js` (new),
    `backend/lib/stripe-event-ledger.test.js` (new),
    `backend/lib/stripe-webhook-wiring.test.js`, `backend/server.js`,
    `backend/migrations/026_stripe_event_state.sql` (new, NOT APPLIED).
    Evidence: the ledger row was claimed before the work and never released, so
    a handler that threw answered 500, Stripe retried, and the retry was dropped
    as a duplicate — paid, and permanently on the free plan. The row now carries
    a state and only `done` skips; `failed` retries at once, an unfinished claim
    is taken over after the in-flight window with the attempt counted. Both
    wiring guards observed red. **The billing READ MODEL is not built**, which
    is why this is partial. **Owner action**: apply 026; until then the ledger
    falls back to the old behaviour, which has its own test.
42. **blocked** — Full migration lineage/schema snapshots/RLS policy tests,
    function `search_path` hardening, and production drift detection. The live
    schema was inspected only for the authorized 020–022 migrations.
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

## Owner actions this Phase 3 has accumulated

Four, in the order they cost the most:

1. **Apply `019_turn_ledger.sql`.** Resume-after-drop and idempotent admission
   are OFF in production, and item 36's reload recovery reads the table it
   creates. The sandbox refused the apply twice; it needs a hand.
2. **Apply `026_stripe_event_state.sql`.** Until it runs, a webhook that fails
   still loses its retry.
3. **Set `RATE_LIMIT_STORE=postgres` in Render before scaling past one
   instance.** The census added in item 39 reports the mistake; it does not
   prevent it.
4. **Run the evaluation dataset once against a real session.**
   `EVAL_TOKEN=<clerk jwt> BASE=https://alop-ai.onrender.com npm run evals`
   from `backend/`. Until that happens items 34 and 35 are a platform with no
   measurement in it, and the gates have never judged a real answer. It costs up
   to 22 council turns, four of them full research turns.

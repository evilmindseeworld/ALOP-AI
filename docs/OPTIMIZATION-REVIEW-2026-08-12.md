# ALOP-AI optimization review — request consumption, latency and cost

Date: 2026-08-12  
Scope: report only; no product or source changes made.  
Baseline: `main` at `d528711`.

## Executive result

The highest-confidence issue is the account-wide request meter: `countTurnRequests()` does not count all OpenRouter calls made by a real turn. Its `FAST_OVERHEAD = 3` description names router classification, title, and feedback, but the council route actually makes two model router calls plus asynchronous summary and fact-extraction calls; title and feedback are separate user-triggered endpoints. This makes the settled count lower than the provider's account-wide consumption.

The safest proven saving is to defer the markdown dependency within the already-lazy signed-in message feature: the build contains a 160.92 kB raw / 49.11 kB gzip `markdown` chunk that is statically imported by `MessageList`, so it loads when `MessageList` loads even if the conversation has no markdown. The risk is one extra request and a possible short fallback window for signed-in users; signed-out behavior is already protected by the lazy `MessageList` import.

No measured evidence supports changing `FAST_MODEL`, reducing council seats, weakening retrieval, or removing memory/feedback work while preserving product behavior.

## Findings

### 1. Request budget is undercounted on council turns — high priority

Estimated saving: fixing the meter does not save requests; it prevents an unmetered overrun. A behavior-preserving deferral/removal of one identified call would save exactly 1 request on the path where it is removed.  
Evidence: reasoned from call sites, not a live provider count.

Files: `backend/lib/spend.js:257-323`, `backend/server.js:2243-2252`, `backend/server.js:2244-2245`, `backend/server.js:1157-1158`, `backend/server.js:1324-1328`, `backend/server.js:1357-1361`.

For an ordinary single-round council turn with `N` seats, the actual OpenRouter arithmetic is:

| Path | Actual calls | `countTurnRequests()` | Difference |
|---|---:|---:|---:|
| greeting | 1 streamed answer | 1 | 0 |
| memory answer | 2 router calls + 1 answer + 2 remember-turn calls | 5 | -4 |
| search or Wikipedia answer | 2 router calls + 1 answer + 2 remember-turn calls | 5 | -4 |
| search with no results | 2 router calls | 2 | -1 |
| council, `N` seats | 2 router calls + `N` seats + 1 synthesis + 2 remember-turn calls | `N + 4` | -1 |

The two router calls are `isMemoryOrReferenceQuestion()` and `getSearchQuery()`; they run in parallel but both are provider requests. `rememberTurn()` starts `updateChatSummary()` and `updateUserFacts()`, each of which calls `FAST_MODEL`. The router classification in `lib/router.js` is pure code and costs zero model requests. The frontend adds one more request for the first title of a new chat at `frontend/src/hooks/useChats.js:826-854`; feedback adds one only when the user rates an answer at `frontend/src/hooks/useChats.js:553-568` and `backend/server.js:3031-3036`.

Therefore the simple/moderate/complex council baselines are respectively 6, 8, and 12 actual requests before tool rounds, fallback council work, a new-chat title, or feedback. The current settled arithmetic is 5, 7, and 11. This is a ceiling-accounting defect, not a user-visible answer defect, but it matters more than token cost under an account-wide 50/1000 daily cap.

Recommended action: make telemetry record every OpenRouter request, or make the reservation/settlement count the actual router and remember-turn calls explicitly. Keep title and feedback as separate counters because they are not part of every `/api/council` request. Add shadow-mode probe requests to the count if `COUNCIL_TOOLS=shadow` can run in production; `backend/server.js:2198-2216` dispatches one extra probe per selected member and those calls are not council-seat telemetry.

Risk: changing accounting has no intended product-behavior change, but changing the calls themselves does. Removing summary or fact extraction changes future context; removing a router call can change whether memory/search is selected; removing title or feedback changes visible naming or learning. The report recommends measurement/accounting first, not removal.

### 2. Title generation and feedback are not on every turn, but each costs one request when used

Estimated saving: 1 request per first message in a newly created chat if model title generation is deferred or omitted; 1 request per explicit feedback submission if note generation is omitted.  
Evidence: reasoned from `frontend/src/hooks/useChats.js:826-854`, `backend/server.js:2960-2973`, and `backend/server.js:3021-3041`.

Recommended action: keep the local six-word title as the default and consider model titles a separately measured enhancement; do not describe title as a per-turn cost. Keep feedback note generation unless the owner accepts weaker learning. If deferring title until idle, retain the existing local title and do not block answer streaming.

Risk: title omission/deferment changes sidebar naming or makes it temporarily less descriptive. Feedback-note omission removes the learned preference written to `feedback_notes`, changing later answers. Neither is a behavior-preserving optimization by itself.

### 3. Router-call caching has no proven safe hit-rate opportunity

Estimated saving: 0 requests proven from the repository; a cache hit would save 1 request for each exact reusable router decision, but no duplicate-rate measurement exists.  
Evidence: reasoned from inputs at `backend/server.js:401-445` and the parallel calls at `backend/server.js:2243-2245`.

Recommended action: do not add a broad model-router cache based only on message text. Search classification includes the conversation summary, current date, and locale guidance; memory classification is conversation-sensitive. If pursued, measure exact duplicate inputs first and include every decision-changing input in the key, with a short TTL.

Risk: an incomplete key can suppress a needed search or incorrectly classify a memory question. A stale search decision changes factual freshness behavior. The pure `classifyRequest()` already costs zero requests and needs no cache (`backend/lib/router.js:274-301`).

### 4. FAST_MODEL is consistently selected; the faster Ling seat is not a safe replacement

Estimated saving: none recommended. The measured roster values are 2.4s median for Gemma and 1.2s for Ling at the documented 200-token probe; this is a 1.2s measured difference for the probe, not a guaranteed turn saving at different ceilings.  
Evidence: `backend/server.js:154-177`, `backend/server.js:184-194`.

Every `FAST_MODEL` call inspected uses `google/gemma-4-26b-a4b-it:free`: memory classification (`backend/server.js:386-388`), search planning (`backend/server.js:401-445`), chat summaries (`backend/server.js:1157-1158`), fact extraction (`backend/server.js:1321-1328`), chat title (`backend/server.js:2966-2972`), feedback notes (`backend/server.js:3031-3034`), and the overlay fallback (`backend/server.js:2810`). None is accidentally routed to the slower 23.9s/8.9s seats. `PRIMARY_MODEL` is the same model (`backend/server.js:193-194`); Ling is only a council seat (`backend/server.js:161`).

Recommended action: keep Gemma until an authenticated probe verifies usable `content` at the 10-token router ceiling. The code records the disqualifying constraint: reasoning models return `content: null` at that ceiling and put text in `reasoning` (`backend/server.js:184-192`). Do not swap to Ling solely on the 1.2s measurement.

Risk: swapping could make router responses empty or misroute memory/search, changing answers while appearing error-free. The 1.2s result is not enough evidence to accept that risk.

### 5. Token ceilings satisfy the synthesis invariant, including generation

Estimated saving: none identified without changing answer completeness.  
Evidence: reasoned from `backend/lib/router.js:413-430`, `backend/server.js:343-355`, and the passing guard in `backend/lib/request-budget.test.js:242-264`.

The combinations are: simple lookup draft 400 ≤ synthesis 500; ordinary moderate draft 1000 ≤ synthesis 1000; detailed complex draft 2000 ≤ synthesis 4000; generation draft 4000 ≤ synthesis 4000. The generation branch is explicit at `router.js:430`, and the synthesis call uses the complexity ceiling at `server.js:2628`. The guard checks the largest draft ceiling against the complex synthesis ceiling; because the smaller ceilings map monotonically to the larger synthesis values above, the invariant holds for every combination. Backend tests passed, including this guard.

Recommended action: retain the current ceilings. A lower synthesis cap would truncate user-visible generation; a lower seat cap could truncate drafts before synthesis.  
Risk: any reduction changes answer completeness and is out of scope for a behavior-preserving optimization.

### 6. Streaming does not buffer the final answer unnecessarily, but seat streaming is structurally absent

Estimated saving: no exact millisecond saving claimed. The code establishes a measurable latency opportunity, not its size: the first answer token cannot be emitted until non-streaming seats settle and synthesis starts.  
Evidence: `backend/server.js:251-290`, `backend/server.js:630-651`, `backend/server.js:2622-2629`, and `frontend/src/hooks/useChats.js:962-980`.

`streamModel()` reads SSE frames and writes each text frame immediately. `openStream()` flushes headers and sets `X-Accel-Buffering: no`. The frontend buffers only an incomplete SSE line, while `acc` remains the source of truth and the reveal paints it progressively. The final synthesized response is not collected server-side before streaming.

The structural wait is earlier: council seats are requested with `stream: false` through `callModel` (`backend/server.js:2206` and `backend/server.js:2511`), then the full response set is assembled before `streamModel()` is called. Pipelining seat deltas into synthesis is a substantial redesign; it could alter reconciliation order, cancellation, and partial-answer semantics.

Recommended action: treat seat streaming/pipelining as a separately specified latency project. Do not change `streamModel()` or the client consumer for a speculative micro-optimization.

Risk: changing seat streaming can change what synthesis sees, when tools are requested, and how abort/quorum behavior works. It is not a no-behavior-change patch.

### 7. Search cache keys are conservative and cache identical work across instances

Estimated saving: no hit-rate percentage can be derived without production counters. Each cache hit avoids the provider fan-out for that identical key; the opportunity is repeated query work within the 15-minute TTL.  
Evidence: `backend/lib/search-cache.js:38-58`, `backend/server.js:876-892`, `backend/server.js:1110-1118`, `backend/server.js:1558-1569`.

The comprehensive key includes query, Wikipedia-vs-web provider set, freshness label, and country. Those fields capture the answer-changing inputs visible in the call path. The tool-search key is query-only because that path has no freshness or region argument (`backend/server.js:860-872`). Firecrawl is keyed by URL (`backend/server.js:595-606`) and returns the same extracted page shape regardless of the price flag.

The cache does not include user id, timestamps, or volatile request identity, so identical work can hit across users and Render instances. L1 is bounded at 200 entries and 15 minutes by default; L2 persists the result and writes are fire-and-forget (`backend/lib/search-cache.js:38-46`, `backend/lib/search-cache.js:183-210`). Reads have a 400ms deadline, so a slow cache cannot hold the search path longer than intended.

Recommended action: instrument and report `hitsL1`, `hitsL2`, and `misses` by key family before changing TTL or key shape. The existing unit tests cover wiki separation, region separation, TTL, LRU, and cross-instance promotion.

Risk: broadening a key can reduce hits; omitting freshness, provider-set, or country inputs can serve stale or geographically wrong results. The current key should not be simplified.

### 8. Database access has no N+1 or unbounded tenant read in the checked request paths; there is limited column overfetch

Estimated saving: no request or latency saving measured. `checkSuspended()` and `ensureUser()` select `*` (`backend/server.js:1728`, `backend/server.js:1761`), and chat creation uses `.select()` after inserting an empty chat (`backend/server.js:3167`), so a narrower projection could reduce response bytes. The arithmetic is not available without row-width and latency measurements.

The tenant-scope suite passed and reports every `chats`/`chat_files` query owner-scoped, summary reads/writes scoped, semantic RPCs carrying the resolved owner, and the chat list bounded. Concrete bounded queries include files `.limit(MAX_FILES_PER_CHAT)` (`backend/server.js:726`), feedback `.limit(6)` (`backend/server.js:1185`), facts `.limit(limit)` (`backend/server.js:1293-1298`), and admin usage `.limit(30)` (`backend/server.js:3267`). Chat-list query/index coverage is guarded by backend tests.

Recommended action: measure row sizes and query timings before narrowing `select('*')`. Read live `pg_indexes` before proposing an index; repository migrations are not authoritative for production schema.

Risk: narrowing a projection without tracing all consumers can remove fields needed by auth, plan, profile refresh, or response construction. Adding an index has write/storage cost and cannot be justified from code alone.

### 9. Frontend bundle: markdown is split, but it is not deferred as far as CodeBlock

Measured saving opportunity: `markdown-BzUDOM8y.js` is 160.92 kB raw / 49.11 kB gzip in the successful `npm run build`.  
Measured build: 3,891 modules transformed; largest JS chunks were markdown 160.92 kB, vendor 142.62 kB, app index 133.22 kB, framer 124.67 kB, and CodeBlock 111.94 kB. CSS was 101.19 kB raw / 18.47 kB gzip.

`CodeBlock` is genuinely lazy: `frontend/src/components/MessageList.jsx:13` uses `lazy(() => import("./CodeBlock"))`, and the build emits `CodeBlock-8vN8ubUQ.js`. Markdown is a separate chunk, but `MessageList-Bxvy-vH9.js` statically imports `markdown-BzUDOM8y.js`; therefore it loads whenever the signed-in `MessageList` chunk loads, even for a conversation with no markdown. `frontend/src/App.jsx:36-37` already lazily loads `MessageList` and `OverlayAssistant`, so signed-out visitors do not pay these chunks.

Recommended action: if first authenticated paint matters, lazy-load the markdown renderer or use the existing plain-text streaming path until completion, then load Markdown on demand. Measure the signed-in first-paint tradeoff after the change.

Risk: deferring Markdown adds a network round trip and can delay formatted completed messages; changing the fallback can cause a temporary plain-text-to-markdown transition. Keep the CodeBlock fallback to preserve immediate code rendering.

### 10. Cold start is already overlapped on the frontend; backend module initialization remains a candidate, not a quantified saving

Measured baseline: 22.5s cold `/health` and 0.21s warm are documented as measured in `frontend/src/lib/api.js:152-177`; no authenticated production boot was remeasured here because this workspace lacks the production OpenRouter credentials.

At backend startup, Sentry/profiling, Express middleware, Supabase, Clerk, Stripe, the council runner, tool registry, search providers, cache, embeddings, TTS, admin commands, and terminal access are all loaded at module scope (`backend/server.js:14-44`, `backend/server.js:86`, `backend/server.js:201`, `backend/server.js:362`, `backend/server.js:679-705`, `backend/server.js:1209`, `backend/server.js:2833-2834`). Route-specific dynamic loading could reduce initialization work, but the repository supplies no module-by-module boot timing, so no ms saving is claimed.

Recommended action: add boot-phase timing around module loading and compare it with platform/container startup before deferring imports. The frontend `warmBackend()` already fires `/health` without awaiting it (`frontend/src/lib/api.js:175-178`), overlapping cold boot with Clerk and sign-in.

Risk: lazy module loading moves failures from boot to the first route and can add a request-path delay. Deferring auth, Supabase, or common middleware can change health behavior or error timing. This is high-value only if measurement identifies a heavy module that is not needed for `/health` or the first route.

## What was checked and already optimal

- Backend tests: 698 passed, 0 failed, including request-budget, router, search-cache, tenant-scope, streaming, and token-cap tests.
- Frontend build: passed with the measured output above.
- Frontend tests: one failure in `src/__tests__/cssSnapshot.test.js` because the concurrent CSS work changed the committed cascade baseline at its first diff (test output line 19433). No CSS or baseline file was touched.
- Council sizing is already adaptive: `backend/lib/router.js:304-305` defines simple = 1, moderate = 3, and complex = full roster; `backend/lib/router.js:334-366` chooses fast representatives without accidentally selecting the known 23.9s seat for a narrowed tier.
- Search providers fan out concurrently and stop at a deadline (`backend/server.js:975-1022`); page reads are concurrent under a shared 2.5s deadline (`backend/server.js:1092-1102`).
- Search-cache reads are time-bounded and writes are not awaited (`backend/lib/search-cache.js:29-35`, `backend/lib/search-cache.js:138-153`, `backend/lib/search-cache.js:183-205`).
- SSE response headers disable intermediary buffering, and the backend emits chunks as frames arrive (`backend/server.js:638-651`, `backend/server.js:258-289`).
- The client keeps streaming content as plain text and parses Markdown once after completion (`frontend/src/components/MessageList.jsx:357-397`), avoiding repeated Markdown parsing during token arrival.
- The sidebar cache uses an allowlist/signature and avoids writes on every streaming render (`frontend/src/hooks/useChats.js:283-306`).
- Tenant query safeguards are present and passing; no N+1 pattern or unbounded ordinary tenant read was found in the inspected server paths.

## Best saving-to-risk ratio

1. Correct request accounting and add per-source counters. Saving: no direct requests, but it closes the account-wide cap blind spot and identifies the next safe one-request deferral. Risk: low if limited to telemetry/metering; do not remove calls in the same change.
2. Defer the markdown chunk until a completed message needs formatted rendering. Saving: measured 160.92 kB raw / 49.11 kB gzip from the authenticated message-loading path. Risk: moderate, limited to an extra chunk request and fallback timing.
3. Measure and, only if justified, defer route-specific backend modules. Saving: potentially part of the measured 22.5s cold-start experience, but the deferrable share is currently unmeasured. Risk: moderate-to-high because first-request failures and latency move from boot to route execution.

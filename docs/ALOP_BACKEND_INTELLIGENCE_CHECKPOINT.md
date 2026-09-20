# ALOP-AI Backend Intelligence Checkpoint

Status: Phase B0.5 in progress; local evaluator/auth contract and bypass review complete; production baseline blocked at Render workspace/secret authorization; no orchestration rewrite; no Sol High call.

Date: 2026-08-24 (Asia/Dubai)

`BACKEND_SOL_HIGH_CALLS=0`

## Scope

The frontend redesign is frozen. This checkpoint covers backend routing, council orchestration, cache behaviour, search/tools, provider resilience, telemetry, and evaluation preparation only.

The requested stop boundary is active: reconstruct the truth, make a cache-bypassed baseline possible, trace latency/request/token signals, prepare the independent quality handoff, and stop before a major orchestration rewrite or Sol High call #1.

## Current truth

| Surface | Evidence | Status |
|---|---|---|
| Live service | `GET https://alop-ai.onrender.com/health` returned HTTP 200 with commit `66b727a19c506ae7171b1bf12211e06c109dff40`, one instance, `limitsMultiplied=false`, Postgres rate-limit store | Verified 2026-08-24 |
| Current worktree | Branch `fix/release-mobile-cls`, HEAD `a8a95540fb6447b1e3aff453ee1e908a761f0394` | Verified locally |
| Local `main` | `0461c191eb6ce102c1b3cf54cff89185afb44fe8` | Verified locally |
| `origin/main` | `d1c45a62258c159fbe482f6bfceda1a6b4c8d79c` | Verified locally |
| Backend relation to live | The live SHA is an ancestor of the current branch; no backend diff was found from the live SHA to HEAD | Verified locally |
| Backend tests | `npm test`: 2,126 passed, 0 failed, 0 skipped | Verified locally |
| Dataset validation | `backend-intelligence-v1`: 21 cases, valid; `core-v1`: 22 cases, valid | Verified locally |
| Fresh live evaluation | Not run: no evaluator credential and no configured cache-bypass secret were available | Intentionally blocked |

The worktree also contains user-owned frontend documentation, screenshots, and other untracked redesign artefacts. They were preserved and not staged, committed, deployed, or edited by this backend phase.

## Current request path

```text
authenticated POST /api/council
  -> arithmetic / greeting / memory / cache gates
  -> context DAG and compression
  -> rule router + model planner
  -> tier roster and research widening
  -> plain council or optional tool loop
  -> synthesis head/fallback ladder or safe solo draft
  -> evidence verification for cache writes
  -> SSE answer + audit row + turn ledger metadata
```

The route already has the main observability primitives needed for a useful study: physical provider attempts, per-phase token usage when a provider reports it, stream-open/body timing, first-token timing, context/router/cache timings, seat outcomes, tool outcomes, fallback records, cancellation reason, and bounded provenance. The important limitation was the public evaluation surface: before this phase it did not prove cache misses or expose first-useful-stage timing to the runner.

## Exact evaluation contract

| Item | Contract |
|---|---|
| Target | `POST https://alop-ai.onrender.com/api/council` |
| Response | Authenticated SSE stream; send `Accept: text/event-stream` |
| Authentication | `Authorization: Bearer <Clerk session JWT>`; the route runs `requireAuth` then `checkSuspended` and resolves the Supabase user row by Clerk subject |
| Request identity | Optional validated UUID `X-Operation-Id`; the runner generates one per case |
| Request body | At minimum `{message, history}`; history entries are user/assistant messages |
| Server Clerk requirements | `CLERK_PUBLISHABLE_KEY` mounts verification middleware; `CLERK_SECRET_KEY` is required at boot; `FRONTEND_URL`/`ALLOWED_ORIGINS` provide authorized parties |
| Dedicated evaluator path | Runner-side `EVAL_CLERK_SECRET_KEY` calls Clerk Backend API, requires explicit `EVAL_USER_ID`, creates a temporary sign-in token, redeems it through the Clerk Frontend API with `EVAL_ORIGIN`, mints a fresh JWT per case, and revokes the temporary session on exit |
| Runner configuration | `BASE`, `EVAL_CLERK_SECRET_KEY`, `EVAL_USER_ID`, `EVAL_ORIGIN`; optional `EVAL_CLERK_FAPI`; `EVAL_TOKEN` is only a short one-case fallback |
| Fresh-execution gate | `--cache-bypass` plus runner `EVAL_CACHE_BYPASS_SECRET`, matching server `ALOP_BENCHMARK_CACHE_BYPASS_SECRET` |
| Proof | Authorized responses carry `X-ALOP-Cache-Status: bypass`; the runner aborts if it is absent or different |
| Rate/cost | `/api/council` has a 30/minute route limiter plus the `/api/` 120/minute floor; model requests also pass per-turn/account-wide request and spend reservations and can consume real provider quota |

The runner now refuses to select an arbitrary first Clerk user when `EVAL_USER_ID` is absent. It does not use service-role impersonation, a fake auth path, disabled Clerk middleware, or a backdoor evaluator endpoint.

## Credential-source audit

- Local environment files contain ordinary backend keys but no `EVAL_*` variables and no `ALOP_BENCHMARK_CACHE_BYPASS_SECRET` value. Secret values were not printed or opened for reuse.
- CI workflows contain backend tests/build checks but no evaluator credential or benchmark-secret workflow.
- `render.yaml` now declares `ALOP_BENCHMARK_CACHE_BYPASS_SECRET` as `sync: false`; it contains no value. The actual Render service environment remains unchanged.
- The repository contains an existing admin `TERMINAL_SECRET`, but it is not suitable for benchmark bypass and will not be reused across security boundaries.
- A Chrome DevTools connector exists, but its browser profile was already running and could not be inspected. No browser token was read or copied.
- The Render connector has one accessible workspace, `My Workspace`, but no workspace is selected. Its safety contract requires explicit user confirmation before reading or changing service resources; I did not guess or select it.

## Instrumentation safety review

- No header or no configured secret leaves the normal cache path unchanged.
- Wrong, array-shaped, or case-mismatched secrets fail closed; comparison uses `crypto.timingSafeEqual` after length checking.
- The bypass is evaluated inside the authenticated council handler only. It does not alter Clerk, suspension checks, tenant predicates, spend reservations, rate limits, router decisions, model rosters, search policy, or judge/verification behavior.
- Both exact and semantic answer-cache paths are skipped only for an authorized request. Normal cache writes are also suppressed for that request.
- The proof is a fixed literal status and never contains either secret. The helper has no mutable state, so authorization does not persist across requests.
- The full backend test suite and focused source/wiring tests cover these properties.

## Current orchestration shape

- The simple tier selects one seat. Moderate and complex tiers retain the full entitled roster before research widening.
- A research turn widens simple and moderate selections to three seats; genuinely complex research retains the full roster.
- A free-plan roster is capped at three free seats; a pro roster can use the seven-seat council.
- The plain council is the default. Progressive waves, adaptive ordering, semantic answer cache, live council tools, seeded search, answer-verification enforcement, and tiered memory are explicit runtime flags rather than assumptions in this report.
- The default synthesis head is `nvidia/nemotron-3-ultra-550b-a55b:free`; the simple primary is `google/gemma-4-26b-a4b-it:free`.
- The seven configured council seats and their source-recorded latency ranks are documented in [ALOP_MODEL_CONTRIBUTION.md](ALOP_MODEL_CONTRIBUTION.md). Those ranks are historical comparison inputs, not a current production health sample.
- Synthesis receives the textual drafts and research block. The current synthesis prompt does not receive a separate structured disagreement ledger or judge score; source conflict verification is used for cacheability and provenance, not as a structured adjudication input to the final writer.

## Highest-confidence findings

1. Fresh baseline evidence is the gating gap. The live health identity is verified, but authenticated p50/p95, TTFT, request counts, token counts, cache precision, and provider failure rates are not current measurements.
2. The cache-bypass control is now secret-gated and self-proving. A benchmark request must receive `X-ALOP-Cache-Status: bypass`; otherwise the runner fails instead of grading an unproven fresh execution.
3. The static router rehearsal found a concrete likely search waste: the product-model heuristic interprets `serving 30 requests` and `takes 200 ms` as model-shaped phrases, producing queries such as `serving 30 specs review` and `takes 200 specs review`. This is a code-path hypothesis until a fresh run measures its rate.
4. The existing code has richer telemetry than the old evaluation runner consumed. The runner now observes first body byte, first useful stage, first answer token, provenance, and the cache-bypass proof; the durable turn ledger already stores an allow-listed reliability snapshot at completion.
5. The current code contains documented historical provider weakness, notably the 31B Gemma free seat's repeated 429 probe history and the retired Ling seat. No current production rate can be claimed until persisted attempt rows are queried over a fresh window.

## Low-risk work completed in this phase

- Added `backend/lib/benchmark-cache-bypass.js` and unit coverage. It uses a separately configured secret and constant-time comparison; it never logs or returns the secret.
- Wired the bypass into `/api/council` so exact and semantic answer-cache work is skipped and the response proves the bypass.
- Extended `scripts/run-evals.mjs` to send and require the proof, preserve case history, and capture first-byte, first-useful-stage, first-answer-token, cache status, and provenance.
- Extended evaluation summaries with timing percentiles and validated history entries.
- Added the 21-case `backend-intelligence-v1` dataset spanning stable questions, current-information search, context, evidence, routing, tools, arithmetic, and safety boundaries.
- Made dedicated `EVAL_USER_ID` mandatory for Clerk secret-based evaluation; arbitrary first-user selection is now refused.
- Declared the bypass secret name in `render.yaml` without storing a value.

No major orchestration rewrite, runtime configuration mutation, deploy, publish, or Sol call was performed.

## Stop decision

Sol High call #1 is not justified yet. The exact human-only blocker is Render workspace selection: confirm that the `My Workspace` Render workspace is the intended target. After confirmation, the next required secret is `ALOP_BENCHMARK_CACHE_BYPASS_SECRET` on the `alop-ai` service, with the same value supplied only through evaluator-side `EVAL_CACHE_BYPASS_SECRET`. No secret value belongs in chat, docs, git, or logs. The missing authenticated evaluator identity is `EVAL_USER_ID` for a dedicated Clerk test account, with `EVAL_CLERK_SECRET_KEY` supplied securely if the existing Clerk automation is used.

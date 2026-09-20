# ALOP-AI Backend Baseline

Status: baseline harness prepared; cache-bypassed authenticated production run not completed.

Date: 2026-08-24

## Executive result

There is no honest fresh production p50, p95, TTFT, request-count, token-count, cache-precision, or provider-health number yet. The public health check proves which commit is serving, not how an authenticated turn behaves. The evaluator stopped before any model request because the dedicated evaluator identity, fresh-execution secret, and confirmed Render workspace were not available in the approved workspace boundary.

No latency or quality result in this document should be treated as a current production baseline unless it is labelled historical.

## Verified deployment identity

`GET https://alop-ai.onrender.com/health` on 2026-08-24 returned:

```json
{"status":"ok","time":"2026-08-23T23:04:38.845Z","commit":"66b727a19c506ae7171b1bf12211e06c109dff40","instances":1,"limitsMultiplied":false,"rateLimitStore":"postgres"}
```

The live commit is an ancestor of the current local branch. The backend has no diff between that live SHA and the current HEAD, but the local worktree is dirty with user-owned changes and the new uncommitted measurement scaffolding. No deploy was attempted.

## Measurement ledger

| Metric | Fresh cache-bypassed production result | Why it is blank |
|---|---:|---|
| Total latency p50/p95 | Not measured | Authenticated run did not start |
| First response body byte | Not measured | Same boundary |
| First useful stage | Not measured | Same boundary |
| First answer token | Not measured | Same boundary |
| Requests per tier | Not measured | Requires completed turns and telemetry readback |
| Physical provider attempts/retries | Not measured | Requires completed turns and telemetry readback |
| Prompt/completion/total tokens | Not measured | Requires completed turns and provider usage reporting |
| Cost per turn | Not measured | Public runner does not expose cost; durable telemetry is the source to query |
| Cache hit precision | Not measured | Previous runner could not prove a miss or observe a cache source |
| Search precision/recall | Not measured | Requires live tool/provenance frames and answer grading |
| Model contribution | Not measured | Requires independent drafts plus final answer scoring |

Historical context only: the prior audit records a cache/rate-contaminated eval run with p50 26.6 seconds and p95 69.7 seconds. Those values are not reused as this baseline.

## Cache-bypassed method

The benchmark path is intentionally opt-in:

1. Confirm the intended Render workspace and service `alop-ai`.
2. Configure `ALOP_BENCHMARK_CACHE_BYPASS_SECRET` outside the repository.
3. Give the runner the same value as `EVAL_CACHE_BYPASS_SECRET`.
4. Supply a dedicated Clerk evaluator identity as `EVAL_USER_ID` and use the legitimate `EVAL_CLERK_SECRET_KEY` minting path, or a short-lived `EVAL_TOKEN` only for a one-case smoke test.
5. Run `scripts/run-evals.mjs --cache-bypass` against the authenticated target.
6. The server skips exact and semantic answer-cache work and returns `X-ALOP-Cache-Status: bypass`.
7. The runner aborts if the proof header is absent or different. A silent cache hit cannot become a fresh-execution result.

The control is not enabled in the repository, and no Render environment or secret was changed during this phase.

## Runner observations now available

Each completed observation can carry:

- `latencyMs`: end-to-end stream duration;
- `firstByteMs`: first response body byte;
- `firstUsefulStageMs`: first stage, tool-start, or provenance frame;
- `firstAnswerTokenMs`: first non-empty answer chunk;
- `cacheStatus`: proof header value;
- `provenance`: bounded route, stage, council, synthesis, tool, verification, and source counts;
- all SSE frames needed for tool and citation grading.

The durable turn ledger also receives a bounded reliability snapshot at completion, including physical provider attempts, retries and statuses, per-phase usage when supplied, stream timing, seats, tools, context/router/cache timings, synthesis, fallbacks, cancellation, and provenance.

## Why execution stopped

The fresh-run guard produced:

```text
--cache-bypass requires EVAL_CACHE_BYPASS_SECRET; no fresh run will start without it.
```

The normal one-case runner also stopped before HTTP with the explicit missing-credential message. Selecting an arbitrary user, printing or reusing repository secrets, changing Render configuration, or deploying solely to obtain a measurement would cross the approved boundary. Therefore no production model request was spent by this phase.

## Next evidence required

An authorized operator must supply the evaluator credential and configure the benchmark secret on the target deployment, then run the dataset slowly enough to respect the account-wide provider limit. The resulting report must be paired with durable telemetry readback before any p50/p95 or model-contribution claim is promoted.

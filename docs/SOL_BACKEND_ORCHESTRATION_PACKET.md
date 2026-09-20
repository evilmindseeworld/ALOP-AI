# Sol Backend Orchestration Packet

Status: compressed packet prepared; do not invoke Sol High yet.

Date: 2026-08-24

`BACKEND_SOL_HIGH_CALLS=0`

## Stop boundary

This packet is the handoff for a future independent orchestration review. It is intentionally not a Sol High call. The missing prerequisite is a cache-bypassed authenticated production baseline.

## Current evidence

- Live identity is verified at `/health`: commit `66b727a19c506ae7171b1bf12211e06c109dff40`, one instance, Postgres rate-limit store, no multiplied limits.
- Current backend tests pass: 2,126/2,126.
- The new intelligence dataset is valid: 21 cases.
- Fresh execution is not measured. The runner refuses without an evaluator credential and a secret-gated cache-bypass proof; no live model request was spent here.
- Static router rehearsal: 10 simple, 7 moderate, 4 complex; 13 planner, 3 stable-rule, 5 search-rule outcomes.
- Concrete routing lead: the model-designation heuristic produced `serving 30 specs review` and `takes 200 specs review` from ordinary infrastructure/math prose.
- Current roster: seven seats; free plans are capped at three free seats; simple starts at one; research widens simple/moderate to three; complex retains the full entitled roster.
- The synthesis writer receives textual drafts and research, but no separate structured disagreement/judge packet.
- Current source records physical attempts, status, retries, stream timing, usage-by-phase when reported, cache reads, tools, context, fallbacks, and bounded provenance in completed turn metadata. The public runner now observes cache proof and first-useful-stage timing.

## Questions for the future Sol review

1. Given the fresh trace, what is the smallest low-risk change that removes the largest measured latency or request waste?
2. Should the router fix the model-designation false positives before any council rewrite, and what negative/positive test gate is sufficient?
3. Is the current simple-one-seat path safe for each factuality and risk class, or should research/freshness/evidence requests widen before tools?
4. What structured disagreement representation should travel from seats and source verification into synthesis without exposing hidden reasoning?
5. Which model or provider should be demoted based on measured availability, first-token time, useful-draft rate, token cost, and final-answer influence?
6. Should progressive/adaptive orchestration remain off until a measured agreement threshold and abort-cost gate exist?
7. What p50/p95/TTFT, request, token, search, cache, and factuality gates must pass before changing production routing?
8. Is a major orchestration rewrite justified at all after the baseline, or can the largest losses be addressed with isolated routing, caching, pacing, or prompt changes?

## Required evidence attached to any future call

- cache-bypass proof for every fresh case;
- complete case-level latency fields;
- physical provider attempts and statuses;
- request counts by route/tier/plan;
- token usage by phase;
- provenance and tool frames;
- answer grades independent of the production writer;
- explicit separation of cache hits, cache misses, auth failures, provider failures, client aborts, and incomplete traces.

Until that packet is populated, Sol High call #1 is not justified.

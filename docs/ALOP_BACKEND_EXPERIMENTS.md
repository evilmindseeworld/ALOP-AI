# ALOP-AI Backend Experiments

Date: 2026-08-24

This is the experiment ledger for the reconstruction and baseline phase. It records what was actually run and separates local evidence from live evidence.

| ID | Experiment | Result | Evidence boundary |
|---|---|---|---|
| X1 | Secret-gated cache bypass unit test | 5 tests passed: absent header, missing secret, wrong secret, valid secret, exact comparison | Local only |
| X2 | Cache-bypass route wiring | Exact/semantic cache key work is disabled for an authorized request; response proof header is emitted | Source + unit harness; not deployed |
| X3 | Runner timing/provenance extension | Node syntax check passed; runner now captures first byte, first useful stage, first answer token, cache proof, and provenance | Local only |
| X4 | Intelligence dataset validation | `backend-intelligence-v1`: 21 cases valid; `core-v1`: 22 cases valid | No model calls |
| X5 | Static router rehearsal | 21 cases classified: 9 simple, 7 moderate, 5 complex; 13 planner, 3 stable-rule, 5 search-rule outcomes | Source execution; not production traffic |
| X6 | Fresh-run safety guard | Refused before HTTP without `EVAL_CACHE_BYPASS_SECRET` | Local only |
| X7 | Authenticated smoke-run guard | Refused before HTTP without an evaluator token/session minting configuration | Local only |
| X8 | Backend regression suite | 2,126/2,126 tests passed; 0 failed, cancelled, skipped | Local only |
| X9 | Dedicated evaluator identity guard | Runner now refuses `EVAL_CLERK_SECRET_KEY` without explicit `EVAL_USER_ID`; arbitrary first-user selection removed | Local source/test only |
| X10 | Render credential-source inspection | One accessible workspace found, but none selected; no service or environment values read or changed | Connector metadata only |

## X5 details: static routing hypothesis

The current product-model rule runs before the volatility fallback. On the representative dataset it interpreted:

- “Should a two-person team put a Postgres read replica in front of an app serving 30 requests a minute?” as a model lookup with query `serving 30 specs review`.
- “A database query takes 200 ms and runs 120 times per minute...” as a model lookup with query `takes 200 specs review`.

This is a concrete likely search waste and a quality risk, but it is not yet a production precision rate. The safe next experiment is a cache-bypassed run with per-case provenance and router decision evidence, not a broad router rewrite.

## Deliberately unrun experiments

- No live evaluator run: credentials and benchmark secret were not available.
- No Render environment inspection: the connector requires explicit workspace confirmation before resource access.
- No provider roster probe: that would spend external quota and requires explicit runtime authority.
- No adaptive/progressive/tool flag enablement.
- No cache-secret deployment or Render environment mutation.
- No major orchestration rewrite.
- No Opus model call and no Sol High model call.

## Interpretation rule

Local test counts establish code contracts. Static router output establishes current code behaviour for supplied strings. Neither establishes production latency, current provider health, search precision, cache precision, or final-answer quality.

# Backend P1 evaluation v2

This document records the offline candidate built from the Aug 30 ground truth. It is an evaluator and evidence repair, not a production runtime repair.

## Lineage and source of truth

- Base: `a45e44a9bac0f3cf64061b6ecd68953a5c4b2511`
- Rejected candidate: `f721f65f49df2dde59b170142fc1218d6ec6de69` — not continued or amended
- Authoritative artifact: `C:\Users\LENOVO\Documents\Codex\2026-08-30\files-pasted-by-the-user-alop\artifacts\p1-authoritative-20260830-1100\backend21.json`
- Authoritative artifact SHA-256: `6764AA6A6F7A5AC7160BCD2AEB35613CE8C4375C5E05312CE551DF3052F6C38E`
- Historical Aug 28 output is not an input to this candidate.

The authoritative run had 21 cases, 20 evaluated, 17 passes, 3 failures, and 1 inconclusive result. The three failures were the summary literal false negative and two clear terminal fragments. The weather internal error remains inconclusive and has no production diagnosis in this offline work.

## Manifest transition

`backend-intelligence-v1.json` remains unchanged as the historical manifest. `backend-intelligence-v2.json` has exactly 21 cases: it replaces `user-text-summary` one-for-one with `user-text-summary-v2` and adds no water/light or other denominator-expanding cases.

The new summary expectation is `worker-lease-retry-reclaim-v1`. It checks bounded semantic relations for:

1. a worker retrying a failed job;
2. a lease enforcing worker ownership; and
3. another worker reclaiming after lease expiry.

The test suite covers 10 bounded inflection/passive/paraphrase positives and 16 adversarial negatives for missing relations, unrelated retry/failure, unsupported ownership wording, negation, reversed timing, and substring-only vocabulary.

## Factuality measurement

Factuality is explicit metadata on five stable model-involved cases with six assertions. Each assertion has a claim, positive patterns, and forbidden patterns. The result is calculated independently from whole-case acceptance: a latency/completeness failure can have a passing factuality result, while a broad keyword pass can have a failing factuality result.

The factuality gate samples `factualityMeasuredCases`, not the 21-case dataset denominator. Current price, Node release, and weather cases are intentionally not frozen; deterministic arithmetic and model-free cases do not count as model factuality evidence. Negation, reversed relation, wrong entity/value association, wrong numeric value, wrong pigment, and keyword stuffing are covered offline.

The five factuality cases have these generalization controls:

- `simple-fact-japan-capital`: POSITIVE PARAPHRASES = `Tokyo is the capital of Japan`; `Japan's capital city is Tokyo`. NEGATIVE COUNTEREXAMPLES = `Tokyo is the capital of France`; `Tokyo is not the capital of Japan`. WHY RULE GENERALIZES = bounded subject/value/entity relations cover ordinary geography phrasing without accepting a wrong country or negation.
- `simple-explanation-photosynthesis`: POSITIVE PARAPHRASES = `Plants use chlorophyll to capture light energy during photosynthesis`; `During photosynthesis, chlorophyll absorbs sunlight`; `Chlorophyll harnesses solar energy during photosynthesis`; `Chlorophyll captures sunlight for photosynthesis`. NEGATIVE COUNTEREXAMPLES = a light-energy explanation that omits chlorophyll; `plants use melanin rather than chlorophyll`; `chlorophyll is unrelated`; `plants do not use chlorophyll`; `chlorophyll plays no role in photosynthesis`. WHY RULE GENERALIZES = the positive relation requires chlorophyll together with light capture/use in photosynthesis in either subject order, while bounded forbidden patterns reject negation and wrong-pigment substitution.
- `moderate-cache-tradeoff`: POSITIVE PARAPHRASES = `caching reduces latency`; `a stale cached result can be wrong and needs refresh`. NEGATIVE COUNTEREXAMPLES = `a cache never returns stale data`; `caching does not improve speed`. WHY RULE GENERALIZES = speed benefit and freshness risk are independent, stable systems concepts represented by two assertions.
- `search-not-needed-binary-search`: POSITIVE PARAPHRASES = `binary search on an ordered list halves the remaining range`; `sorted input gives binary search logarithmic time`. NEGATIVE COUNTEREXAMPLES = `binary search does not require sorted input`; `binary search inspects every element linearly`. WHY RULE GENERALIZES = the rule binds the algorithm to its ordered-input and halving invariants rather than accepting isolated algorithm vocabulary.
- `timeless-definition-idempotency`: POSITIVE PARAPHRASES = `repeating an idempotent API request leaves the same state without a duplicate side effect`; `performing an idempotent operation again produces the same result with no extra effect`; `an idempotent operation does not create another side effect when repeated`; `retries leave the same state without creating duplicate effects`. NEGATIVE COUNTEREXAMPLES = the punctuation-free keyword salad; `repeated idempotent requests create duplicate effects`; an idempotent API behaves differently on repetition; retries always add another side effect. WHY RULE GENERALIZES = bounded relations require repetition, the same result/state, and the no-additional-effect consequence, with negation-aware forbidden relations preserving genuine duplicate-effect rejection instead of accepting nearby keywords.

The assertion result is AND-ed per case: a measured case passes factuality only when every assertion in that case passes.

## Recovery projection and next gate

The v2 recovery manifest is a deterministic 10-case projection of the committed v2 manifest. Validate it with:

```text
node scripts/recovery-manifest.mjs --check
```

### Recovery10 gate expectation

`backend-intelligence-v2-recovery10` intentionally selects only one of the five model-involved factuality cases. With the unchanged factuality gate (threshold `0.95`, sample `factualityMeasuredCases`, minimum sample `5`), its factuality result is expected to be **inconclusive**, not a release pass/fail conclusion. It is a focused behavioral recovery projection, not a complete factuality release gate.

The exact diagnostic/recovery invocation is:

```text
node scripts/run-evals.mjs --dataset backend-intelligence-v2-recovery10 --base "https://alop-ai.onrender.com" --cache-bypass --allow-inconclusive --report ../eval-runs/backend-intelligence-v2-recovery10-authoritative.json
```

`--allow-inconclusive` is only for this focused recovery workflow; it cannot rescue a measured breach. The full v2 gate uses the command below without `--allow-inconclusive`.

The next authorized live gate, from `backend`, is:

```text
node scripts/run-evals.mjs --dataset backend-intelligence-v2 --base "https://alop-ai.onrender.com" --cache-bypass --report ../eval-runs/backend-intelligence-v2-authoritative.json
```

That command is documented only; this candidate performs no model inference, deployment, merge, or live evaluation.

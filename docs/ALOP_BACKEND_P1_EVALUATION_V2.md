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

The test suite covers inflection/paraphrase positives and adversarial negatives for missing relations, unrelated retry/failure, negation, and substring-only vocabulary.

## Factuality measurement

Factuality is explicit metadata on five stable model-involved cases with six assertions. Each assertion has a claim, positive patterns, and forbidden patterns. The result is calculated independently from whole-case acceptance: a latency/completeness failure can have a passing factuality result, while a broad keyword pass can have a failing factuality result.

The factuality gate samples `factualityMeasuredCases`, not the 21-case dataset denominator. Current price, Node release, and weather cases are intentionally not frozen; deterministic arithmetic and model-free cases do not count as model factuality evidence. Negation, reversed relation, wrong entity/value association, wrong numeric value, and keyword stuffing are covered offline.

## Recovery projection and next gate

The v2 recovery manifest is a deterministic 10-case projection of the committed v2 manifest. Validate it with:

```text
node scripts/recovery-manifest.mjs --check
```

The next authorized live gate, from `backend`, is:

```text
node scripts/run-evals.mjs --dataset backend-intelligence-v2 --base "https://alop-ai.onrender.com" --cache-bypass --report ../eval-runs/backend-intelligence-v2-authoritative.json
```

That command is documented only; this candidate performs no model inference, deployment, merge, or live evaluation.

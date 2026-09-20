# Opus Backend Quality Baseline

Status: independent Opus call not invoked; handoff prepared.

Date: 2026-08-24

## Boundary

No Opus-capable subagent or model connector was callable in this task context. I therefore did not impersonate an Opus review or manufacture a quality score. The independent baseline remains pending and must consume the evidence below.

## Inputs prepared for Opus

1. [ALOP_BACKEND_INTELLIGENCE_CHECKPOINT.md](ALOP_BACKEND_INTELLIGENCE_CHECKPOINT.md)
2. [ALOP_BACKEND_BASELINE.md](ALOP_BACKEND_BASELINE.md)
3. [ALOP_BACKEND_EXPERIMENTS.md](ALOP_BACKEND_EXPERIMENTS.md)
4. [ALOP_ROUTER_EVAL.md](ALOP_ROUTER_EVAL.md)
5. [ALOP_MODEL_CONTRIBUTION.md](ALOP_MODEL_CONTRIBUTION.md)
6. `backend/evals/backend-intelligence-v1.json`
7. The current source-level synthesis path and telemetry contract

## Requested independent review

Opus should separately assess:

- factual usefulness and citation discipline by case class;
- whether one-seat simple routing is safe for the observed question mix;
- whether the current search rule is over-triggering on model-shaped prose;
- whether the final synthesiser has enough structured information about disagreement;
- whether the telemetry captures what is needed to attribute latency, requests, tokens, and model contribution;
- the smallest low-risk changes with measurable acceptance gates;
- whether a major orchestration rewrite is justified after the fresh baseline.

## Important uncertainty

The live quality baseline is not available yet. The current 21-case dataset is a prepared evaluation instrument, not a score. Historical evaluation numbers are explicitly excluded from current quality claims because the earlier run mixed cache, pacing, and authentication limitations.


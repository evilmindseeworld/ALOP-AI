# ALOP-AI Router Evaluation

Status: static rehearsal complete; live router evaluation pending authenticated baseline.

Date: 2026-08-24

## Dataset

`backend/evals/backend-intelligence-v1.json` contains 21 versioned cases:

- 10 statically classified simple;
- 7 moderate;
- 4 complex;
- stable definitions and transformations;
- current-information questions requiring search and citations;
- context follow-ups and longer context;
- evidence-sensitive reasoning;
- arithmetic, code, creative, safety, and user-provided text.

The file validates through the same loader used by the HTTP runner. No provider call was made during validation.

## Current code-path result

| Static decision | Cases | Meaning |
|---|---:|---|
| Planner | 13 | Model planner remains responsible for the decision |
| Stable rule | 3 | Current code says no live search is needed |
| Search rule | 5 | Current code forces a live-search branch |

The static rule is intentionally conservative for volatile words and citations. It also has a model-designation rule that runs before that fallback. The two concrete false-positive-shaped outputs observed above are the most important current router lead.

## Seat policy implied by the current source

| Plan | Simple before research | Moderate/complex before research | Research widening |
|---|---:|---:|---|
| Free | 1 of the three free seats | 3 of the three free seats | Simple/moderate widen to 3; complex stays full entitled roster |
| Pro | 1 of seven | 7 of seven | Simple/moderate widen to 3; complex stays 7 |

This is a source-derived request shape, not a production request count. Search, tool, fallback, synthesis, retry, and post-answer memory work can add physical provider attempts.

## What is good about the current shape

- Stable, simple lookup-shaped prompts can avoid a full council.
- A one-seat safe draft can skip synthesis.
- Research does not remain permanently at one seat: simple and moderate research can widen to three.
- Free-plan entitlement is applied before narrowing/widening.
- Search and citation demands are represented in the rule router and are testable without spending quota.

## What needs live measurement

- Search precision and recall by case tag.
- False product-model matches per 100 turns.
- Actual seat count and physical attempt count by complexity, plan, branch, and tool use.
- Whether model planner decisions agree with the rule router.
- Whether one-seat answers have lower factuality than three-seat research answers.
- p50/p95 latency and first-useful-stage timing for each route.

No routing fix is applied in this checkpoint. The correct next step is to collect a fresh trace and then make the smallest evidence-backed change.

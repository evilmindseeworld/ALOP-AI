# ALOP-AI Model Contribution and Resilience Map

Status: source roster reconstructed; live contribution scores unavailable.

Date: 2026-08-24

## Council roster in current source

| Model | Temperature | Plan flag | Source latency rank | Current interpretation |
|---|---:|---|---:|---|
| `nvidia/nemotron-3-super-120b-a12b:free` | 0.2 | pro-only | 23,900 ms | Strongest/slowest retained seat; source comment says measured floor |
| `cohere/north-mini-code:free` | 0.3 | free | 600 ms | Fastest measured replacement for retired Ling seat |
| `openai/gpt-oss-20b:free` | 0.4 | pro-only | 2,500 ms | OpenAI-lineage diversity; source comment records a mixed 429 sample |
| `poolside/laguna-s-2.1:free` | 0.5 | pro-only | 8,900 ms | Middle ladder seat |
| `google/gemma-4-31b-it:free` | 0.6 | pro-only | unmeasured | Source comments record repeated 429 probe history; no invented rank |
| `google/gemma-4-26b-a4b-it:free` | 0.7 | free | 2,400 ms | Current primary/fast model |
| `nvidia/nemotron-3-nano-30b-a3b:free` | 0.8 | free | 2,100 ms | Free-plan ladder seat |

The three free seats are Cohere North, Gemma 26B, and Nvidia Nano. The source ranks are historical comparison inputs and are not a current health window. They were not re-probed in this phase.

## Writer and fallback path

- Simple turns can use `google/gemma-4-26b-a4b-it:free` as the primary writer.
- Non-simple or tool-backed turns use the configured synthesis head; the default is `nvidia/nemotron-3-ultra-550b-a55b:free`.
- The head has a configurable fallback ladder and adaptive head selection is source-enabled but requires sufficient health evidence.
- The optional native tool seat defaults to the same free Ultra model family and is off unless `COUNCIL_TOOLS` enables it.

## Historical resilience signals

- The retired `inclusionai/ling-3.0-tiny:free` seat was removed after a source-documented 404/empty-endpoint result.
- The 31B Gemma free endpoint was source-documented as 11/11 429 in paced probes. The current code keeps it eligible but does not assign a fabricated median.
- Council seats record one request per seat; the general OpenRouter adapter still owns retry policy for paths that permit retries. Physical attempts are now captured in turn telemetry, including HTTP status and retry count.

These statements describe repository history and current source comments. They do not establish the current production 429 rate, provider diversity, p95, or contribution to final answers.

## Contribution questions for the fresh run

The minimum useful contribution table should be computed by model and phase:

| Field | Required observation |
|---|---|
| Availability | attempts, success, HTTP statuses, timeout/abort outcomes |
| Latency | seat duration, stream-open, first token, total body time |
| Usefulness | usable draft rate and safe-draft/degraded rate |
| Agreement | pairwise/cluster agreement and unresolved factual conflict rate |
| Cost | prompt/completion/total tokens and provider-reported cost when present |
| Final influence | whether the draft's claims survive into the final answer, scored by an independent evaluator |

Without those observations, assigning a model a quality or intelligence percentage would be decorative rather than evidence.


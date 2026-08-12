# Spend ceiling review — Sol

Reviewed `main`'s uncommitted implementation on 2026-08-12. Scope: `backend/lib/spend.js`, `backend/migrations/014_user_spend.sql`, the live `/api/council` wiring, telemetry producers, tool executors, and the other paid routes.

## Verdict

**NEEDS WORK.** The corrected reservation is an upper bound on the pure JS price model, and the same-day Postgres admission is atomic. It is not yet a dependable $5/day, $20/month owner-cost ceiling: a database failure disables it, the settlement snapshot omits paid work, and midnight can move a refund onto the wrong day's reservation.

## Findings, ranked

### 1. HIGH — reservation failure admits unbounded paid work

**Confidence:** 10/10. **Status:** source-verified; outage not induced.

`server.js:1623-1639` admits the request unmetered on every RPC, network, or schema failure. A rate limiter failing open loses one bounded window; this control failing open permits paid calls for the duration of the outage with no dollar bound. The attacker need not cause or detect the outage in advance: an already-running client simply continues through it.

The error path also sets `spendReserved = reserved` at `server.js:1773`. Its `finally` then calls settle even though no reservation was written. If today's row already exists, `settle_user_spend` can subtract `reserved - actual` from somebody's real prior balance. Conversely, a response lost after Postgres commits is indistinguishable from a reservation that failed.

**Small fix now:** fail closed before any provider call with 503, `Usage accounting is temporarily unavailable. Please try again shortly.`, and a short `Retry-After`. Do not set or settle `spendReserved` for a known-unmetered result. **Durable fix:** give each request a reservation UUID and make reserve/settle idempotent, so a lost response can be queried or safely retried.

### 2. HIGH — telemetry is not a complete spending record

**Confidence:** 10/10. **Status:** source-verified.

The claim at `spend.js:18-24` that telemetry knows model and tool calls exactly does not hold across a request:

- `callModel` returns only text (`server.js:117-125`), and `streamModel` ignores provider usage (`server.js:128-150`). Cost-driving tokens or Ollama GPU time/model class never reach pricing.
- Ordinary non-greetings make two router model calls (`server.js:1917-1938`), but a no-seat snapshot receives one `fastTenths` charge (`spend.js:128-131`).
- A search turn can make two multi-provider search fan-outs plus page reads (`server.js:785-928`, `server.js:1979-2012`); none of that becomes an agent-loop `toolRound`.
- Semantic recall, Gemini vision, and shadow-probe seats spend outside the priced buckets (`server.js:1042-1064`, `server.js:1799`, `server.js:1888-1909`).
- `rememberTurn` launches a summary call, fact extraction, and embeddings after the reply (`server.js:937-976`, `server.js:1131-1171`). Settlement at `server.js:2382-2385` runs before that work finishes.
- An abort at `server.js:2206` returns before copying `loop.toolRounds` at line 2207. Synthesis and fallback record only after their awaited streams succeed (`server.js:2276-2279`, `server.js:2320-2323`). Provider admission followed by abort/throw therefore prices as if it never happened.

Paid routes outside `/api/council` bypass the ledger entirely. `/api/overlay` can perform Gemini vision plus two model attempts (`server.js:2434-2487`); `/api/chat-title`, `/api/speech`, and `/api/feedback` also spend without reserving (`server.js:2626-2708`). Per-minute rate limits bound burst rate, not cumulative dollars.

**Smallest sound direction:** instrument paid-operation attempts in the provider wrappers, before each `await`, into a request-scoped record: model/model-class and returned usage, search/fetch provider, embedding, vision, and TTS bytes. Route every paid endpoint through one admission helper. Keep turn telemetry for latency; do not make a latency snapshot double as the billing event model. Background memory work must stay attached to the reservation until it finishes or remain included in the pessimistic charge.

### 3. MEDIUM — settlement targets the clock's current day, not the reserved day

**Confidence:** 10/10. **Status:** source-verified; UTC-boundary probe not run.

Reservation captures UTC day inside `reserve_user_spend` (`014_user_spend.sql:65-73`), while settlement independently recomputes UTC today (`014_user_spend.sql:118-130`). With no new-day row, the refund is lost: the user is overcharged and the owner remains protected. If another turn has reserved after midnight, the old turn's refund reduces that new day's live reservation. That understates the new daily balance and can admit excess spend; across a month boundary it also understates the new month.

**Small fix:** return `reserved_day` from reserve, retain it in `server.js`, and pass it to settle so the update targets `(user_id, reserved_day)`. A reservation UUID is better and also resolves finding 1's response ambiguity.

### 4. MEDIUM — settlement is not durable; failures consume user quota

**Confidence:** 9/10. **Status:** source-verified.

`server.js:1642-1647` fires settlement without awaiting or retrying it. A process death, deployment, network failure, or synchronous `supabase.rpc()` throw leaves the pessimistic reservation charged. This leak protects the owner but harms the user: repeated failures can lock them out before they consumed $5. `finally` helps only while the process survives long enough to deliver the RPC.

**Fix:** make settlement idempotent and durable. Await it on ordinary completed requests; enqueue failures for retry; alert on stale reservations and provide reconciliation. Do not blindly refund a crashed turn, because provider spend may already have occurred.

### 5. MEDIUM — the units and defaults materially distort the stated budget

**Confidence:** 9/10 on arithmetic; provider-account calibration not available.

The stated “3.3¢ turn, about 150 turns/day” is not what the ledger records. `priceTurn` rounds every turn to whole cents (`spend.js:133`), so seven seats plus synthesis settle at 4¢. Because admission reserves 23¢, a sequence of ordinary 4¢ turns stops at 480¢: the last 20¢ cannot admit even a cheap path. Cheap 0.1¢ paths settle at 1¢, a 10× distortion. Store tenths (or microdollars) in Postgres, set limits to 5,000/20,000 tenths, and round only for display.

The defaults are not demonstrably conservative for the providers in this code. Public retail rates include Brave and Google CSE at $5/1,000 requests, Tavily advanced at two $0.008 credits (1.6¢), and SerpApi Starter at $25/1,000: [Brave](https://brave.com/search/api/), [Google](https://developers.google.com/custom-search/v1/overview), [Tavily](https://docs.tavily.com/documentation/api-credits), [SerpApi](https://serpapi.com/pricing). One logical `web_search` can also try several providers, so the single 0.4¢ `searchTenths` is not an upper bound on owner cost.

Ollama's public pricing meters cloud usage using model size and GPU time rather than a flat per-call tariff, so the 0.4¢/seat and 0.5¢/synthesis defaults cannot be validated publicly: [Ollama pricing](https://www.ollama.com/pricing). Fish lists paid TTS at $15/M UTF-8 bytes, making this route's 3,000-byte maximum about 4.5¢ if the free model is not used: [Fish pricing](https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits). Settle the defaults from provider invoices/dashboard exports joined to model labels, durations, usage fields, TTS bytes, cache hits, and route/category; calibrate a conservative percentile rather than guessing.

### 6. LOW — a monthly refusal gives the wrong reset guidance

`server.js:1767-1771` says every refusal resets at midnight UTC. A monthly refusal does not. Return which limit bound, or say when both daily and monthly balances reset, so retries are not encouraged for the rest of the month.

## Upper-bound reasoning

The revised pure model passes this part of the review. `agent-loop.js:65-67` permits four rounds and 12 unique calls. A reachable maximum has 28 loop seats, seven `tool_plain_fallback` seats, the post-council fallback flag, and 12 tool calls (`server.js:2188-2287`). With defaults, `reservationCents(7, 12, 4)` and `priceTurn()` both return 23¢; the three-seat case returns 13¢ for both. `spend.js:186-209` deliberately reserves six roster equivalents plus two synthesis charges, which covers the actual sequence. This is conservative because post-council fallback is one streamed model call, not a roster, but conservatism is the correct direction for admission.

The property is coupled to duplicated literals: `server.js:1762` repeats `12, 4` from `agent-loop.js`. Export one immutable limits object and use it in both places, then retain the exact 35-seat/no-synthesis fixture. A future loop-limit change must not silently invalidate the ceiling.

## Seam outcomes

| Seam | Current direction | Consequence |
|---|---|---|
| Client abort during tools/synthesis/fallback | Owner undercharged | Paid attempts can be absent from settlement. |
| Throw before any paid operation | User overcharged | An empty snapshot still prices one fast call. |
| Settlement fails / process dies | User overcharged | Pessimistic reservation remains and consumes quota. |
| Midnight, no new row | User overcharged | Refund misses yesterday's row. |
| Midnight, new row | Owner undercharged / ceiling bypass | Yesterday's refund reduces today's reservation. |

## What is right

- The corrected reservation covers every snapshot the current loop can actually produce under the cost model.
- Reserve increments, checks, and reverses refusal under the daily-row lock. The supplied production probe demonstrates the crucial “refusal does not charge” invariant.
- One row per user/day with month as a sum avoids drifting counters; the primary key serves the query.
- User identity comes from authenticated server state, not request input.
- RLS is forced with no user policy and the functions are invoker functions; backend service-role access remains the intended boundary.
- Settling from `finally` is the correct lifecycle location. The missing pieces are complete operation records and durable delivery.

## Validation and limits

- Ran `node --test lib/spend.test.js lib/agent-loop.test.js lib/turn-telemetry.test.js`: 49/49 passed.
- Reproduced the reachable pure-model maximum locally: 23¢ reserved, 23¢ priced.
- I accepted the owner's production SQL probe as runtime evidence; I did not mutate production or rerun it.
- I could not verify Render's active tool/shadow configuration, provider keys or plans, invoices/dashboard costs, Ollama contract/extra-usage balance, signed-in HTTP behavior, outage behavior, process-kill recovery, or a real UTC-boundary turn. Public prices may differ from negotiated/free tiers.

This AI-assisted review is a focused engineering control review, not a substitute for a professional security or financial audit.

# Spend ceiling review — Sol

Reviewed `main`'s uncommitted implementation on 2026-08-12. Scope: `backend/lib/spend.js`, `backend/migrations/014_user_spend.sql`, the live `/api/council` wiring, telemetry producers, tool executors, and the other paid routes.

## Verdict

**NEEDS WORK. Do not describe this as a $5/day, $20/month per-user spend ceiling yet.** The same-day Postgres admission step is sound, but the maximum council path can still exceed its reservation, the settlement snapshot omits material paid work, and a database failure disables the control. Those are ceiling failures, not accounting polish.

## Findings, ranked

### 1. HIGH — a reachable turn still costs more than it reserves

**Confidence:** 10/10. **Status:** source-verified and reproduced with the pure model.

`spend.js:171-194` reserves four loop rosters, one fallback roster, synthesis, and 12 tools. The reachable maximum is four loop rosters (`agent-loop.js:154-220`), then the full plain-council fallback when the loop has no usable answer (`server.js:2219-2236`), then the streamed post-council fallback when that roster also has no usable answer (`server.js:2268-2287`). Telemetry contains 35 seat records before `fallbackCouncil.used` is added.

With defaults, `reservationCents(7, 12, 4)` is 20¢ while `priceTurn()` returns 23¢ for 35 seats, 12 tools, and the post fallback. Concurrent requests can therefore be admitted on 20¢ each and settle above the ceiling. The free roster has the same defect: 12¢ reserved, 13¢ priced.

`spend.test.js:134-160` now models 28 loop seats plus `fallbackCouncil`, but omits the seven `tool_plain_fallback` seats and combines synthesis with the mutually exclusive post-fallback path. It passes over the reachable maximum.

**Small fix:** price `fallbackCouncil` as the one streamed `PRIMARY_MODEL` call it actually is, not another roster plus synthesis (`server.js:2273-2278`). Reserve `maxRounds * seats + one plain-fallback roster + one streamed fallback + maxUniqueCalls`, and add the exact 35-seat/no-synthesis property case. Import shared loop limits instead of repeating `12, 4` at `server.js:1762`.

### 2. HIGH — telemetry is not a complete spending record

**Confidence:** 10/10. **Status:** source-verified.

The claim in `spend.js:18-24` that telemetry counts model and tool calls exactly is false across the request:

- `callModel` discards every provider field except text (`server.js:117-125`), and `streamModel` ignores final-frame usage (`server.js:128-150`).
- Two router model calls run on ordinary non-greetings (`server.js:1917-1938`), but `priceTurn` reduces every no-seat branch to one `fastTenths` charge (`spend.js:128-131`).
- A search turn can run two seven-way provider fan-outs plus page reads (`server.js:1979-2012`, `server.js:785-928`); none becomes a `toolRound`.
- Semantic recall, Gemini vision, and shadow-probe seats spend outside the priced buckets (`server.js:1042-1064`, `server.js:1799`, `server.js:1888-1909`).
- `rememberTurn` starts a summary model call, a fact-extraction call, and zero or more embeddings after the response (`server.js:937-976`, `server.js:1131-1171`). Settlement runs before that background work finishes.
- On abort, `server.js:2206-2207` returns before copying completed/aborted tool rounds. Synthesis and fallback are recorded only after their awaited stream succeeds (`server.js:2276-2279`, `server.js:2320-2323`), so an abort or throw after provider admission undercounts them.

This is exploitable without subtle timing: `/api/overlay` can make Gemini vision plus two model attempts and never touches the ledger (`server.js:2434-2487`). `/api/chat-title`, `/api/speech`, and `/api/feedback` are also outside it (`server.js:2626-2708`). The per-user rate limits bound calls per minute, not sustained dollars.

**Smallest sound direction:** meter attempts in the provider wrappers, before each `await`, into a request-scoped operation record: model/model-class, token or GPU-time usage when returned, search provider, fetch provider, embedding, vision, and TTS bytes. Make every paid route reserve through one admission helper. Keep the latency snapshot as latency telemetry; do not make it double as a billing event model. Background memory work must remain attached to the reservation and settle only after it finishes, or be included pessimistically and not refunded early.

### 3. HIGH — reservation failure must fail closed

**Confidence:** 9/10. **Status:** source-verified; outage not induced.

`server.js:1623-1639` admits unmetered on any RPC/network/schema failure. A rate limiter failing open loses one window; this control failing open permits paid calls for the whole outage with no dollar bound. The attacker need not cause the outage: a running script simply continues through it.

There is a second error-path problem: the unmetered result still leads to `spendReserved = reserved`, so settlement may subtract `reserved - actual` from an existing row even if no reservation was written. A response-lost-after-commit case is ambiguous in the opposite direction. This needs an idempotent reservation identity, not inference from an HTTP result.

**Small fix now:** return 503 before any provider call: `Usage accounting is temporarily unavailable. Please try again shortly.`, with a short `Retry-After`. Do not set or settle `spendReserved` for a known-unmetered admission. **Durable fix:** pass a request/reservation UUID into idempotent reserve and settle functions so retries and lost responses cannot double-charge or invent a refund.

### 4. MEDIUM — settlement targets the clock's current day, not the reserved day

**Confidence:** 10/10. **Status:** source-verified; production boundary probe not run.

Reservation captures UTC day inside `reserve_user_spend` (`014_user_spend.sql:65-73`), but settlement independently recomputes UTC today (`014_user_spend.sql:118-130`). If no new-day row exists, the refund is lost: the user is overcharged and the owner is protected. If another turn has reserved on the new day, the old turn's refund is applied to that active reservation. That understates the new day's balance and admits excess daily spend. Across a month boundary it also understates the new month's total.

**Small fix:** have reserve return `reserved_day`; retain it in `server.js`; pass it to settle and update exactly `(user_id, reserved_day)`. A reservation UUID is better and also solves finding 3's response ambiguity.

### 5. MEDIUM — settlement is not durable; failures spend user quota

**Confidence:** 9/10. **Status:** source-verified.

`server.js:1642-1647` fires settlement without awaiting or retrying it. A process death, deployment, network failure, or synchronous `supabase.rpc()` throw leaves the pessimistic reservation charged. This leak runs in the safe direction for the owner but the harmful direction for the user: enough failures lock a user out before they consumed $5. The `finally` helps only while this process remains alive long enough to deliver the RPC.

**Fix:** make settlement idempotent and durable: await it on ordinary completed requests; enqueue failed settlements for retry; retain pessimistic reservations on process death but expose/alert on stale ones and provide an admin reconciliation path. Do not auto-refund an unknown crashed turn: provider spend may already have happened.

## Seam outcomes

| Seam | Current direction | Why it matters |
|---|---|---|
| Client abort during tools/synthesis/fallback | Owner undercharged | Attempts occur before the recorder; tool rounds are dropped before copy. |
| Non-aborted throw before any provider | User overcharged | An empty snapshot still prices one fast call. |
| Settlement RPC fails / process dies | User overcharged | Reservation remains pessimistic and can exhaust quota. |
| Midnight with no new row | User overcharged | Refund misses yesterday's row. |
| Midnight with a new row | Owner undercharged / ceiling bypass | Yesterday's refund reduces today's active reservation. |

## The numbers

The comments' “3.3¢ turn, about 150 turns/day” is not what the ledger does. `priceTurn` rounds each turn up to whole cents (`spend.js:133`), so seven seats plus synthesis settle at 4¢ and $5 buys 125 ordinary turns. Cheap 0.1¢ branches settle at 1¢, a 10× markup. Keep integer arithmetic, but store tenths (or microdollars) in Postgres and set limits to 5,000/20,000 tenths; round only for display.

The defaults are not demonstrably conservative for the providers in this code. Current public retail rates include Brave at $5/1,000 requests, Google CSE at $5/1,000, Tavily **advanced** at 2 × $0.008 credits = 1.6¢ per request, and SerpApi Starter at $25/1,000. Those exceed the single 0.4¢ `searchTenths` in several cases: [Brave](https://brave.com/search/api/), [Google](https://developers.google.com/custom-search/v1/overview), [Tavily](https://docs.tavily.com/documentation/api-credits), [SerpApi](https://serpapi.com/pricing). A single logical `web_search` can also try multiple providers.

Ollama's public pricing meters cloud usage by model size and GPU time, not a flat per-call price, so 0.4¢/seat and 0.5¢/synthesis cannot be validated from a public token tariff: [Ollama pricing](https://www.ollama.com/pricing). Fish's paid TTS is $15/M UTF-8 bytes, making this route's 3,000-byte maximum about 4.5¢ when the free model is not selected: [Fish pricing](https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits). What would settle all defaults: a month of provider dashboard/invoice exports joined to operation counts, model labels, durations, returned usage fields, TTS bytes, cache hits, and route/category. Calibrate high-percentile cost per operation, not the average.

## What is right

- The same-day reserve operation increments, checks, and undoes refusal under the daily-row lock. The supplied production probe demonstrates the crucial “refusal does not charge” invariant.
- One row per user/day with month as a sum avoids two drifting counters; the primary key serves the query.
- User identity comes from authenticated server state, not request input.
- RLS is enabled with no user policy, and these are invoker functions; server service-role access remains the intended boundary.
- Settling from `finally` is the correct lifecycle location. The missing pieces are complete operation records and durable delivery.

## Validation and limits

- Ran `node --test lib/spend.test.js lib/agent-loop.test.js lib/turn-telemetry.test.js`; the focused suite passed, but the property fixture omits the reachable two-fallback sequence above.
- Reproduced the current pure-model counterexample locally: 20¢ reserved, 23¢ priced.
- I accepted the owner's production SQL probe as runtime evidence. I did not mutate production or rerun it.
- I could not verify Render's active `COUNCIL_TOOLS`/shadow mode, provider keys/plans, Ollama contract/extra-usage balance, dashboard costs, signed-in HTTP behavior, process-kill recovery, or a real UTC-boundary turn. Public prices above may differ from the account's negotiated/free tiers.

This AI-assisted review is a focused engineering control review, not a substitute for a professional security or financial audit.

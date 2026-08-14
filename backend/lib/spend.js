'use strict';

/**
 * A per-user spend ceiling: $5/day, $20/month, set by the owner 2026-08-12.
 *
 * WHY IT EXISTS. Sol's attack review found the rate limiters keyed on IP rather
 * than user, so one account rotating addresses collected a fresh allowance per
 * address. That half is fixed — the limiters key on `u:<userId>` now — but a
 * request rate is not a spend ceiling: a single account inside 30 turns/minute
 * can still run the bill up, and a council turn is seven paid model calls plus
 * search plus a possible fallback whip. This is the missing half.
 *
 * EVERYTHING HERE IS INTEGER CENTS. No floats anywhere near money: 0.1 + 0.2
 * is not 0.3 in binary floating point, and a ceiling that drifts is a ceiling
 * nobody can reason about. Costs are rounded UP at the point of pricing, so the
 * estimate errs toward protecting the owner.
 *
 * THE PRICES ARE ESTIMATES AND THEY ARE MEANT TO BE CALIBRATED.
 * OpenRouter reports `usage.prompt_tokens`, `usage.completion_tokens`, and
 * `usage.cost` on responses. The current `:free` model calls cost $0; search
 * and page-fetch calls still cost real money. This ceiling deliberately keeps
 * pricing model calls by operation so it remains protective if any seat is
 * swapped to a paid model, and every rate is overridable by environment
 * variable without a deploy.
 *
 * Read the numbers as "roughly right and deliberately conservative", not as a
 * bill. They should be compared against the provider dashboards and corrected;
 * `SPEND_*` exists so that correcting them is a variable change. Until someone
 * does that comparison, this is a SAFETY NET against runaway spend, not an
 * accounting system, and it must not be described as one.
 */

/** Cents, as integers. A float here would be a bug, not a rounding detail. */
const int = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
};

/**
 * Per-operation prices, in tenths of a cent so a single model call is not
 * forced up to a whole cent by integer arithmetic. Totals are converted to
 * cents, rounded up, at the end.
 */
const PRICES = {
  /* A council seat answering, or any other non-streaming model call at the
   * council's token ceiling. Seven of these is the bulk of a turn. */
  seatTenths: int(process.env.SPEND_SEAT_TENTHS, 4),
  /* The synthesis pass. Complex/tool turns now default to high-effort Luna, so
   * the conservative default is aligned with the native tool-seat estimate.
   * Override this when COUNCIL_SYNTHESIS_MODEL points at a cheaper model. */
  synthesisTenths: int(process.env.SPEND_SYNTHESIS_TENTHS, 8),
  /* THE NATIVE TOOL SEAT, WHICH IS THE FIRST SEAT ON THIS COUNCIL THAT COSTS
   * REAL MONEY. Everything else is a `:free` id billed at $0, which is why the
   * dollar ceiling has not bound on a model call since 2026-08-12. The header
   * above says the per-operation pricing exists so this ceiling "remains
   * protective the moment any seat is swapped to a paid model". This is that
   * moment; do not let it be the moment the sentence turned out to be untrue.
   *
   * MEASURED, and the distinction from "reasoned" matters here because the
   * first number written into this line was reasoned and was ~40x too high.
   *
   * RATES (read from OpenRouter's model catalogue, 2026-08-14):
   *   openai/gpt-5.6-luna — $0.10/M prompt, $0.60/M completion.
   *
   * MEASURED (a live four-round research turn through this exact seat, same
   * date, reasoning effort high): the four calls reported 209, 593, 1435 and
   * 1959 total tokens and cost $0.0000424, $0.0001228, $0.000220 and $0.000385
   * — $0.00077 for the WHOLE turn, about 0.077c, or under 0.2 tenths per call.
   *
   * REASONED, for the headroom the measurement does not cover: that turn's tool
   * results were short fixtures. A real one carries fetched pages, so call it
   * 30k prompt (0.3c = 3 tenths) plus 4k completion at high effort — reasoning
   * tokens bill as completion — (0.24c = 2.4 tenths), so ~5.4 tenths.
   *
   * The default is 8: comfortably above that reasoned worst case, and still
   * ~40x the measured typical. It is deliberately NOT the measured figure,
   * because a ceiling that under-estimates is not a ceiling and this is the one
   * seat that can run a bill up. It is also no longer 12, because an
   * over-estimate is not free either: `priceTurn` charges this per seat record
   * PER ROUND, so every unnecessary tenth is taken off a real user's daily
   * allowance for a turn that did not cost it. Calibrate against the provider
   * dashboard, in that order of preference: measurement, then reasoning, then
   * argument. */
  toolSeatTenths: int(process.env.SPEND_TOOL_SEAT_TENTHS, 8),
  /* FAST_MODEL: chat titles, feedback notes, the router's short calls. Small
   * prompts and a 100-token ceiling. */
  fastTenths: int(process.env.SPEND_FAST_TENTHS, 1),
  /* One search provider query. Brave, Tavily, Serper and Google CSE all sit in
   * the $2–5 per thousand range, which is 0.2–0.5 cents. */
  searchTenths: int(process.env.SPEND_SEARCH_TENTHS, 4),
  /* A page read — Firecrawl or r.jina.ai. */
  fetchTenths: int(process.env.SPEND_FETCH_TENTHS, 1),
};

/**
 * The ceilings. $5/day and $20/month, in cents.
 *
 * NOTE THAT THE MONTH IS NOT 30 DAYS' WORTH. 30 × $5 is $150, and the monthly
 * ceiling is $20 — so the month binds first for anyone using the product hard
 * for more than four days. That is the owner's intent, not an oversight: the
 * daily figure caps a bad day (a loop, a script, a mistake) and the monthly
 * figure caps a sustained one. Do not "fix" the inconsistency by raising the
 * month to match the day.
 */
const LIMITS = {
  dayCents: int(process.env.SPEND_DAY_CENTS, 500),
  monthCents: int(process.env.SPEND_MONTH_CENTS, 2000),
};

/**
 * What a turn cost, priced from the telemetry snapshot the turn already
 * produces. Accepts the snapshot shape from `turn-telemetry.js` and is
 * deliberately tolerant of missing fields — an aborted turn has fewer of them,
 * and a turn that ended early should be charged for what it actually did.
 *
 * @param {object} snapshot `telemetry.snapshot()` output, or any subset of it.
 * @returns {number} cents, rounded up, never negative.
 */
/**
 * Is this seat record the metered native tool seat?
 *
 * Compared by MODEL ID against what the caller says the tool seat is, rather
 * than by a flag on the record: `telemetry.recordSeat` stores a model string
 * and nothing else, and adding a boolean to it would put the same fact in two
 * places that can disagree. A caller that passes nothing prices every seat at
 * the free rate, which is the behaviour every existing call site expects.
 */
const isToolSeat = (seat, toolSeatModel) =>
  Boolean(toolSeatModel) && seat && seat.model === toolSeatModel;

function priceTurn(snapshot, { toolSeatModel = null } = {}) {
  /* `snapshot = {}` as a default parameter was WRONG and Luna's test caught it:
   * a default fires on `undefined` only, so `priceTurn(null)` went straight
   * through it and threw on `null.seats`. Reachable — the settlement path
   * prices whatever the turn produced, and a partial turn is exactly where a
   * null shows up. */
  const snap = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const seats = Array.isArray(snap.seats) ? snap.seats : [];
  const toolRounds = Array.isArray(snap.toolRounds) ? snap.toolRounds : [];

  /* Every seat that was ASKED, not every seat that answered. A seat that timed
   * out was still dispatched and the provider still ran it — charging only for
   * usable answers would make the expensive failure case free, which is exactly
   * backwards for a ceiling meant to catch runaway spend. */
  /* Priced PER SEAT RECORD rather than as `seats.length * rate`, because the
   * roster is no longer one price. One metered seat among six free ones is the
   * expected shape now, and multiplying a count by a single rate would charge
   * the whole council at whichever rate was picked — three times too much at
   * the tool-seat rate, or, far worse, nothing like enough at the free one. */
  let tenths = seats.reduce(
    (sum, seat) => sum + (isToolSeat(seat, toolSeatModel) ? PRICES.toolSeatTenths : PRICES.seatTenths),
    0,
  );

  if (snap.synthesisMs) tenths += PRICES.synthesisTenths;

  /* The post-truncation fallback council: a whole extra council run, which the
   * owner deliberately keeps. It is the single most expensive thing a turn can
   * do and it must be priced, or the ceiling is blind to the case most likely
   * to blow it.
   *
   * PRICED AT THE ROSTER SIZE, NOT `seats.length`. This read `seats.length` and
   * that is the accumulated total across every round — 28 for a four-round
   * seven-seat turn — so the fallback was charged as 28 extra seats when it is
   * one more run of the roster. It made `priceTurn` exceed any honest
   * reservation, which is the property the ceiling depends on.
   *
   * The roster is derived as the number of DISTINCT models asked, which is
   * exactly what a round is: the same seats, again. Falls back to 7 when there
   * are no seat records at all, since the fallback cannot have run without a
   * council to fall back from. */
  if (snap.fallbackCouncil?.used) {
    const models = new Set(seats.map((s) => s?.model));
    const roster = models.size || 7;
    /* The fallback re-runs the ROSTER, so it re-runs the tool seat too if the
     * tool seat was on it. Charging the whole fallback at the free rate was the
     * shape of the bug this codebase already fixed once here (`seats.length`
     * instead of the roster size); getting the RATE wrong is the same class of
     * mistake one column over. */
    const meteredSeats = toolSeatModel && models.has(toolSeatModel) ? 1 : 0;
    tenths += (roster - meteredSeats) * PRICES.seatTenths
      + meteredSeats * PRICES.toolSeatTenths
      + PRICES.synthesisTenths;
  }

  for (const round of toolRounds) {
    const calls = Number(round?.calls) || 0;
    tenths += calls * PRICES.searchTenths;
  }

  /* Non-council branches — memory, greeting, search, wiki — record no seats and
   * still spend one streamed model call each. Charge the fast rate rather than
   * nothing, so the cheap paths are not free forever. */
  if (!seats.length && !snap.synthesisMs) tenths += PRICES.fastTenths;

  return Math.max(0, Math.ceil(tenths / 10));
}

/**
 * What to reserve BEFORE a turn runs, when nobody yet knows what it will do.
 *
 * Admission control needs a number up front or the check is meaningless — a
 * ceiling enforced only after the money is spent is a report, not a ceiling. So
 * a turn reserves a pessimistic estimate and the difference is refunded when
 * the real figure is known.
 *
 * IT MUST BE AN UPPER BOUND ON `priceTurn()` FOR EVERY TURN THE LOOP CAN
 * PRODUCE. That is the load-bearing property of the whole design: if a real
 * turn can cost more than it reserved, the excess is only discovered at
 * settlement, by which point several concurrent turns have each been admitted
 * on an under-estimate and the ceiling has been walked past. Over-reserving
 * merely stops a user slightly early; under-reserving defeats the mechanism.
 *
 * IT WAS NOT AN UPPER BOUND, AND THE MISS WAS THE SEATS. Sol caught it in
 * review. `telemetry.recordSeat` pushes one record per member PER ROUND — the
 * record carries a `round` field for exactly that reason — so the tool loop's
 * four rounds against a seven-seat roster produce up to 28 seat records, and
 * `priceTurn` charges all 28. The reservation priced 14: one roster plus one
 * fallback roster. A four-round turn that also fell back cost about 145 tenths
 * against a 114-tenth reservation.
 *
 * Luna's coverage test passed over it because it modelled four rounds of TOOL
 * CALLS with a single round of seats, which is the intuitive reading of "a
 * seven-seat turn" and is not what the loop records. The test now builds the
 * seat list from `rounds × seats`; both halves of the bug were the same
 * assumption made twice.
 *
 * @param {number} seatCount   roster size for this turn.
 * @param {number} maxToolCalls `agent-loop.js` maxUniqueCalls — per turn across
 *        all rounds, not per round, which is why it is not multiplied below.
 * @param {number} maxRounds   `agent-loop.js` maxRounds. Every round re-asks
 *        every seat, so this multiplies the roster.
 */
/**
 * @param {number} [toolSeatCount] how many of `seatCount` are the metered
 *        native tool seat. Defaults to 0, which is what every turn without one
 *        is, and what every pre-existing caller means.
 *
 *        IT IS PART OF THE UPPER-BOUND PROPERTY, not a refinement of it. The
 *        reservation must bound `priceTurn` for every turn the loop can
 *        produce, and `priceTurn` now charges one seat at three times the free
 *        rate. A reservation that assumed a uniform roster would under-reserve
 *        by exactly the difference, on the one path that can actually spend
 *        money — which is the failure mode this whole function exists to
 *        prevent, arriving through the door that was just opened for it.
 */
function reservationCents(seatCount, maxToolCalls, maxRounds, toolSeatCount = 0) {
  /* COERCED, BECAUSE NaN CENTS WOULD SILENTLY DISABLE THE CEILING. Luna's test
   * passed 'not-a-number' and got NaN back, which is the worst possible return
   * value here: it travels into `reserve_user_spend` as the amount to charge,
   * and every comparison against a limit is false for NaN, so the ceiling would
   * admit everything while looking like it was working.
   *
   * Defaults applied through the same coercion rather than as default
   * parameters, for the reason `priceTurn` learned one function up: a default
   * parameter fires on `undefined` only, so `null` — or a string, or a negative
   * — would have walked straight past it. */
  const seats = int(seatCount, 7);
  const calls = int(maxToolCalls, 12);
  const rounds = Math.max(1, int(maxRounds, 4));

  /* THREE PATHS RUN A FULL ROSTER, and the worst case is all three in sequence.
   * Enumerated from the `reportCouncilTiming` call sites in server.js rather
   * than reasoned about, because the second one is easy to miss and both Sol
   * and I missed it on the first pass:
   *
   *   1. 'tools'               — the agent loop, re-asking every seat per round
   *   2. 'tool_plain_fallback' — a full plain council when the loop yields
   *                              nothing usable
   *   3. the post-truncation fallback, recorded by `recordFallback`
   *
   * A turn can hit all three: four loop rounds, then the plain fallback, then
   * the post-council fallback. That is `rounds + 2` rosters, and pricing only
   * `rounds + 1` left a reachable 7-seat path at 23c against a 20c reservation.
   * ('council' is the fourth call site and is the branch taken INSTEAD of the
   * loop, so it does not add to this worst case.) */
  const rosters = rounds + 2;

  /* Clamped to the roster: a caller that says "two tool seats" on a one-seat
   * roster must not be able to reserve for seats that cannot exist, and — the
   * direction that matters — must not produce a negative count of free seats
   * and therefore a SMALLER reservation than a plain turn. */
  const metered = Math.min(int(toolSeatCount, 0), seats);
  const free = Math.max(0, seats - metered);

  const tenths =
    rosters * (free * PRICES.seatTenths + metered * PRICES.toolSeatTenths) +
    /* Two synthesis passes: the turn's own, and the post-council fallback's. */
    2 * PRICES.synthesisTenths +
    /* maxUniqueCalls is per TURN across all rounds, so it is not multiplied. */
    calls * PRICES.searchTenths;
  return Math.max(0, Math.ceil(tenths / 10));
}

/* ==========================================================================
 * REQUESTS, WHICH IS THE CONSTRAINT THAT ACTUALLY BINDS NOW
 *
 * Everything above meters MONEY, and money stopped being the scarce thing on
 * 2026-08-12 when the council moved to OpenRouter's `:free` models. A `:free`
 * model call costs exactly $0 — `usage.cost` is 0 on every response — so the
 * $5/day ceiling can never bind on a model call. It is not dead code and must
 * not be deleted: search and page-fetch calls still cost real money, and the
 * per-operation pricing above is what keeps the ceiling protective the moment
 * any seat is swapped back to a paid model.
 *
 * What binds instead is OpenRouter's free-model REQUEST cap, and three of its
 * properties make it a different kind of limit from the one above:
 *
 *   IT IS COUNTED IN REQUESTS, NOT DOLLARS. 50 per UTC day on a zero-credit
 *   account, 1000 per day once $10 of credits has been bought — and the models
 *   stay $0 either way, so the purchase buys throughput and not tokens. Both
 *   numbers are measured, from a live 429 carrying `X-RateLimit-Limit: 50` and
 *   `limit_source: openrouter_free_tier_daily`.
 *
 *   IT IS ACCOUNT-WIDE, NOT PER USER. This is the sharpest difference and the
 *   easiest to get wrong: every ceiling above is a per-user allowance, so one
 *   user cannot spend another's. Here they share ONE pool. A single user can
 *   exhaust the day for everybody, which means the counter these functions feed
 *   must be global — do NOT key it on `u:<userId>` by analogy with the spend
 *   limiters, or the cap will be enforced at N times its real size.
 *
 *   FAILED REQUESTS STILL COUNT. A seat that timed out, returned empty, or was
 *   whipped was still dispatched, and OpenRouter charges the quota for it. So
 *   these functions count what was ASKED, exactly as `priceTurn` prices what was
 *   asked, and for the same reason: counting only successes would make the
 *   expensive failure case free and blind the cap to the runs most likely to
 *   blow it.
 *
 * THERE IS NO MONTHLY FIGURE. Deliberately — the provider's cap is purely daily
 * and resets at UTC midnight, so a monthly limit here would be an invention of
 * ours rather than a constraint of theirs. The dollar ceiling above has both
 * because that one is our policy; this one only mirrors what the provider does.
 *
 * SEARCH AND FETCH CALLS ARE NOT COUNTED. They go to Brave, Tavily, Serper,
 * Google CSE and r.jina.ai — not to OpenRouter — so they consume money from the
 * ceiling above and none of this quota. The two limits count disjoint sets of
 * operations, which is why both exist.
 * ========================================================================== */

/**
 * The FAST_MODEL calls a turn makes outside the council, used only as the
 * RESERVATION's assumption. The settlement counts the real ones.
 *
 * THE PREVIOUS VALUE WAS RIGHT BY ACCIDENT AND WRONG IN EVERY PART. It was 3,
 * documented as "the router's classification, the chat title, and the feedback
 * note", and all three were wrong:
 *
 *   The router's classification is `assessComplexity` in lib/router.js, which is
 *   PURE CODE. It has never cost a request.
 *   The chat title is a separate endpoint that fires once on a new chat's first
 *   message, not on every turn.
 *   The feedback note is a separate endpoint that fires only when a user rates
 *   an answer.
 *
 * What a turn actually spends outside the council is THREE: ONE router model
 * call — `planTurn`, which returns the memory decision and the search plan
 * together — and the two `rememberTurn` fires after answering,
 * `updateChatSummary` and `updateUserFacts`. The count was nearly right while
 * being composed of entirely the wrong things, which is the most durable kind
 * of wrong: a number that survives every review because it looks about right.
 *
 * IT WAS FOUR UNTIL 2026-08-13, when the two router calls became one. The
 * constant below is left at 4 ON PURPOSE: it is the RESERVATION's upper bound,
 * it is only ever refunded against what the turn really recorded, and lowering
 * a ceiling to exactly the expected value removes the margin that makes it a
 * ceiling. Lower it only with settlement data showing the reservation is the
 * thing binding.
 *
 * So the number is no longer asserted. The settlement reads what the turn
 * recorded — `routerReads` for the router calls, `fastCalls` for the
 * fire-and-forget pair — and this constant survives only as the upper bound the
 * RESERVATION assumes before any of that is known. Four, because four is what
 * the worst case actually dispatches.
 */
const FAST_OVERHEAD = int(process.env.SPEND_FAST_OVERHEAD, 4);

/**
 * The request ceiling, account-wide, per UTC day.
 *
 * THE DEFAULT ASSUMES CREDITS HAVE BEEN BOUGHT. 1000/day is the post-$10 figure;
 * a zero-credit account gets 50, which is about five council turns for the whole
 * product. If credits have not been added, set `SPEND_DAY_REQUESTS=50` — leaving
 * the default in place on a zero-credit account means this ceiling never fires
 * and OpenRouter's own 429 is the only thing enforcing the limit, which is the
 * situation this module exists to get ahead of.
 *
 * `warnRequests` is the soft mark for telling someone before the day dies, at
 * 80% of the default. It is not enforced here; it is a number for whoever
 * reports on the counter.
 */
const REQUEST_LIMITS = {
  dayRequests: int(process.env.SPEND_DAY_REQUESTS, 1000),
  warnRequests: int(process.env.SPEND_WARN_REQUESTS, 800),
};

/**
 * How many OpenRouter requests a turn actually made, from the same telemetry
 * snapshot `priceTurn` reads. Null-safe in the same way and for the same reason:
 * the settlement path counts whatever the turn produced, and a partial or
 * aborted turn is exactly where a `null` shows up.
 *
 * @param {object} snapshot `telemetry.snapshot()` output, or any subset of it.
 * @returns {number} whole requests, never negative.
 */
function countTurnRequests(snapshot) {
  const snap = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const seats = Array.isArray(snap.seats) ? snap.seats : [];

  /* One record per member PER ROUND, so a four-round seven-seat turn is 28 seat
   * records and 28 requests. That is not double counting — each round really did
   * re-ask every seat over the wire. `priceTurn` charges all 28 for the same
   * reason, and the reservation below has to bound the same number. */
  let requests = seats.length;

  if (snap.synthesisMs) requests += 1;

  /* The post-truncation fallback council: one more run of the ROSTER, plus its
   * own synthesis. Sized from the distinct models asked rather than from
   * `seats.length`, which is the accumulated across-rounds total — the same bug
   * priceTurn already had and had to be corrected for. */
  if (snap.fallbackCouncil?.used) {
    const roster = new Set(seats.map((s) => s?.model)).size || 7;
    requests += roster + 1;
  }

  /* THE NON-COUNCIL CALLS, COUNTED RATHER THAN ASSUMED. This used to add a flat
   * FAST_OVERHEAD to council turns and exactly 1 to everything else, and it was
   * wrong in both directions at once: the constant named three calls that were
   * not the ones being made, and the cheap branches were charged 1 when a memory
   * or search answer really spends 5 — two router calls, one streamed answer,
   * and the two `rememberTurn` fires. Off by four on the branches that were
   * supposed to be the cheap ones.
   *
   * Both numbers now come from the turn itself. `routerReads` is written by
   * `measureRouter` around each of the two router model calls, so a turn that
   * skipped them (a greeting, or an image turn) contributes nothing here rather
   * than being charged for calls it never made. `fastCalls` is written at
   * dispatch by `rememberTurn`, which is the only way those two can be seen at
   * all — they are fire-and-forget and leave no other trace. */
  requests += Object.keys(snap.routerReads || {}).length;
  requests += Math.max(0, Number(snap.fastCalls) || 0);

  /* The cheap branches stream one answer and record no seat and no synthesis for
   * it. The condition is the same one priceTurn uses to recognise them, so the
   * two functions cannot disagree about what kind of turn they were handed. */
  if (!seats.length && !snap.synthesisMs) requests += 1;

  return Math.max(0, requests);
}

/**
 * What to reserve BEFORE a turn runs, in requests.
 *
 * IT MUST BE AN UPPER BOUND ON `countTurnRequests()` FOR EVERY TURN THE LOOP CAN
 * PRODUCE — the identical load-bearing property `reservationCents` documents at
 * length above, and it fails the same way if broken: several concurrent turns
 * each admitted on an under-estimate walk the shared cap past its limit, and
 * because this pool is ACCOUNT-WIDE the damage is not confined to one user.
 *
 * The signature matches `reservationCents` so a caller can compute both from one
 * set of arguments without remembering which takes what.
 *
 * @param {number} seatCount    roster size for this turn.
 * @param {number} maxToolCalls ACCEPTED AND IGNORED. Search and page-fetch calls
 *        go to the search providers, not to OpenRouter, so they cannot consume
 *        this quota. It is in the signature only for symmetry with
 *        `reservationCents`, and it is coerced anyway so that a caller passing
 *        garbage gets the same treatment from both functions.
 * @param {number} maxRounds    `agent-loop.js` maxRounds. Every round re-asks
 *        every seat, so this multiplies the roster.
 * @returns {number} whole requests, never negative.
 */
function reservationRequests(seatCount, maxToolCalls, maxRounds) {
  /* Coerced for the reason reservationCents spells out: NaN here would travel
   * into the reservation as the amount to hold, and every comparison against a
   * limit is false for NaN — the cap would admit everything while appearing to
   * work. Defaults go through the coercion rather than through default
   * parameters, which fire on `undefined` only. */
  const seats = int(seatCount, 7);
  int(maxToolCalls, 12); // coerced for parity; search calls are not OpenRouter requests
  const rounds = Math.max(1, int(maxRounds, 4));

  /* The same three-full-roster worst case reservationCents enumerates, and it is
   * enumerated there rather than re-derived here so the two cannot drift: the
   * agent loop's rounds, then the plain-council fallback, then the
   * post-truncation fallback. `rounds + 2` rosters. */
  const rosters = rounds + 2;

  /* Two synthesis passes — the turn's own and the post-council fallback's — plus
   * the fast-call overhead, which a reserved turn must assume it will spend. */
  return Math.max(0, rosters * seats + 2 + FAST_OVERHEAD);
}

module.exports = {
  priceTurn,
  reservationCents,
  PRICES,
  LIMITS,
  countTurnRequests,
  reservationRequests,
  REQUEST_LIMITS,
  FAST_OVERHEAD,
};

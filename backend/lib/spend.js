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
 * THE PRICES ARE ESTIMATES AND THEY ARE MEANT TO BE CALIBRATED. Nothing in this
 * codebase meters tokens — the Ollama gateway's responses are consumed for
 * their text and the counts are discarded — so a real per-token bill cannot be
 * computed from what the app currently knows. What it DOES know, exactly, is
 * how many model calls and tool calls a turn made, because `turn-telemetry`
 * already counts them for the latency work. So a turn is priced by what it did,
 * at a per-operation rate, and every rate is overridable by environment
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
  /* The synthesis pass. Longer output than a seat, so priced above one. */
  synthesisTenths: int(process.env.SPEND_SYNTHESIS_TENTHS, 5),
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
function priceTurn(snapshot) {
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
  let tenths = seats.length * PRICES.seatTenths;

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
    const roster = new Set(seats.map((s) => s?.model)).size || 7;
    tenths += roster * PRICES.seatTenths + PRICES.synthesisTenths;
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
function reservationCents(seatCount, maxToolCalls, maxRounds) {
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
  const tenths =
    /* Every round re-asks every seat. This is the term that was missing. */
    rounds * seats * PRICES.seatTenths +
    PRICES.synthesisTenths +
    /* The post-truncation fallback: a whole second council run plus its own
     * synthesis, which the owner deliberately keeps after the ceiling blows. */
    seats * PRICES.seatTenths + PRICES.synthesisTenths +
    /* Per turn across all rounds, so NOT multiplied by `rounds`. */
    calls * PRICES.searchTenths;
  return Math.max(0, Math.ceil(tenths / 10));
}

module.exports = { priceTurn, reservationCents, PRICES, LIMITS };

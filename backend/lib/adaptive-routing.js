'use strict';

const { isRisky } = require('./progressive-council');

/**
 * Which models, how many, and what to optimise for — decided from the question
 * and from what the models have recently been doing, rather than from a
 * hand-ordered constant.
 *
 * WHAT EXISTS ALREADY AND IS NOT REPLACED. `lib/router.js` decides the
 * CATEGORY, the COMPLEXITY and the seat count, and it does that from the text
 * alone, cheaply, with no model call. That is good and stays. What it cannot do
 * is see that the seat it is about to pick has failed its last nine calls, or
 * that the question needs today's information and the cheapest seat is the one
 * with no tools. This module takes the router's decision and the health signal
 * and produces the ORDER and the EMPHASIS.
 *
 * THE EIGHT INPUTS THE ARCHITECTURE ASKS FOR, and what each one changes:
 *
 *   task type       generation wants headroom; lookup wants speed.
 *   complexity      the router's own tier; sets the seat budget.
 *   risk            a dangerous question never runs on one seat and never
 *                   optimises for cost.
 *   freshness       a question about today needs a seat that can use tools;
 *                   an evergreen one can be served from cache.
 *   personalisation a turn carrying the user's own facts cannot be cached and
 *                   should not be shared, which changes the cache decision
 *                   rather than the model one.
 *   latency         emphasis, via the health signal's p95.
 *   quality         emphasis, via whatever the caller has scored.
 *   cost            emphasis, and the only one with a hard rule attached: a
 *                   metered seat is never added to a turn that did not need it.
 *
 * IT NEVER DROPS THE LAST SEAT. Ranking reorders; refusing is `pacer.js`'s job,
 * through a breaker that knows how to close again. A router that removes a
 * model because it looks unhealthy is a router that empties the roster during a
 * provider-wide incident, which converts a degraded product into no product.
 */

/** A question that only makes sense against current information. */
const FRESH_RE = /\b(today|tonight|now|current|currently|latest|newest|this (week|month|year)|right now|202[6-9]|price|stock|score|weather|news|release[d]?|launch(ed)?|updated?)\b/i;
/** A question asking for something to be produced rather than looked up. */
const GENERATE_RE = /\b(write|draft|compose|generate|create|design|build|code|implement|refactor|translate|summari[sz]e|rewrite|outline|plan)\b/i;
/** A question with one answer, which does not need a panel. */
const LOOKUP_RE = /^(who|what|when|where|which|how (much|many|old|far|tall|long))\b/i;

/**
 * @param {object} input
 * @param {string} input.question
 * @param {string} input.complexity  'simple' | 'moderate' | 'complex'
 * @param {string} input.category
 * @param {boolean} [input.personalised]
 * @param {boolean} [input.searchPlanned]  the router asked for live research
 * @param {string[]} input.candidates      roster model ids, in roster order
 * @param {{rank: Function}} [input.health]
 * @param {number} [input.maxSeats]
 */
function planRoute({
  question = '',
  complexity = 'moderate',
  category = 'general',
  personalised = false,
  searchPlanned = false,
  candidates = [],
  health = null,
  maxSeats = candidates.length,
} = {}) {
  const risky = isRisky(question);
  const fresh = searchPlanned || FRESH_RE.test(question);
  const taskType = GENERATE_RE.test(question) ? 'generation'
    : LOOKUP_RE.test(question) ? 'lookup'
      : 'reasoning';

  /* EMPHASIS. One of four, because a weight vector with eight knobs is a knob
   * nobody will ever turn correctly.
   *
   * Risk beats everything: a dangerous question is not the place to save four
   * hundred milliseconds or a tenth of a cent. Then freshness, because a stale
   * answer to a "what is it today" question is wrong rather than slow. Then the
   * task: a lookup is judged on how fast it arrives, a generation on what it
   * says. */
  const emphasis = risky ? 'quality'
    : fresh ? 'quality'
      : taskType === 'lookup' ? 'latency'
        : taskType === 'generation' ? 'quality'
          : complexity === 'simple' ? 'latency' : 'balanced';

  /* SEAT BUDGET. The router's tier is the baseline; risk raises the floor and
   * nothing lowers it below one. Live research widens, for the reason
   * `escalateForResearch` already gives: reconciling independent readings is
   * worth the most exactly when the readings come from the open web. */
  const base = complexity === 'simple' ? 1 : complexity === 'complex' ? Math.min(5, maxSeats) : 3;
  const seats = Math.max(
    risky ? Math.min(3, maxSeats) : 1,
    Math.min(maxSeats, fresh ? base + 1 : base),
  );

  const ranked = health && typeof health.rank === 'function'
    ? health.rank(candidates, { emphasis }).map((r) => r.model)
    : [...candidates];

  /* CACHEABILITY IS A ROUTING DECISION TOO, and it is the one that most often
   * decides whether a turn costs anything at all. A personalised turn cannot be
   * shared; a fresh one can be shared only briefly. Returned here so the route
   * has ONE place that decides it rather than three. */
  const cacheable = !personalised && category !== 'memory';
  const cacheTtlHint = !cacheable ? 0 : fresh ? 'short' : 'long';

  return {
    emphasis,
    seats,
    order: ranked,
    taskType,
    risky,
    fresh,
    cacheable,
    cacheTtlHint,
    /* Never on a turn that did not ask for research or carry risk. The metered
     * seat is the only one on this council that costs money. */
    allowMeteredSeat: Boolean(searchPlanned || risky),
    /* A single-seat turn skips synthesis entirely — the route already has that
     * path (`council_solo`); this is what makes it reachable more often. */
    skipSynthesis: seats === 1 && !risky,
  };
}

/**
 * Apply a plan to the router's selection, IN ONE DIRECTION ONLY.
 *
 * It reorders, and it may narrow. It may never widen: `selection.members` is
 * what admission reserved money for, and a layer below the gate that adds a
 * seat is spending money nobody admitted — CLAUDE.md rule 8, the bug that has
 * already happened twice here.
 *
 * THE TOOL SEAT IS NEVER DROPPED BY NARROWING. It is the only member that can
 * fetch a page through a real function-calling interface, so removing it to
 * save a seat converts a research turn into a guess. It is also not ranked: the
 * health signal scores general seats against each other and this one does a
 * different job.
 *
 * @param {object} selection      from classifyRequest / escalateForResearch
 * @param {object} plan           from planRoute
 * @param {{toolSeatModel?: string|null}} [opts]
 */
function applyPlan(selection, plan, { toolSeatModel = null } = {}) {
  const members = Array.isArray(selection?.members) ? selection.members : [];
  if (!plan || members.length === 0) return selection;

  const rank = new Map((plan.order || []).map((model, i) => [model, i]));
  /* Unranked members keep their roster order and sit after the ranked ones,
   * rather than being sorted to the front by a missing index. */
  const ordered = [...members].sort((a, b) => {
    const ra = rank.has(a) ? rank.get(a) : Number.MAX_SAFE_INTEGER;
    const rb = rank.has(b) ? rank.get(b) : Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });

  const pinned = toolSeatModel && ordered.includes(toolSeatModel) ? [toolSeatModel] : [];
  const rest = ordered.filter((m) => !pinned.includes(m));
  const room = Math.max(0, Math.min(members.length, Math.max(1, plan.seats)) - pinned.length);
  const next = [...pinned, ...rest.slice(0, room)];

  if (next.length === members.length && next.every((m, i) => m === members[i])) return selection;

  return {
    ...selection,
    members: next,
    quorum: Math.max(1, Math.min(Number(selection?.quorum) || 1, next.length)),
    adaptive: { emphasis: plan.emphasis, taskType: plan.taskType, from: members.length, to: next.length },
  };
}

module.exports = { planRoute, applyPlan, FRESH_RE, GENERATE_RE, LOOKUP_RE };

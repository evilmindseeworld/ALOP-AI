'use strict';

const { effortFor, DEFAULT_HEAD_LADDER } = require('./model-ladder');

/**
 * WHICH MODEL WRITES THIS ANSWER, decided per turn from what the models have
 * actually been doing, rather than from one constant chosen once.
 *
 * WHAT WAS WRONG WITH THE CONSTANT. `COUNCIL_SYNTHESIS_MODEL` picks the head
 * for every turn this deployment will ever serve. The head is the longest
 * single step of a turn — the council's seats run concurrently, the synthesis
 * does not — so it is the step that decides whether the product feels fast, and
 * it was the one step no measurement could reach. `lib/provider-health.js`
 * already ranks models by measured p95, success rate and cost; it was wired to
 * the council SEATS and to a routing flag that is off by default, and never to
 * the head.
 *
 * The second half of the same gap: `streamModel` recorded nothing into the
 * health signal, so the head's own latency and failures were invisible to the
 * thing whose job is to notice them. A ranking with no samples for the model it
 * is ranking is a hand-ordered list with extra steps. Both halves are needed or
 * neither works.
 *
 * THE RULES, in the order they are applied:
 *
 *   1. NOTHING METERED ARRIVES BY RANKING. The candidate list is what the
 *      caller supplies, and the caller supplies free models unless a deployment
 *      has opted in — see lib/model-ladder.js. A selector that could promote a
 *      metered model on a latency score would turn "this one is faster" into a
 *      bill, which is precisely the failure the free-only default exists to
 *      prevent.
 *
 *   2. NO DATA CHANGES NOTHING. `health.rank` keeps an unmeasured model at its
 *      list position, and `confident` requires MIN_CONFIDENT_SAMPLES calls. So
 *      a fresh process, a new deployment and a model nobody has called yet all
 *      produce exactly the configured order. This is what makes the feature
 *      safe to have on by default: it cannot act until it has evidence, and
 *      until then it is the identity function.
 *
 *   3. THE CONFIGURED HEAD KEEPS ITS SEAT UNLESS IT IS MEASURABLY WORSE. A
 *      deployment that names a head model means it. Reordering requires the
 *      challenger to beat it by a MARGIN rather than by any amount, because a
 *      score built partly from a p95 wobbles, and a head that changes identity
 *      between two adjacent turns makes every latency and quality comparison
 *      afterwards meaningless.
 *
 *   4. THE CHAIN IS THE REST OF THE RANKING. The fallback ladder used to be a
 *      static list; it is now whatever the ranking put below the winner, which
 *      means a rung that has been failing sinks on its own rather than waiting
 *      for someone to edit an array. `fallbacksAfter` still supplies the
 *      candidates — this only orders them.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It never drops a candidate, for the reason
 * `provider-health.rank` gives at length: a health signal that removes the last
 * working model during a provider-wide incident converts a degraded turn into
 * no turn. Refusing is `pacer.js`'s job, through a breaker that knows how to
 * close again.
 */

/**
 * How much better a challenger must score to displace the configured head.
 *
 * REASONED, NOT MEASURED, and the number matters less than the fact that it is
 * not zero: `rank` scores on a blend that includes a p95 from a 64-sample
 * reservoir, and with a margin of zero two models within noise of each other
 * would trade places turn by turn. 0.05 on a 0..1 score is about the distance
 * between "measurably better" and "the same model on a good minute".
 */
const DISPLACE_MARGIN = 0.05;

/**
 * Pick the head and its fallback chain.
 *
 * @param {object} input
 * @param {string} input.configured        the deployment's head model.
 * @param {string[]} [input.candidates]    every model this turn may fall to,
 *        in ladder order, INCLUDING the configured head. Free unless the
 *        deployment opted in; this function never widens the list.
 * @param {{rank: Function, statsFor: Function}} [input.health]
 * @param {'latency'|'quality'|'balanced'|'cost'} [input.emphasis]
 *        from `chooseEmphasis` in lib/adaptive-routing.js — the one definition.
 * @param {Array<{model: string, effort: string|null}>} [input.ladder]
 *        where per-model reasoning effort is recorded.
 * @returns {{model: string, effort: string|null,
 *            chain: Array<{model: string, effort: string|null}>,
 *            reason: string, ranked: string[]}}
 *        `chain` is the fallbacks BELOW the head, already ordered.
 */
function chooseHead({
  configured,
  candidates = [],
  health = null,
  emphasis = 'balanced',
  ladder = DEFAULT_HEAD_LADDER,
} = {}) {
  const list = [...new Set([configured, ...(Array.isArray(candidates) ? candidates : [])].filter(Boolean))];
  const withEffort = (model) => ({ model, effort: effortFor(model, ladder) });

  /* No candidates beyond the configured head, or no health signal: the answer
   * is the configuration, unchanged. Stated as an early return rather than
   * falling through the ranking, so that "nothing to decide" cannot be
   * accidentally turned into a decision by a later edit. */
  if (list.length <= 1 || !health || typeof health.rank !== 'function') {
    const [head, ...rest] = list;
    return {
      model: head || configured,
      effort: effortFor(head || configured, ladder),
      chain: rest.map(withEffort),
      reason: 'configured',
      ranked: list,
    };
  }

  const ranked = health.rank(list, { emphasis });
  const order = ranked.map((r) => r.model);
  const best = ranked[0];
  const configuredEntry = ranked.find((r) => r.model === configured) || null;

  /* THE MARGIN IS CHECKED AGAINST THE CONFIGURED HEAD'S OWN SCORE, not against
   * its position. A challenger that sorts first by a hair has not earned the
   * seat; one that scores 0.05 higher has. `unmeasured` entries score by list
   * position alone, so an unmeasured challenger can never clear the margin
   * against a measured incumbent — which is rule 2 falling out of the maths
   * rather than being asserted separately. */
  const displaces = Boolean(
    best
    && configuredEntry
    && best.model !== configured
    && !best.unmeasured
    && best.score >= (configuredEntry.score ?? 0) + DISPLACE_MARGIN,
  );

  const head = displaces ? best.model : configured;
  const chain = order.filter((m) => m !== head).map(withEffort);

  return {
    model: head,
    effort: effortFor(head, ladder),
    chain,
    reason: displaces ? `health:${emphasis}` : 'configured',
    ranked: order,
  };
}

module.exports = { chooseHead, DISPLACE_MARGIN };

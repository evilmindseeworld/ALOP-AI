'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planRoute, applyPlan } = require('./adaptive-routing');

const candidates = ['a/one', 'b/two', 'c/three', 'd/four', 'e/five', 'f/six'];

/** A health signal that ranks by a fixed order, and records the emphasis it saw. */
const stubHealth = (order) => {
  const seen = [];
  return {
    seen,
    rank: (models, opts) => {
      seen.push(opts?.emphasis);
      return [...models].sort((x, y) => order.indexOf(x) - order.indexOf(y)).map((model) => ({ model }));
    },
  };
};

/* ---- task type ----------------------------------------------------------- */

test('task type is read off the question', () => {
  assert.equal(planRoute({ question: 'what is the capital of France', candidates }).taskType, 'lookup');
  assert.equal(planRoute({ question: 'write me a cover letter', candidates }).taskType, 'generation');
  assert.equal(planRoute({ question: 'should we migrate off this database', candidates }).taskType, 'reasoning');
});

/* ---- emphasis ------------------------------------------------------------ */

test('a lookup optimises for latency and a generation for quality', () => {
  assert.equal(planRoute({ question: 'who wrote Dune', candidates }).emphasis, 'latency');
  assert.equal(planRoute({ question: 'draft a launch announcement', candidates }).emphasis, 'quality');
});

test('risk beats speed — a dangerous question never optimises for latency', () => {
  const plan = planRoute({ question: 'what dose of ibuprofen for a child', complexity: 'simple', candidates });
  assert.equal(plan.risky, true);
  assert.equal(plan.emphasis, 'quality');
});

test('a question about today optimises for quality even when it is a lookup', () => {
  assert.equal(planRoute({ question: 'what is the latest release', candidates }).emphasis, 'quality');
});

test('a simple non-lookup reasoning question optimises for latency, a moderate one balances', () => {
  assert.equal(planRoute({ question: 'explain it briefly', complexity: 'simple', candidates }).emphasis, 'latency');
  assert.equal(planRoute({ question: 'explain it briefly', complexity: 'moderate', candidates }).emphasis, 'balanced');
});

/* ---- seat budget --------------------------------------------------------- */

test("the router's tier sets the baseline seat count", () => {
  assert.equal(planRoute({ question: 'who wrote Dune', complexity: 'simple', candidates }).seats, 1);
  assert.equal(planRoute({ question: 'compare these two', complexity: 'moderate', candidates }).seats, 3);
  assert.equal(planRoute({ question: 'compare these two', complexity: 'complex', candidates }).seats, 5);
});

test('live research widens the roster by one', () => {
  const still = planRoute({ question: 'compare these two approaches', complexity: 'moderate', candidates });
  const widened = planRoute({ question: 'compare these two approaches', complexity: 'moderate', searchPlanned: true, candidates });
  assert.equal(widened.seats, still.seats + 1);
});

/* RULE 8: a lower layer may not re-expand a budget set above it. maxSeats is
 * the admission reservation, and nothing here may spend past it. */
test('maxSeats is a hard ceiling on every path', () => {
  for (const input of [
    { complexity: 'complex' },
    { complexity: 'complex', searchPlanned: true },
    { question: 'what dose of ibuprofen for a child', complexity: 'complex', searchPlanned: true },
  ]) {
    const plan = planRoute({ question: 'anything', candidates, maxSeats: 2, ...input });
    assert.ok(plan.seats <= 2, `seats ${plan.seats} exceeded maxSeats`);
  }
});

test('a risky question never runs on one seat, whatever the tier said', () => {
  const plan = planRoute({ question: 'is it safe to mix bleach and ammonia', complexity: 'simple', candidates });
  assert.ok(plan.seats >= 3, `risky simple question got ${plan.seats} seats`);
  assert.equal(plan.skipSynthesis, false);
});

test('a one-seat turn skips synthesis, because synthesis of one answer is a paraphrase', () => {
  const plan = planRoute({ question: 'who wrote Dune', complexity: 'simple', candidates });
  assert.equal(plan.seats, 1);
  assert.equal(plan.skipSynthesis, true);
});

test('seats never fall below one even with an empty-looking budget', () => {
  assert.ok(planRoute({ question: 'x', complexity: 'simple', candidates, maxSeats: 1 }).seats >= 1);
});

/* ---- ranking, and the seat it must never drop ---------------------------- */

test('the health signal reorders the roster and is told what to optimise for', () => {
  const health = stubHealth(['c/three', 'a/one', 'b/two', 'd/four', 'e/five', 'f/six']);
  const plan = planRoute({ question: 'who wrote Dune', candidates, health });
  assert.equal(plan.order[0], 'c/three');
  assert.deepEqual(health.seen, ['latency']);
});

/* Ranking reorders; refusing is the pacer's job. A router that drops an
 * unhealthy model empties the roster during a provider-wide incident. */
test('ranking never removes a candidate', () => {
  const health = stubHealth([...candidates].reverse());
  const plan = planRoute({ question: 'anything', candidates, health });
  assert.deepEqual([...plan.order].sort(), [...candidates].sort());
});

test('with no health signal the roster order is preserved and not mutated', () => {
  const input = [...candidates];
  const plan = planRoute({ question: 'anything', candidates: input });
  assert.deepEqual(plan.order, candidates);
  plan.order.push('g/seven');
  assert.deepEqual(input, candidates, 'the caller\'s array must not be aliased');
});

test('a health object without a usable rank function is ignored rather than fatal', () => {
  assert.deepEqual(planRoute({ question: 'x', candidates, health: {} }).order, candidates);
});

/* ---- cacheability -------------------------------------------------------- */

test('a personalised turn is not cacheable', () => {
  const plan = planRoute({ question: 'what did I say about my thesis', personalised: true, candidates });
  assert.equal(plan.cacheable, false);
  assert.equal(plan.cacheTtlHint, 0);
});

test('a memory-category turn is not cacheable even when it is not marked personalised', () => {
  assert.equal(planRoute({ question: 'anything', category: 'memory', candidates }).cacheable, false);
});

test('a fresh answer gets a short shelf and an evergreen one a long shelf', () => {
  assert.equal(planRoute({ question: 'what is the price today', candidates }).cacheTtlHint, 'short');
  assert.equal(planRoute({ question: 'who wrote Dune', candidates }).cacheTtlHint, 'long');
});

/* ---- the metered seat: the only one that costs money ---------------------- */

test('the metered seat is refused on a turn that asked for neither research nor care', () => {
  assert.equal(planRoute({ question: 'who wrote Dune', candidates }).allowMeteredSeat, false);
});

test('the metered seat is allowed on research and on risk', () => {
  assert.equal(planRoute({ question: 'summarise the news', searchPlanned: true, candidates }).allowMeteredSeat, true);
  assert.equal(planRoute({ question: 'what dose is safe', candidates }).allowMeteredSeat, true);
});

/* A freshness WORD is not the same as the router deciding to search. Only the
 * router's actual decision buys the paid seat; otherwise every question with
 * "latest" in it spends money. */
test('a freshness word alone does not buy the metered seat', () => {
  const plan = planRoute({ question: 'what is the latest version of this library', candidates });
  assert.equal(plan.fresh, true);
  assert.equal(plan.allowMeteredSeat, false);
});

/* ---- defaults ------------------------------------------------------------ */

test('it produces a usable plan from nothing at all', () => {
  const plan = planRoute();
  assert.equal(plan.seats, 1);
  assert.deepEqual(plan.order, []);
  assert.equal(plan.cacheable, true);
});

/* ---- applyPlan: reorder and narrow, never widen -------------------------- */

const selectionOf = (members, extra = {}) => ({ members, quorum: 2, tokenLimit: 1000, complexity: 'moderate', ...extra });

test('the selection is reordered to the plan order', () => {
  const next = applyPlan(selectionOf(['a', 'b', 'c']), { order: ['c', 'a', 'b'], seats: 3 });
  assert.deepEqual(next.members, ['c', 'a', 'b']);
});

test('a member the plan did not rank keeps its place at the back, not the front', () => {
  const next = applyPlan(selectionOf(['a', 'b', 'unranked']), { order: ['b', 'a'], seats: 3 });
  assert.deepEqual(next.members, ['b', 'a', 'unranked']);
});

/* RULE 8. Admission reserved money for `members`; nothing below the gate may
 * add a seat to that. */
test('a plan asking for MORE seats than were admitted cannot widen the council', () => {
  const next = applyPlan(selectionOf(['a', 'b']), { order: ['a', 'b'], seats: 7 });
  assert.equal(next.members.length, 2);
});

test('a plan asking for fewer seats narrows, and quorum comes down with it', () => {
  const next = applyPlan(selectionOf(['a', 'b', 'c']), { order: ['c', 'b', 'a'], seats: 1 });
  assert.deepEqual(next.members, ['c']);
  assert.equal(next.quorum, 1, 'a quorum above the seat count can never be reached');
});

test('narrowing never empties the council', () => {
  const next = applyPlan(selectionOf(['a', 'b']), { order: ['a', 'b'], seats: 0 });
  assert.ok(next.members.length >= 1);
});

test('the tool seat survives narrowing to one seat, because nothing else can fetch a page', () => {
  const next = applyPlan(
    selectionOf(['a', 'b', 'tool/seat']),
    { order: ['a', 'b'], seats: 1 },
    { toolSeatModel: 'tool/seat' },
  );
  assert.deepEqual(next.members, ['tool/seat']);
});

test('the tool seat is not counted twice when the plan has room for others', () => {
  const next = applyPlan(
    selectionOf(['a', 'b', 'c', 'tool/seat']),
    { order: ['c', 'b', 'a'], seats: 3 },
    { toolSeatModel: 'tool/seat' },
  );
  assert.equal(next.members.length, 3);
  assert.equal(new Set(next.members).size, 3);
  assert.ok(next.members.includes('tool/seat'));
});

test('an unchanged plan returns the same selection object rather than a copy', () => {
  const selection = selectionOf(['a', 'b']);
  assert.equal(applyPlan(selection, { order: ['a', 'b'], seats: 2 }), selection);
});

test('everything else on the selection is carried through untouched', () => {
  const next = applyPlan(selectionOf(['a', 'b', 'c'], { whipMs: 30000 }), { order: ['c', 'b', 'a'], seats: 2, emphasis: 'latency', taskType: 'lookup' });
  assert.equal(next.whipMs, 30000);
  assert.equal(next.tokenLimit, 1000);
  assert.deepEqual(next.adaptive, { emphasis: 'latency', taskType: 'lookup', from: 3, to: 2 });
});

test('no plan, or an empty council, is left alone', () => {
  const selection = selectionOf(['a']);
  assert.equal(applyPlan(selection, null), selection);
  const empty = selectionOf([]);
  assert.equal(applyPlan(empty, { order: [], seats: 1 }), empty);
});

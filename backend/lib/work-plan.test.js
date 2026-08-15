'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { planWork, describeSkips } = require('./work-plan');

const base = {
  hasImage: false,
  hasConversationHistory: true,
  cacheEligible: true,
  semanticCacheEnabled: true,
  userHasFacts: true,
  category: 'general',
  wikiCandidate: false,
};

test('a normal mid-conversation turn does all of the optional work', () => {
  const plan = planWork(base);
  assert.equal(plan.summary, true);
  assert.equal(plan.feedback, true);
  assert.equal(plan.facts, true);
  assert.equal(plan.factEmbedding, true);
  assert.equal(plan.semanticEmbedding, true);
  /* `wiki` is skipped because the fixture's question has no encyclopaedic
   * subject, not because anything was gated off — every OTHER piece runs. */
  assert.deepEqual(Object.keys(plan.reasons), ['wiki']);
});

/* THE MEASURED WASTE. On the first message of every conversation the route read
 * the feedback guidance and the user's facts from Supabase and embedded the
 * question for a fact search — and then declined to inject any of it, because
 * `profileContextAllowed = hasConversationHistory`. Two round trips and an
 * embedding call, on every conversation's first turn, for results already
 * decided against. */
test('the first message in a conversation skips profile context and its embedding', () => {
  const plan = planWork({ ...base, hasConversationHistory: false });
  assert.equal(plan.feedback, false);
  assert.equal(plan.facts, false);
  assert.equal(plan.factEmbedding, false);
  assert.equal(plan.summary, true, 'the summary is what tells us whether history exists');
  assert.match(plan.reasons.facts, /first message/);
  assert.match(describeSkips(plan), /facts\(first message/);
});

test('a user with no stored facts is not searched for facts', () => {
  const plan = planWork({ ...base, userHasFacts: false });
  assert.equal(plan.facts, false);
  assert.equal(plan.factEmbedding, false);
  assert.match(plan.reasons.facts, /no stored facts/);
});

test('an uncacheable turn does not embed for a cache it cannot write to', () => {
  const plan = planWork({ ...base, cacheEligible: false });
  assert.equal(plan.semanticEmbedding, false);
  assert.match(plan.reasons.semanticEmbedding, /no cache key/);
});

test('the semantic embedding is skipped outright when the feature is off', () => {
  const plan = planWork({ ...base, semanticCacheEnabled: false });
  assert.equal(plan.semanticEmbedding, false);
  assert.match(plan.reasons.semanticEmbedding, /disabled/);
});

test('a greeting needs none of it', () => {
  const plan = planWork({ ...base, category: 'greeting', wikiCandidate: true });
  assert.deepEqual(
    [plan.summary, plan.feedback, plan.facts, plan.factEmbedding, plan.wiki],
    [false, false, false, false, false],
  );
});

test('vision follows the attachment and nothing else', () => {
  assert.equal(planWork(base).vision, false);
  assert.equal(planWork({ ...base, hasImage: true }).vision, true);
});

/* A question typed under a screenshot is a question about the screenshot. The
 * route already applies this rule to the arithmetic and greeting fast paths;
 * the Wikipedia hop had no equivalent. */
test('an attachment turns off the Wikipedia hop', () => {
  assert.equal(planWork({ ...base, wikiCandidate: true }).wiki, true);
  const plan = planWork({ ...base, wikiCandidate: true, hasImage: true });
  assert.equal(plan.wiki, false);
  assert.match(plan.reasons.wiki, /about the attachment/);
});

test('every skip states a reason, so a fast turn can be explained', () => {
  const plan = planWork({
    hasImage: false, hasConversationHistory: false, cacheEligible: false,
    semanticCacheEnabled: true, userHasFacts: false, category: 'general', wikiCandidate: false,
  });
  /* `vision` is not a skip, it is an absence: there is no attachment, so there
   * is nothing to explain. Everything that was DECIDED against records why. */
  for (const [key, value] of Object.entries(plan)) {
    if (key === 'reasons' || key === 'vision' || value !== false) continue;
    assert.ok(plan.reasons[key], `${key} was skipped with no reason recorded`);
  }
  assert.equal(describeSkips(plan).length > 0, true);
});

test('the council route consults the plan before doing the work, not after', () => {
  const source = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /require\('\.\/lib\/work-plan'\)/);
  const route = source.slice(source.indexOf('async function handleCouncilTurn'), source.indexOf('// ===== OVERLAY'));
  const plan = route.indexOf('planWork({');
  const reads = route.indexOf('const dag = await runDag([');
  assert.ok(plan > 0 && plan < reads, 'the plan must be decided before the fan-out it gates');
  assert.match(route, /workPlan\.semanticEmbedding/, 'the embedding for an uncacheable turn must be gated');
  /* facts and feedback are gated by the DAG's `when`, against the summary the
   * plan could not see yet — a stronger check than the plan's own guess. */
  assert.match(route, /when: \(\{ results \}\) => hasHistory\(results, clientHistory\)/);
});

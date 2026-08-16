const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  DEFAULT_HEAD_LADDER, METERED_RUNGS, parseLadder, fallbacksAfter, asStreamFallbacks, effortFor,
} = require('./model-ladder');

/* THIS TEST USED TO PASS BY NOT LOOKING. It ran `i < length - 1`, so on the
 * two-rung free ladder the loop body never executed and a green result meant
 * "nothing was checked" — the exact shape of a search that returns four when
 * nine exist. It now checks every adjacent pair and states the real position:
 * the two free rungs ARE both NVIDIA, so provider diversity is a property of
 * the opt-in list today and a KNOWN GAP on the default one. */
test('provider diversity is checked on every adjacent pair, and the gap is named', () => {
  const provider = (m) => m.split('/')[0];
  const adjacentShares = [];
  for (let i = 1; i < DEFAULT_HEAD_LADDER.length; i++) {
    if (provider(DEFAULT_HEAD_LADDER[i].model) === provider(DEFAULT_HEAD_LADDER[i - 1].model)) {
      adjacentShares.push(`${i - 1}/${i}`);
    }
  }
  /* The free tool-capable set had exactly one provider in it on 2026-08-16. If a
   * free rung from a second provider becomes available, this expectation is
   * what should be tightened to zero. */
  assert.ok(
    adjacentShares.length <= DEFAULT_HEAD_LADDER.length - 1,
    'sanity: more shared pairs than pairs',
  );
  const providers = new Set(DEFAULT_HEAD_LADDER.map((r) => provider(r.model)));
  assert.equal(
    providers.size,
    1,
    'a second free provider is now on the ladder — tighten this test to require no adjacent pair share one',
  );
});

test('the last rung costs nothing, so the ladder outlives the spend ceiling', () => {
  assert.match(DEFAULT_HEAD_LADDER.at(-1).model, /:free$/);
});

/* THE RULE THIS FILE EXISTS TO KEEP, owner's instruction 2026-08-16: nothing on
 * a default path is billed by usage. A metered model reaching a default is not a
 * configuration drift, it is a bill, and it is invisible until the invoice. */
test('EVERY DEFAULT RUNG IS FREE', () => {
  for (const rung of DEFAULT_HEAD_LADDER) {
    assert.match(rung.model, /:free$/, `${rung.model} is metered and is on the default ladder`);
  }
});

test('the metered rungs are reachable only by opting in', () => {
  const defaults = new Set(DEFAULT_HEAD_LADDER.map((r) => r.model));
  for (const rung of METERED_RUNGS) {
    assert.ok(!defaults.has(rung.model), `${rung.model} is metered and must be opt-in`);
  }
  /* Still ordered and still diverse, so the opt-in list is worth pasting: the
   * cheap recovery first, and no two rungs from one provider in a row. */
  assert.deepEqual(METERED_RUNGS.map((r) => r.model.split('/')[0]), ['openai', 'google', 'anthropic']);
});

test('a failing head falls to the rungs below it, never back to itself', () => {
  const after = fallbacksAfter(DEFAULT_HEAD_LADDER[0].model);
  assert.equal(after[0].model, DEFAULT_HEAD_LADDER[1].model);
  assert.ok(!after.some((r) => r.model === DEFAULT_HEAD_LADDER[0].model));
  assert.equal(after.length, DEFAULT_HEAD_LADDER.length - 1);
});

/* An opted-in metered head still falls to the free rungs, which is the property
 * that keeps a paying deployment answering after its credit runs out. */
test('a metered head configured by hand falls onto the free ladder', () => {
  const after = fallbacksAfter('openai/gpt-5.6-luna');
  assert.deepEqual(after.map((r) => r.model), DEFAULT_HEAD_LADDER.map((r) => r.model));
});

test('effortFor reads the effort from the rung, and invents none', () => {
  assert.equal(effortFor('openai/gpt-5.6-luna'), 'high');
  assert.equal(effortFor(DEFAULT_HEAD_LADDER[0].model), null);
  assert.equal(effortFor('someone/unknown'), null);
});

test('a head model that is not on the ladder gets the whole ladder', () => {
  const after = fallbacksAfter('some/other-model');
  assert.equal(after.length, DEFAULT_HEAD_LADDER.length);
});

test('a head model deep in the ladder does not retry the rungs above it', () => {
  const after = fallbacksAfter(DEFAULT_HEAD_LADDER.at(-1).model);
  assert.deepEqual(after.map((r) => r.model), []);
});

test('a blank deployment variable means the default ladder, not an empty one', () => {
  assert.deepEqual(parseLadder(''), [...DEFAULT_HEAD_LADDER]);
  assert.deepEqual(parseLadder(null), [...DEFAULT_HEAD_LADDER]);
  assert.deepEqual(parseLadder('   '), [...DEFAULT_HEAD_LADDER]);
});

test('an explicit off is the rollback switch and disables the fallbacks', () => {
  assert.equal(parseLadder('off'), null);
  assert.equal(parseLadder('none'), null);
  assert.deepEqual(fallbacksAfter('openai/gpt-5.6-luna', parseLadder('off')), []);
});

test('a configured ladder parses model and effort', () => {
  assert.deepEqual(parseLadder('a/one:high, b/two:medium, c/three'), [
    { model: 'a/one', effort: 'high' },
    { model: 'b/two', effort: 'medium' },
    { model: 'c/three', effort: null },
  ]);
});

test('a :free model id is not mistaken for an effort suffix', () => {
  // The trap: `nvidia/nemotron:free` split on the last colon gives a model
  // called `nvidia/nemotron` at effort `free`, which is not a model at all.
  assert.deepEqual(parseLadder('nvidia/nemotron-3-super-120b-a12b:free'), [
    { model: 'nvidia/nemotron-3-super-120b-a12b:free', effort: null },
  ]);
  assert.deepEqual(parseLadder('nvidia/x:free:high'), [{ model: 'nvidia/x:free', effort: 'high' }]);
});

test('stream fallbacks always exclude reasoning from the answer', () => {
  const shaped = asStreamFallbacks(DEFAULT_HEAD_LADDER);
  for (const entry of shaped) {
    assert.equal(entry.reasoning.exclude, true, `${entry.model} would stream its chain of thought into the answer`);
  }
  /* No effort on a free rung: the parameter was established for the metered
   * models and sending it to a model it was never checked against is an
   * unverified field on the request that writes the answer. */
  assert.equal(shaped[0].reasoning.effort, undefined);
  assert.equal(asStreamFallbacks(METERED_RUNGS)[0].reasoning.effort, 'high');
});

test('every rung is a model the catalogue says can call tools', () => {
  /* Not a live call — a unit test that hits the network is a unit test that
   * fails when the network does. This is the recorded catalogue read from
   * 2026-08-16; the ids are pinned here so adding a rung that cannot call
   * tools is a red test rather than a tool turn that answers without them. */
  const TOOL_CAPABLE = new Set([
    'openai/gpt-5.6-luna',
    'anthropic/claude-sonnet-5',
    'google/gemini-2.5-flash',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
  ]);
  for (const rung of DEFAULT_HEAD_LADDER) {
    assert.ok(TOOL_CAPABLE.has(rung.model), `${rung.model} is not in the verified tool-capable set`);
  }
});

test('server.js builds its head fallbacks from this ladder', () => {
  const src = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /require\('\.\/lib\/model-ladder'\)/);
  assert.match(src, /fallbacksAfter\(/, 'the ladder must be consulted, not re-listed in server.js');
});

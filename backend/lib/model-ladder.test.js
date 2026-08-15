const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { DEFAULT_HEAD_LADDER, parseLadder, fallbacksAfter, asStreamFallbacks } = require('./model-ladder');

test('the ladder does not stack two rungs from one provider in a row', () => {
  // Two rungs from one provider are one rung on the day that provider is down,
  // which is the failure the ladder exists for.
  const provider = (m) => m.split('/')[0];
  for (let i = 1; i < DEFAULT_HEAD_LADDER.length - 1; i++) {
    assert.notEqual(
      provider(DEFAULT_HEAD_LADDER[i].model),
      provider(DEFAULT_HEAD_LADDER[i - 1].model),
      `rungs ${i - 1} and ${i} share a provider`,
    );
  }
});

test('the last rung costs nothing, so the ladder outlives the spend ceiling', () => {
  assert.match(DEFAULT_HEAD_LADDER.at(-1).model, /:free$/);
});

test('there is more than one paid rung and more than one provider overall', () => {
  const providers = new Set(DEFAULT_HEAD_LADDER.map((r) => r.model.split('/')[0]));
  assert.ok(providers.size >= 3, `only ${providers.size} providers on the ladder`);
  assert.ok(DEFAULT_HEAD_LADDER.length >= 4, 'a two-rung ladder is the single point of failure with an extra step');
});

test('a failing head falls to the rungs below it, never back to itself', () => {
  const after = fallbacksAfter('openai/gpt-5.6-luna');
  assert.equal(after[0].model, 'anthropic/claude-sonnet-5');
  assert.ok(!after.some((r) => r.model === 'openai/gpt-5.6-luna'));
  assert.equal(after.length, DEFAULT_HEAD_LADDER.length - 1);
});

test('a head model that is not on the ladder gets the whole ladder', () => {
  const after = fallbacksAfter('some/other-model');
  assert.equal(after.length, DEFAULT_HEAD_LADDER.length);
});

test('a head model deep in the ladder does not retry the rungs above it', () => {
  const after = fallbacksAfter('google/gemini-2.5-flash');
  assert.deepEqual(after.map((r) => r.model), DEFAULT_HEAD_LADDER.slice(3).map((r) => r.model));
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
  assert.equal(shaped[0].reasoning.effort, 'high');
  assert.equal(shaped.at(-1).reasoning.effort, undefined);
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

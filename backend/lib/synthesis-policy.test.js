'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_SYNTHESIS_MODEL,
  configuredSynthesisModel,
  chooseSynthesis,
} = require('./synthesis-policy');

const PRIMARY = 'google/gemma-4-26b-a4b-it:free';
const LUNA = 'openai/gpt-5.6-luna';

test('the synthesis model defaults to high-effort Luna', () => {
  assert.equal(configuredSynthesisModel(undefined), DEFAULT_SYNTHESIS_MODEL);
  assert.equal(configuredSynthesisModel(''), DEFAULT_SYNTHESIS_MODEL);
});

test('simple turns stay on the fast primary model', () => {
  assert.deepEqual(
    chooseSynthesis({ complexity: 'simple', primaryModel: PRIMARY, configuredModel: LUNA }),
    { model: PRIMARY, highEffort: false, reason: 'simple' },
  );
});

test('complex and moderate turns use the configured head model', () => {
  for (const complexity of ['moderate', 'complex']) {
    const out = chooseSynthesis({ complexity, primaryModel: PRIMARY, configuredModel: LUNA });
    assert.equal(out.model, LUNA, complexity);
    assert.equal(out.highEffort, true, complexity);
  }
});

test('a tool-backed simple lookup still uses the head model', () => {
  const out = chooseSynthesis({
    complexity: 'simple',
    toolQuestion: true,
    primaryModel: PRIMARY,
    configuredModel: LUNA,
  });
  assert.equal(out.model, LUNA);
  assert.equal(out.highEffort, true);
  assert.equal(out.reason, 'tools');
});

test('explicitly disabling the flag rolls complex turns back to the primary', () => {
  assert.equal(configuredSynthesisModel('off'), null);
  const out = chooseSynthesis({ complexity: 'complex', primaryModel: PRIMARY, configuredModel: null });
  assert.equal(out.model, PRIMARY);
  assert.equal(out.highEffort, false);
});

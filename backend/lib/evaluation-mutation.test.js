'use strict';

/*
 * MUTATION COVERAGE FOR THE OFFLINE EVALUATOR.
 *
 * Each mutant is compiled from source text, but every assertion exercises a
 * public evaluator export. A fixture passing once is not enough: each
 * dangerous relaxation from the P1 review must turn a required example red.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SOURCE = readFileSync(join(__dirname, 'evaluation.js'), 'utf8')
  .replace(/\r\n/g, '\n');
const current = require('./evaluation');

const loadMutant = (source) => {
  const module = { exports: {} };
  const localRequire = (request) => require(join(__dirname, request));
  new Function('require', 'module', 'exports', source)(localRequire, module, module.exports);
  return module.exports;
};

const mutateLine = (needle, replacement) => {
  const lines = SOURCE.split('\n');
  const index = lines.findIndex((line) => line.includes(needle));
  assert.notEqual(index, -1, 'mutation anchor vanished from evaluation.js: ' + needle);
  lines[index] = replacement;
  return loadMutant(lines.join('\n'));
};

const POEM = 'Endpoints whisper soft\nLogs scream in silent rows\nRetries spin, nothing works\nCoffee fuels the fix';

/* ---- completeness mutants -------------------------------------------- */

test('M1: treating every terminal auxiliary as incomplete is caught', () => {
  const complete = ['Yes, I can', 'If necessary, I would', 'The request may'];
  for (const answer of complete) assert.equal(current.isLikelyComplete(answer), true, answer);
  const mutant = mutateLine(
    "if (metadata.status === 'incomplete') return false;",
    "  if (metadata.status === 'incomplete' || /(?:can|could|may|might|must|shall|should|will|would|is|are|was|were|has|have|had|do|does|did|be|been|being)$/.test(answer.trim())) return false;",
  );
  for (const answer of complete) {
    assert.equal(mutant.isLikelyComplete(answer), false,
      'terminal auxiliary must remain eligible: ' + answer);
  }
});

test('M2: treating every terminal preposition as incomplete is caught', () => {
  const answer = 'This is the person I spoke to';
  assert.equal(current.isLikelyComplete(answer), true);
  const mutant = mutateLine(
    "if (metadata.status === 'incomplete') return false;",
    "  if (metadata.status === 'incomplete' || /(?:to|on|of|from|with|for|about|in|at)$/.test(answer.trim())) return false;",
  );
  assert.equal(mutant.isLikelyComplete(answer), false,
    'preposition stranding is grammatical');
});

test('M3: restoring a blanket <=3 tail rejection is caught by poetry', () => {
  assert.equal(current.isLikelyComplete(POEM), true);
  const mutant = mutateLine(
    'return !hasStrongTextTruncation(answer);',
    '  if (answer.length >= 80 && /[A-Za-z]{1,3}$/.test(answer.trim())) return false;\n  return !hasStrongTextTruncation(answer);',
  );
  assert.equal(mutant.isLikelyComplete(POEM), false,
    'a short content-word tail must not be rejected');
});

test('M4: marking every punctuation-free answer complete is caught', () => {
  const answer = 'The result depends on';
  assert.equal(current.isLikelyComplete(answer), false);
  const mutant = mutateLine('return !hasStrongTextTruncation(answer);', '  return true;');
  assert.equal(mutant.isLikelyComplete(answer), true,
    'strong continuation evidence must remain active');
});

test('M5: a bare if prefix must remain ordinary prose', () => {
  const answer = 'if the service fails because';
  assert.equal(current.isLikelyComplete(answer), false);
  const mutant = mutateLine(
    'if (/^(?:if|for|while)',
    '  if (/^(?:if|for|while)\\s*\\(/i.test(trimmed) || /^if\\b/i.test(trimmed)) return true;',
  );
  assert.equal(mutant.isLikelyComplete(answer), true,
    'bare English if must not buy a code exemption');
});

test('M6: a bare for prefix must remain ordinary prose', () => {
  const answer = 'for every model configure the service to';
  assert.equal(current.isLikelyComplete(answer), false);
  const mutant = mutateLine(
    'if (/^(?:if|for|while)',
    '  if (/^(?:if|for|while)\\s*\\(/i.test(trimmed) || /^for\\b/i.test(trimmed)) return true;',
  );
  assert.equal(mutant.isLikelyComplete(answer), true,
    'bare English for must not buy a code exemption');
});

test('M7: a stray bracket must not create a structured exemption', () => {
  const answer = 'The array [1, 2, 3] should be transformed to';
  assert.equal(current.isLikelyComplete(answer), false);
  const mutant = mutateLine(
    'if (!trimmed) return false;',
    '  if (/[\\[\\]{}<>]/.test(trimmed)) return true;\n  if (!trimmed) return false;',
  );
  assert.equal(mutant.isLikelyComplete(answer), true,
    'symbol presence alone must not bypass prose truncation');
});

test('M8: removing structural truncation detection is caught', () => {
  const answer = 'const x = a +';
  assert.equal(current.isLikelyComplete(answer), false);
  const mutant = mutateLine(
    'if (hasStrongStructuralTruncation(answer)) return false;',
    '  if (false && hasStrongStructuralTruncation(answer)) return false;',
  );
  assert.equal(mutant.isLikelyComplete(answer), true,
    'dangling code operators are structural evidence');
});

/* ---- polarity, relation, and role-boundary mutants ------------------- */

test('M9: bare not must negate a redundancy claim', () => {
  const answer = 'Extra models are not redundant at all; every one adds value.';
  assert.equal(current.hasDiminishingValueReasoning(answer), false);
  const mutant = mutateLine(
    'if (rejectsDiminishingRelation(sentence)) return false;',
    '    if (false && rejectsDiminishingRelation(sentence)) return false;',
  );
  assert.equal(mutant.hasDiminishingValueReasoning(answer), true,
    'removing the polarity veto must be caught');
});

test('M10: long-scope proposition negation must be honored', () => {
  const answer = 'It is not true that additional models add valuable information; the extra model is redundant.';
  assert.equal(current.hasDiminishingValueReasoning(answer), false);
  const mutant = mutateLine('const deniedProposition =', '  const deniedProposition = /a^/;');
  assert.equal(mutant.hasDiminishingValueReasoning(answer), true,
    'a proposition cue must not be replaced with a local token window');
});

test('M11: no reasonable person must not become positive redundancy evidence', () => {
  const answer = 'No reasonable person would call these models redundant.';
  assert.equal(current.hasDiminishingValueReasoning(answer), false);
  const mutant = mutateLine('const noReasonablePerson =', '  const noReasonablePerson = /a^/;');
  assert.equal(mutant.hasDiminishingValueReasoning(answer), true,
    'removing the no-agent cue must be caught');
});

test('M12: repeat language alone must not satisfy the relation', () => {
  const answer = 'The extra model repeats an unrelated log line.';
  assert.equal(current.hasDiminishingValueReasoning(answer), false);
  const mutant = mutateLine('const contextualRepeat =', '  const contextualRepeat = true;');
  assert.equal(mutant.hasDiminishingValueReasoning(answer), true,
    'repeat* needs a perspective relation');
});

test('M13: evidence must not serve as both subject and value', () => {
  const answer = 'The duplicate file contains negligible evidence.';
  assert.equal(current.hasDiminishingValueReasoning(answer), false);
  const mutant = mutateLine(
    "'reasoning', 'bias', 'biases', 'result', 'results', 'response', 'responses',",
    "  'reasoning', 'bias', 'biases', 'result', 'results', 'response', 'responses', 'evidence',",
  );
  assert.equal(mutant.hasDiminishingValueReasoning(answer), true,
    'promoting evidence into the subject role must be caught');
});

test('M14: semantic roles must not leak across sentences', () => {
  const answer = 'More models improve diversity. Marginal revenue falls.';
  assert.equal(current.hasDiminishingValueReasoning(answer), false);
  const mutant = mutateLine(
    'const sentences =',
    "  const sentences = [normaliseUnicodeText(String(text ?? ''))];",
  );
  assert.equal(mutant.hasDiminishingValueReasoning(answer), true,
    'combining independent sentences must be caught');
});

test('M15: but that is wrong must veto the apparent redundancy claim', () => {
  const answer = 'Some people call the models redundant, but that is wrong.';
  assert.equal(current.hasDiminishingValueReasoning(answer), false);
  const mutant = mutateLine('const wrongContrast =', '  const wrongContrast = /a^/;');
  assert.equal(mutant.hasDiminishingValueReasoning(answer), true,
    'the rejected first clause must not survive contrast');
});

test('M16: yet value remains high must veto the apparent repeat relation', () => {
  const answer = 'The extra model repeats an existing perspective, yet its incremental benefit remains high.';
  assert.equal(current.hasDiminishingValueReasoning(answer), false);
  const mutant = mutateLine('const staysHigh =', '  const staysHigh = /a^/;');
  assert.equal(mutant.hasDiminishingValueReasoning(answer), true,
    'high marginal value is the opposite conclusion');
});

test('M17: the live valid paraphrase must remain recognized', () => {
  const answer = 'The incremental benefit falls as the models become more similar.';
  assert.equal(current.hasDiminishingValueReasoning(answer), true);
  const mutant = mutateLine(
    'return values.some((value) => decreases.some((decrease) => within(value, decrease, 6)));',
    '  return false;',
  );
  assert.equal(mutant.hasDiminishingValueReasoning(answer), false,
    'removing the informational decrease leg must be caught');
});

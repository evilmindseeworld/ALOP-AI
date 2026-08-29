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

test('M18: semicolon contrast rejection must not be disabled', () => {
  const answer = 'The models appear redundant; every one contributes unique evidence.';
  assert.equal(current.hasDiminishingValueReasoning(answer), false);
  const mutant = mutateLine('return contrastiveRejection;', '  return false;');
  assert.equal(mutant.hasDiminishingValueReasoning(answer), true,
    'a semicolon-bound rejection must not be ignored');
});

test('M19: unique evidence must remain an explicit rejection stance', () => {
  const answer = 'The models appear redundant; however, every one contributes unique evidence.';
  assert.equal(current.hasDiminishingValueReasoning(answer), false);
  const mutant = mutateLine(
    "const TRADEOFF_POSITIVE_QUALITY_WORDS = new Set(['substantial', 'significant', 'meaningful', 'real', 'novel', 'new', 'high', 'unique', 'material', 'materially', 'valuable', 'useful']);",
    "  const TRADEOFF_POSITIVE_QUALITY_WORDS = new Set(['substantial', 'significant', 'meaningful', 'real', 'novel', 'new', 'high', 'material', 'materially', 'valuable', 'useful']);",
  );
  assert.equal(mutant.hasDiminishingValueReasoning(answer), true,
    'removing unique from positive evidence must be caught');
});

test('M20: explicit however must remain a contrast boundary', () => {
  const answer = 'The models appear redundant, however, every one contributes unique evidence.';
  assert.equal(current.hasDiminishingValueReasoning(answer), false);
  const mutant = mutateLine(
    "const TRADEOFF_CONTRAST_WORDS = new Set(['but', 'yet', 'although', 'though', 'however', 'while', 'nevertheless']);",
    "  const TRADEOFF_CONTRAST_WORDS = new Set(['but', 'yet', 'although', 'though', 'while', 'nevertheless']);",
  );
  assert.equal(mutant.hasDiminishingValueReasoning(answer), true,
    'removing however from explicit contrast handling must be caught');
});

test('M21: bare nothing must not satisfy a bound relation', () => {
  const answer = 'Another model says nothing.';
  assert.equal(current.hasDiminishingValueReasoning(answer), false);
  const mutant = mutateLine(
    'return hasInformationalDecrease(tokens) || hasImplicitContributionDecrease(tokens) || hasBoundRedundancy(clause, tokens);',
    "  return hasInformationalDecrease(tokens) || tokens.includes('nothing') || hasImplicitContributionDecrease(tokens) || hasBoundRedundancy(clause, tokens);",
  );
  assert.equal(mutant.hasDiminishingValueReasoning(answer), true,
    'accepting bare nothing after topical binding must be caught');
});

test('M22: contribution relation must be required for implicit decrease', () => {
  const answer = 'The sixth near-identical judge adds almost nothing that the first five did not already cover.';
  assert.equal(current.hasDiminishingValueReasoning(answer), true);
  const mutant = mutateLine(
    'return contributionVerbs.some((verb) => lowQuantifiers.some((low) => within(verb, low, 3)));',
    '  return false;',
  );
  assert.equal(mutant.hasDiminishingValueReasoning(answer), false,
    'removing the contribution-to-low-quantifier relation must be caught');
});

test('M23: cost-only almost nothing must not become contribution evidence', () => {
  const answer = 'Another model costs almost nothing.';
  assert.equal(current.hasDiminishingValueReasoning(answer), false);
  const mutant = mutateLine(
    "const TRADEOFF_CONTRIBUTION_WORDS = new Set(['add', 'adds', 'adding', 'contribute', 'contributes', 'contributing', 'bring', 'brings', 'bringing', 'offer', 'offers', 'offering', 'provide', 'provides', 'providing', 'improve', 'improves', 'improving']);",
    "  const TRADEOFF_CONTRIBUTION_WORDS = new Set(['add', 'adds', 'adding', 'contribute', 'contributes', 'contributing', 'bring', 'brings', 'bringing', 'offer', 'offers', 'offering', 'provide', 'provides', 'providing', 'improve', 'improves', 'improving', 'costs']);",
  );
  assert.equal(mutant.hasDiminishingValueReasoning(answer), true,
    'classifying cost as a contribution verb must be caught');
});

test('M24: an unrelated judge saying nothing must not pass', () => {
  const answer = 'The judge said nothing.';
  assert.equal(current.hasDiminishingValueReasoning(answer), false);
  const mutant = mutateLine(
    'if (!tokens.length || !hasCouncilAdditionBinding(tokens)) return false;',
    "      if (tokens.includes('nothing')) return true;\n      if (!tokens.length || !hasCouncilAdditionBinding(tokens)) return false;",
  );
  assert.equal(mutant.hasDiminishingValueReasoning(answer), true,
    'accepting an unbound nothing claim must be caught');
});

test('M25: sentence boundaries must remain relation boundaries', () => {
  const answer = 'More models improve diversity. Marginal revenue falls.';
  assert.equal(current.hasDiminishingValueReasoning(answer), false);
  const mutant = mutateLine(
    'const sentences = answerText.split(/[.!?]+/);',
    '  const sentences = [answerText];',
  );
  assert.equal(mutant.hasDiminishingValueReasoning(answer), true,
    'combining separate sentences must be caught');
});

test('M26: a final diminishing stance must survive earlier redundancy setup', () => {
  const answer = 'The models are redundant but each adds useful context; however, the marginal benefit from another model falls.';
  assert.equal(current.hasDiminishingValueReasoning(answer), true);
  const mutant = mutateLine(
    'const laterClauses = clauses.slice(1);',
    '  const laterClauses = clauses;',
  );
  assert.equal(mutant.hasDiminishingValueReasoning(answer), false,
    'earlier positive wording must not veto the final diminishing stance');
});

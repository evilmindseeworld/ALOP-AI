'use strict';

/*
 * MUTATION COVERAGE FOR THE OFFLINE EVALUATOR.
 *
 * A fixture that passes tells you the code agreed with you once. It does not
 * tell you the code would have DISAGREED with a broken version of itself —
 * and that is the property that matters for a grading instrument, because a
 * loose evaluator inflates the acceptance number it exists to measure.
 *
 * Each test below breaks the evaluator in one specific, previously-shipped or
 * plausible way and asserts a fixture goes red. The mutants are compiled from
 * source text, so nothing here can pass by reading a constant.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SOURCE = readFileSync(join(__dirname, 'evaluation.js'), 'utf8');
const current = require('./evaluation');

const loadMutant = (source) => {
  const module = { exports: {} };
  const localRequire = (request) => require(join(__dirname, request));
  new Function('require', 'module', 'exports', source)(localRequire, module, module.exports);
  return module.exports;
};

/**
 * Apply one textual mutation, failing loudly if the anchor has moved.
 *
 * Anchors are written with `\n`; the checkout may be CRLF, so match whichever
 * terminator the file on disk actually uses rather than silently finding
 * nothing and reporting a green mutant.
 */
const mutate = (find, replace) => {
  const eol = SOURCE.includes('\r\n') ? '\r\n' : '\n';
  const anchor = find.split('\n').join(eol);
  const patch = replace.split('\n').join(eol);
  assert.ok(SOURCE.includes(anchor), `mutation anchor vanished from evaluation.js: ${find}`);
  return loadMutant(SOURCE.replace(anchor, patch));
};

const BODY = 'This is a substantive answer about council design and model selection that runs past the length floor. ';
const POEM = 'Endpoints whisper soft\nLogs scream in silent rows\nRetries spin, nothing works\nCoffee fuels the fix';

/* ---- completion: the short-tail rules -------------------------------- */

test('M1: a blanket two-letter shortcut stops catching three-letter hanging tails', () => {
  const hanging = `${BODY}\nThe reason the second attempt failed was`;
  assert.equal(current.isLikelyComplete(hanging), false);
  const mutant = mutate(
    'if (CONTINUATION_WORDS.has(last)) return false;',
    'if (last.length <= 2 && CONTINUATION_WORDS.has(last)) return false;',
  );
  assert.equal(mutant.isLikelyComplete(hanging), true,
    'reverting to a length gate must be caught by a three-letter hanging tail');
});

test('M2: a blanket three-letter rejection starts calling complete poetry truncated', () => {
  assert.equal(current.isLikelyComplete(POEM), true);
  const mutant = mutate(
    "  if (answer.length >= 80 && trailingWord && trailingWord.length <= 2",
    "  if (answer.length >= 80 && trailingWord && trailingWord.length <= 3",
  );
  assert.equal(mutant.isLikelyComplete(POEM), false,
    'the old blanket <=3 rule must be caught by the poetry fixture');
});

test('M3: treating every punctuation-free answer as complete hides real truncation', () => {
  const hanging = `${BODY}\nYou should configure the service to`;
  assert.equal(current.isLikelyComplete(hanging), false);
  const mutant = mutate(
    "  const lastLine = answer.split(/\\r?\\n/).pop().trim();",
    "  if (!/[.!?]$/.test(answer)) return true;\n  const lastLine = answer.split(/\\r?\\n/).pop().trim();",
  );
  assert.equal(mutant.isLikelyComplete(hanging), true,
    'punctuation is not evidence of completeness and a fixture must say so');
});

/* ---- completion: the structural exemption ---------------------------- */

test('M4: an unanchored symbol match hands prose a structural exemption', () => {
  const prose = `${BODY}\nThe array [1, 2, 3] should be transformed to`;
  assert.equal(current.isLikelyComplete(prose), false);
  const mutant = mutate(
    'const isCodeShaped = (line) => /^(?: {4}|\\t)/.test(line)',
    'const isCodeShaped = (line) => /[`{}[\\]<>]/.test(line) || /^(?: {4}|\\t)/.test(line)',
  );
  assert.equal(mutant.isLikelyComplete(prose), true,
    'a stray bracket must not be able to buy a completeness exemption');
});

test('M5: bracket- and backtick-bearing prose must not become structured', () => {
  const cases = [
    `${BODY}\nUse <main> because it`,
    `${BODY}\nThe object {a: 1} can`,
    `${BODY}\nThe \`cache\` layer should`,
  ];
  for (const prose of cases) assert.equal(current.isLikelyComplete(prose), false, prose);
  const mutant = mutate(
    '  if (!codeShaped && !terminated && tokens.length) {',
    '  if (!/[`{}[\\]<>]/.test(lastLine) && !terminated && tokens.length) {',
  );
  for (const prose of cases) {
    assert.equal(mutant.isLikelyComplete(prose), true,
      `symbol-presence gating must be caught by: ${prose.split('\n').pop()}`);
  }
});

test('M6: no benchmark word can be the reason a fixture passes', () => {
  /* There is no completeness allow-list to hack, so the guard is a positive
   * one: the poem must pass for every content word, and fail for every
   * hanging one. A mutant that keys on the benchmark word `fix` cannot
   * satisfy both halves. */
  const poem = (tail) => `Endpoints whisper soft\nLogs scream in silent rows\nRetries spin, nothing works\nCoffee fuels the ${tail}`;
  for (const word of ['fix', 'bug', 'sky', 'dawn']) {
    assert.equal(current.isLikelyComplete(poem(word)), true, word);
  }
  const mutant = mutate(
    'if (CONTINUATION_WORDS.has(last)) return false;',
    "if (last === 'fix') return true;\n    if (CONTINUATION_WORDS.has(last)) return false;",
  );
  assert.equal(mutant.isLikelyComplete(poem('fix')), true, 'the special case is inert for a content word');
  assert.equal(mutant.isLikelyComplete(poem('was')), false,
    'a benchmark special case must not be able to rescue a hanging tail');
});

/* ---- diminishing value: negation and relation ------------------------ */

test('M7: treating bare "not" as diminishing evidence accepts the opposite claim', () => {
  const opposite = 'Extra models are not redundant at all; every one of them adds real value.';
  assert.equal(current.hasDiminishingValueReasoning(opposite), false);
  const mutant = mutate(
    'const negated = (tokens, index) => {',
    'const negated = () => false;\nconst unusedNegated = (tokens, index) => {',
  );
  assert.equal(mutant.hasDiminishingValueReasoning(opposite), true,
    'dropping negation handling must be caught by a negated redundancy claim');
});

test('M8: "same" alone is similarity, never evidence that value fell', () => {
  const similarityOnly = 'The answers are the same length as the ones we measured last week.';
  assert.equal(current.hasDiminishingValueReasoning(similarityOnly), false);
  const mutant = mutate(
    "  'replica', 'replicas', 'repeat', 'repeats', 'repeated', 'repetition',",
    "  'replica', 'replicas', 'repeat', 'repeats', 'repeated', 'repetition', 'same', 'similar',",
  );
  assert.equal(mutant.hasDiminishingValueReasoning(similarityOnly), true,
    'promoting a similarity word to a redundancy claim must be caught');
});

test('M9: an arbitrary cost word is not a diminishing-value relation', () => {
  const costOnly = 'Running more models costs more money and uses a larger compute budget for every request.';
  const latencyOnly = 'Adding more models increases latency and slows the response for every user.';
  assert.equal(current.hasDiminishingValueReasoning(costOnly), false);
  assert.equal(current.hasDiminishingValueReasoning(latencyOnly), false);
  const mutant = mutate(
    '    return values.some((v) => decreases.some((d) => within(v, d, 6)));',
    "    if (/\\b(?:cost|costs|latency|money|budget)\\b/.test(sentence)) return true;\n    return values.some((v) => decreases.some((d) => within(v, d, 6)));",
  );
  assert.equal(mutant.hasDiminishingValueReasoning(costOnly), true,
    'admitting a bare cost mention as the diminishing leg must be caught by a cost-only answer');
  assert.equal(mutant.hasDiminishingValueReasoning(latencyOnly), true,
    'admitting a bare latency mention must be caught by a latency-only answer');
});

test('M10: the relation must stay bound to the seats being added', () => {
  const unrelated = 'The models disagree, but the duplicate file was deleted after a long day.';
  assert.equal(current.hasDiminishingValueReasoning(unrelated), false);
  const mutant = mutate(
    'const within = (left, right, distance) => Math.abs(left - right) <= distance;',
    'const within = () => true;',
  );
  assert.equal(mutant.hasDiminishingValueReasoning(unrelated), true,
    'removing proximity binding must be caught by vocabulary that belongs to another topic');
});

test('M11: the legitimate paraphrase must not depend on any single word', () => {
  const paraphrase = 'The incremental benefit falls as the models become more similar.';
  assert.equal(current.hasDiminishingValueReasoning(paraphrase), true);
  const mutant = mutate(
    "'falls', 'falling',",
    "'falling',",
  );
  assert.equal(mutant.hasDiminishingValueReasoning(paraphrase), false,
    'the paraphrase fixture must be the thing that notices a shrunken decrease vocabulary');
});

test('M12: a negated redundancy claim must never be accepted', () => {
  const negated = [
    'Extra models are not redundant at all; every one of them adds real value.',
    'The marginal gain from another model is not negligible on hard questions.',
    'You should ask more models, not fewer, whenever the stakes are high.',
  ];
  for (const answer of negated) {
    assert.equal(current.hasDiminishingValueReasoning(answer), false, answer);
  }
  const mutant = mutate(
    "const TRADEOFF_NEGATORS = new Set([\n  'not', \"n't\", 'never', 'nor',",
    "const TRADEOFF_NEGATORS = new Set([\n  'never', 'nor',",
  );
  assert.equal(mutant.hasDiminishingValueReasoning(negated[0]), true,
    'dropping `not` from the negator set must be caught by a negated redundancy claim');
});

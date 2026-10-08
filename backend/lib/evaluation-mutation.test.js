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

const mutateSource = (mutations) => {
  let source = SOURCE;
  for (const [needle, replacement] of mutations) {
    const index = source.indexOf(needle);
    assert.notEqual(index, -1, 'mutation anchor vanished from evaluation.js: ' + needle);
    source = source.slice(0, index) + replacement + source.slice(index + needle.length);
  }
  return loadMutant(source);
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

/* ---- P1 authoritative repair v2 mutants ----------------------------- */

const P1_SUMMARY = 'When a job fails, the worker retries it after a delay. A lease prevents two workers from owning the same job, but if the lease expires another worker may safely reclaim the job.';
const P1_FACT_CASE = {
  id: 'p1-fact',
  question: 'What is the capital of Japan?',
  expect: {},
  factualityChecks: {
    modelInvolved: true,
    stableWhy: 'stable fixture',
    assertions: [{
      id: 'capital',
      claim: "Japan's capital is Tokyo.",
      patterns: ['\\btokyo\\b[^.!?;]{0,60}\\bcapital\\b[^.!?;]{0,60}\\bjapan\\b'],
      forbiddenPatterns: ['\\b(?:tokyo|japan)\\b[^.!?;]{0,70}\\b(?:is|are|was|were)\\s+not\\b[^.!?;]{0,80}\\bcapital\\b'],
    }],
  },
};

test('M27: every summary relation must remain required', () => {
  const answer = 'The worker retries healthy jobs after a delay. A lease prevents two workers from owning the same job. If the lease expires, another worker reclaims it.';
  assert.equal(current.hasSummarySemantics(answer), false);
  const mutant = mutateLine(
    'failureRetryRelation: clauses.some(hasFailureRetryRelation),',
    '    failureRetryRelation: true,',
  );
  assert.equal(mutant.hasSummarySemantics(answer), true,
    'a retry without a failure relation must remain red');
});

test('M28: lease ownership must remain distinct from a lease and a worker', () => {
  const answer = 'A worker retries a failed job. If the lease expires, another worker reclaims the job.';
  assert.equal(current.hasSummarySemantics(answer), false);
  const mutant = mutateLine(
    'leaseOwnership: clauses.some(hasLeaseOwnershipRelation),',
    '    leaseOwnership: true,',
  );
  assert.equal(mutant.hasSummarySemantics(answer), true,
    'a lease without an ownership relation must remain red');
});

test('M29: reclaim-after-expiry must remain required', () => {
  const answer = 'A worker retries a failed job. A lease prevents two workers from owning the same job.';
  assert.equal(current.hasSummarySemantics(answer), false);
  const mutant = mutateLine(
    'reclaimAfterExpiry: clauses.some(hasReclaimAfterExpiryRelation),',
    '    reclaimAfterExpiry: true,',
  );
  assert.equal(mutant.hasSummarySemantics(answer), true,
    'reclaim without expiry must remain red');
});

test('M30: plural and inflected retry wording must not regress to the literal retry stem', () => {
  assert.equal(current.hasSummarySemantics(P1_SUMMARY), true);
  const mutant = mutateLine(
    'const SUMMARY_RETRY_RE = /\\bretr(?:y|ies|ied|ying)\\b/i;',
    'const SUMMARY_RETRY_RE = /\\bretry\\b/i;',
  );
  assert.equal(mutant.hasSummarySemantics(P1_SUMMARY), false,
    'the stored retries wording must remain accepted');
});

test('M31: explicit negation must veto an otherwise topical retry relation', () => {
  const answer = 'A worker does not retry a failed job. A lease prevents two workers from owning the same job. If the lease expires, another worker reclaims it.';
  assert.equal(current.hasSummarySemantics(answer), false);
  const mutant = mutateLine(
    'if (SUMMARY_NEGATION_RE.test(text.replace(/\\bretr(?:y|ies|ied|ying)\\b/i, \'\'))) return false;',
    '  if (false) return false;',
  );
  assert.equal(mutant.hasSummarySemantics(answer), true,
    'negated retry claims must remain red');
});

test('M37: removing bounded hold support is caught by the exact live answer', () => {
  const answer = 'A worker retries a failed job after a delay, and a lease mechanism ensures that only one worker can hold the job at any time. When the lease expires, another worker can safely take over the job.';
  assert.equal(current.hasSummarySemantics(answer), true);
  const mutant = mutateLine(
    'const boundedPossession = /',
    '  const boundedPossession = /a^/;',
  );
  assert.equal(mutant.hasSummarySemantics(answer), false,
    'removing the bounded hold relation must be caught');
});

test('M38: removing take-over support is caught by the exact live answer', () => {
  const answer = 'A worker retries a failed job after a delay, and a lease mechanism ensures that only one worker can hold the job at any time. When the lease expires, another worker can safely take over the job.';
  assert.equal(current.hasSummarySemantics(answer), true);
  const mutant = mutateLine(
    'const SUMMARY_TRANSFER_RE = /',
    'const SUMMARY_TRANSFER_RE = /\\breclaim(?:s|ed|ing)?\\b/i;',
  );
  assert.equal(mutant.hasSummarySemantics(answer), false,
    'removing take-over vocabulary must be caught');
});

test('M39: hold without lease exclusivity must remain red', () => {
  const answer = 'A worker retries a failed job. A lease is associated with a worker that can hold the job. If the lease expires, another worker reclaims the job.';
  assert.equal(current.hasSummarySemantics(answer), false);
  const mutant = mutateLine(
    'const boundedPossession = /',
    '  const boundedPossession = /\\blease\\b[^.!?;]{0,120}\\bworkers?\\b[^.!?;]{0,100}\\b(?:hold|holds|holding)\\b[^.!?;]{0,50}\\bjobs?\\b/i;',
  );
  assert.equal(mutant.hasSummarySemantics(answer), true,
    'lease plus worker plus hold plus job must not be enough');
});

test('M40: takeover before expiry must remain red', () => {
  const answer = 'A worker retries a failed job. A lease prevents two workers from owning the same job. Another worker can take over before the lease expires.';
  assert.equal(current.hasSummarySemantics(answer), false);
  const mutant = mutateLine(
    'const cue = matchAfter(text, /\\b(?:after|when|once|upon|following)\\b/i, transfer?.end',
    '  const cue = matchAfter(text, /\\b(?:after|before|when|once|upon|following)\\b/i, transfer?.end ?? text.length);',
  );
  assert.equal(mutant.hasSummarySemantics(answer), true,
    'the expiry direction must remain part of the relation');
});

test('M41: takeover negation must remain a rejection', () => {
  const answer = 'A worker retries a failed job. A lease prevents two workers from owning the same job. When the lease expires, another worker cannot take over the job.';
  assert.equal(current.hasSummarySemantics(answer), false);
  const mutant = mutateLine(
    'if (SUMMARY_TRANSFER_NEGATION_RE.test(text)) return false;',
    '  if (false) return false;',
  );
  assert.equal(mutant.hasSummarySemantics(answer), true,
    'negated takeover must not pass');
});

test('M42: hold negation must remain a rejection', () => {
  const answer = 'A worker retries a failed job. A lease does not ensure that only one worker holds the job. If the lease expires, another worker reclaims the job.';
  assert.equal(current.hasSummarySemantics(answer), false);
  const mutant = mutateLine(
    'if (SUMMARY_OWNERSHIP_NEGATION_RE.test(text)) return false;',
    '  if (false) return false;',
  );
  assert.equal(mutant.hasSummarySemantics(answer), true,
    'negated hold exclusivity must not pass');
});

test('M43: wildcard lease ownership must remain red', () => {
  const answer = 'A worker retries a failed job. Lease worker hold job one. If the lease expires, another worker reclaims the job.';
  assert.equal(current.hasSummarySemantics(answer), false);
  const relationGuard = [
    '  if (!bounded.test(text) && !boundedExclusive.test(text) && !boundedWorkerExclusive.test(text)',
    '    && !boundedPossession.test(text) && !boundedControlPossession.test(text)',
    '    && !boundedJobWorkerControl.test(text)',
    '    && !boundedJobWithWorker.test(text) && !reverse.test(text)) return false;',
  ].join('\n');
  const mutant = mutateSource([[relationGuard, '  if (false) return false;']]);
  assert.equal(mutant.hasSummarySemantics(answer), true,
    'a wildcard lease relation must be caught');
});

test('M44: wildcard expiry reclaim must remain red', () => {
  const answer = 'A worker retries a failed job. A lease prevents two workers from owning the same job. Another worker takes over the job.';
  assert.equal(current.hasSummarySemantics(answer), false);
  const expiryGate = '  if (!SUMMARY_EXPIRY_RE.test(text) || !SUMMARY_WORKER_RE.test(text) || !SUMMARY_TRANSFER_RE.test(text)) return false;';
  const relationGuard = '  if (!positive.some((pattern) => pattern.test(text)) && !hasForwardExpiryTransfer(text) && !hasReverseExpiryTransfer(text)) return false;';
  const mutant = mutateSource([
    [expiryGate, '  if (!SUMMARY_WORKER_RE.test(text) || !SUMMARY_TRANSFER_RE.test(text)) return false;'],
    [relationGuard, '  if (false) return false;'],
  ]);
  assert.equal(mutant.hasSummarySemantics(answer), true,
    'a wildcard expiry relation must be caught');
});

test('M32: a positive factuality pattern cannot be replaced with unconditional truth', () => {
  const answer = "Japan's capital is unknown.";
  const currentGrade = current.gradeCase(P1_FACT_CASE, { answer, frames: [] });
  assert.equal(currentGrade.factuality.passed, false);
  const mutant = mutateLine(
    "new RegExp(normaliseUnicodeText(pattern), 'i').test(normalisedAnswer));",
    '      true);',
  );
  assert.equal(mutant.gradeCase(P1_FACT_CASE, { answer, frames: [] }).factuality.passed, true,
    'removing the positive assertion must be caught');
});

test('M33: forbidden factuality patterns cannot be discarded', () => {
  const answer = 'Plants use chlorophyll to capture light energy, but plants do not use chlorophyll.';
  const factCase = {
    id: 'p1-plant-fact',
    question: 'What is photosynthesis?',
    expect: {},
    factualityChecks: {
      modelInvolved: true,
      stableWhy: 'stable fixture',
      assertions: [{
        id: 'plant-claim',
        claim: 'Plants use chlorophyll to capture light energy.',
        patterns: ['\\bplants?\\b[^.!?;]{0,80}\\buse\\b[^.!?;]{0,60}\\bchlorophyll\\b[^.!?;]{0,100}\\blight\\s+energy\\b'],
        forbiddenPatterns: ['\\bplants?\\b[^.!?;]{0,100}\\bdo\\s+not\\b[^.!?;]{0,60}\\buse\\b[^.!?;]{0,50}\\bchlorophyll\\b'],
      }],
    },
  };
  assert.equal(current.gradeCase(factCase, { answer, frames: [] }).factuality.passed, false);
  const mutant = mutateLine(
    'const forbidden = (assertion.forbiddenPatterns || []).filter((pattern) =>',
    '    const forbidden = [].filter((pattern) =>',
  );
  assert.equal(mutant.gradeCase(factCase, { answer, frames: [] }).factuality.passed, true,
    'a negated claim must remain red');
});

test('M34: factuality must not inherit the whole-case pass result', () => {
  const factCase = { ...P1_FACT_CASE, expect: { maxLatencyMs: 50 } };
  const grade = current.gradeCase(factCase, { answer: 'Tokyo is the capital of Japan.', frames: [], latencyMs: 100 });
  assert.equal(grade.passed, false);
  assert.equal(grade.factuality.passed, true);
  assert.equal(current.summarise([grade], [{ id: factCase.id, answer: 'Tokyo is the capital of Japan.' }]).factualityPassRate, 1);
  const mutant = mutateLine(
    '.map((grade) => grade.factuality)',
    '.map((grade) => ({ eligible: true, modelInvolved: true, measured: true, inconclusive: false, passed: grade.passed, assertions: [] }))',
  );
  assert.equal(mutant.summarise([grade], [{ id: factCase.id, answer: 'Tokyo is the capital of Japan.' }]).factualityPassRate, 0,
    'a whole-case latency failure must not become factuality failure');
});

test('M35: model-free deterministic cases must stay out of model factuality', () => {
  const deterministic = {
    ...P1_FACT_CASE,
    factualityChecks: { ...P1_FACT_CASE.factualityChecks, modelInvolved: false },
  };
  const observation = { answer: 'Tokyo is the capital of Japan.', frames: [] };
  assert.equal(current.summarise(
    [current.gradeCase(deterministic, observation)], [{ id: deterministic.id, ...observation }],
  ).factualityEligibleModelCases, 0);
  const mutant = mutateLine(
    "if (spec.modelInvolved !== true) return { ...base, reason: 'model_not_involved' };",
    '  if (false) return { ...base, reason: \'model_not_involved\' };',
  );
  assert.equal(mutant.summarise(
    [mutant.gradeCase(deterministic, observation)], [{ id: deterministic.id, ...observation }],
  ).factualityEligibleModelCases, 1,
    'bypassing the model-involved guard must be caught');
});

test('M36: wildcard-only factuality assertions must remain invalid', () => {
  const invalid = {
    id: 'wildcard-fact',
    question: 'q',
    expect: {},
    factualityChecks: {
      modelInvolved: true,
      stableWhy: 'stable fixture',
      assertions: [{ id: 'a', claim: 'claim', patterns: ['.*'], forbiddenPatterns: [] }],
    },
  };
  assert.ok(current.validateCase(invalid).some((problem) => problem.includes('wildcard-only')));
  const mutant = mutateLine(
    'if (/^(?:\\^)?\\.\\*(?:\\$)?$/.test(pattern.trim())) {',
    '        if (false) {',
  );
  assert.deepEqual(mutant.validateCase(invalid), [], 'wildcard validation mutant must be caught');
});

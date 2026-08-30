'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  gradeCase,
  hasSummarySemantics,
  loadDataset,
  summarise,
  summarySemantics,
  validateCase,
} = require('./evaluation');

const EVAL_ROOT = join(__dirname, '..', 'evals');
const v1 = JSON.parse(readFileSync(join(EVAL_ROOT, 'backend-intelligence-v1.json'), 'utf8'));
const v2 = JSON.parse(readFileSync(join(EVAL_ROOT, 'backend-intelligence-v2.json'), 'utf8'));

const observation = (answer, over = {}) => ({
  id: over.id || 'fixture',
  answer,
  frames: [],
  latencyMs: 1,
  error: null,
  ...over,
});

const authoritativeSummaryAnswer = 'When a job fails, the worker retries it after a delay. A lease prevents two workers from owning the same job, but if the lease expires another worker may safely reclaim the job.';

test('the authoritative Aug 30 summary reproduces the old false negative and passes the semantic v2 expectation', () => {
  assert.equal(/retry|failed/i.test(authoritativeSummaryAnswer), false, 'the old literal stems must fail on the stored answer');
  assert.equal(/lease|worker/i.test(authoritativeSummaryAnswer), true, 'the second old literal check still matches');

  const testCase = v2.cases.find(({ id }) => id === 'user-text-summary-v2');
  const grade = gradeCase(testCase, observation(authoritativeSummaryAnswer, { id: testCase.id }));
  const summaryCheck = grade.checks.find(({ name }) => name === 'mustPreserveSummary');
  assert.equal(summaryCheck.ok, true, summaryCheck.detail);
  assert.equal(grade.passed, true, grade.failures.join('|'));
});

test('the summary matcher accepts morphology and paraphrase while requiring all three relations', () => {
  const positiveParaphrases = [
    'A worker retries a failed task after a delay. A lease prevents multiple workers from owning the same task. Once the lease has expired, another worker can reclaim the task.',
    'Workers retry failed jobs; a lease ensures only one worker owns a job; when the lease expires, another worker reclaims the job.',
    'A failed job is retried by its worker. A lease prevents two workers from owning the same job. If the lease has expired, a different worker may reclaim it.',
  ];
  for (const answer of positiveParaphrases) {
    assert.equal(hasSummarySemantics(answer), true, JSON.stringify({ answer, semantics: summarySemantics(answer) }));
  }
});

test('the summary matcher rejects missing relations, unrelated vocabulary, negation, and substring traps', () => {
  const adversarialNegatives = [
    ['failure without retry relationship', 'The job failed, but the worker logged the incident. A lease prevents two workers from owning the job. If the lease expires, another worker reclaims it.'],
    ['retry without failure relationship', 'The worker retries healthy jobs after a delay. A lease prevents two workers from owning the job. If the lease expires, another worker reclaims it.'],
    ['lease without ownership relation', 'A lease has a duration, but ownership is assigned by a separate system. A worker retries a failed job. If the lease expires, another worker reclaims it.'],
    ['worker without lease', 'A worker retries a failed job. Two workers own different jobs. If the job expires, another worker reclaims it.'],
    ['no reclaim-after-expiry', 'A worker retries a failed job. A lease prevents two workers from owning the same job.'],
    ['irrelevant retry and failure', 'A worker retries a failed email while the job lease protects ownership. When the lease expires, another worker reclaims the job.'],
    ['keyword stuffing in separate statements', 'Retry logic exists. Failure reporting exists. Lease exists. Worker exists. Reclaim happens after expiry.'],
    ['negated ownership/reclaim', 'A worker retries a failed job, but a lease does not prevent workers from owning the same job and an expired lease cannot be reclaimed.'],
    ['substring traps', 'A leaseholder owns the job; a retrial and a failure report are unrelated words, and reclamation is discussed without expiry.'],
  ];
  for (const [label, answer] of adversarialNegatives) {
    assert.equal(hasSummarySemantics(answer), false, `${label}: ${JSON.stringify(summarySemantics(answer))}`);
  }
});

const factualityAnswers = {
  'simple-fact-japan-capital': 'Tokyo is the capital of Japan.',
  'simple-explanation-photosynthesis': 'Photosynthesis is how plants use chlorophyll to capture light energy and make food.',
  'moderate-cache-tradeoff': 'A cache makes responses faster by reducing latency, but a stale cache can return wrong data, so invalidation and refresh matter.',
  'search-not-needed-binary-search': 'Binary search works on a sorted array. It checks the middle and halves the remaining range, giving logarithmic time.',
  'timeless-definition-idempotency': 'An idempotent API operation has the same effect when the request is repeated, without creating a duplicate side effect.',
};

test('v2 has exactly five stable model-involved factuality cases and six explicit assertions', () => {
  assert.deepEqual(loadDataset(v2).problems, []);
  assert.equal(v2.cases.length, 21);
  const factCases = v2.cases.filter(({ factualityChecks }) => factualityChecks);
  assert.equal(factCases.length, 5);
  assert.equal(factCases.reduce((count, testCase) => count + testCase.factualityChecks.assertions.length, 0), 6);
  assert.ok(factCases.every(({ factualityChecks }) => factualityChecks.modelInvolved === true));
  assert.ok(factCases.every(({ factualityChecks }) => factualityChecks.stableWhy.length > 20));
  assert.equal(v2.cases.find(({ id }) => id === 'full-council-overkill-arithmetic').factualityChecks, undefined);
  for (const id of ['fresh-openrouter-price', 'fresh-node-lts', 'fresh-weather-search']) {
    assert.equal(v2.cases.find((testCase) => testCase.id === id).factualityChecks, undefined, id);
  }
});

test('positive stable assertions measure independently from whole-case pass', () => {
  for (const testCase of v2.cases.filter(({ factualityChecks }) => factualityChecks)) {
    const grade = gradeCase(testCase, observation(factualityAnswers[testCase.id], { id: testCase.id }));
    assert.equal(grade.factuality.measured, true, testCase.id);
    assert.equal(grade.factuality.passed, true, `${testCase.id}: ${grade.factuality.failures.join('|')}`);
  }

  const japan = v2.cases.find(({ id }) => id === 'simple-fact-japan-capital');
  const late = gradeCase(japan, observation(factualityAnswers[japan.id], { id: japan.id, latencyMs: 100000 }));
  assert.equal(late.passed, false, 'the general latency result is a failure');
  assert.equal(late.factuality.passed, true, 'the factuality result remains measured and passing');
});

test('negation, reversed relation, wrong entity/value, wrong numeric, and keyword stuffing fail factuality assertions', () => {
  const japan = v2.cases.find(({ id }) => id === 'simple-fact-japan-capital');
  const photosynthesis = v2.cases.find(({ id }) => id === 'simple-explanation-photosynthesis');
  const binary = v2.cases.find(({ id }) => id === 'search-not-needed-binary-search');

  const cases = [
    [japan, 'Tokyo is not the capital of Japan.'],
    [japan, 'Tokyo is the capital of France.'],
    [photosynthesis, 'Plants, chlorophyll, and light are mentioned here, but plants do not use chlorophyll and release no oxygen during photosynthesis.'],
    [binary, 'Binary search does not require sorted input and may inspect every element linearly.'],
  ];
  for (const [testCase, answer] of cases) {
    const result = gradeCase(testCase, observation(answer, { id: testCase.id }));
    assert.equal(result.factuality.passed, false, `${testCase.id}: ${answer}`);
  }

  const numericCase = {
    id: 'stable-numeric-fixture',
    question: 'What is the defined reference speed in this fixture?',
    factualityChecks: {
      modelInvolved: true,
      stableWhy: 'The fixture uses a fixed scientific reference value rather than a current measurement.',
      assertions: [{
        id: 'reference-speed',
        claim: 'The reference speed is 299,792,458 m/s.',
        patterns: ['\\b299[,.]?792[,.]?458\\s*m\\s*/\\s*s\\b'],
        forbiddenPatterns: ['\\b299[,.]?792[,.]?459\\s*m\\s*/\\s*s\\b'],
      }],
    },
    expect: {},
  };
  const numeric = gradeCase(numericCase, observation('The reference speed is 299,792,459 m/s.', { id: numericCase.id }));
  assert.equal(numeric.factuality.passed, false, 'a wrong numeric value must not pass by nearby digits');
});

test('a broad keyword pass can still fail the separate factuality result', () => {
  const testCase = v2.cases.find(({ id }) => id === 'simple-explanation-photosynthesis');
  const answer = 'Plants, chlorophyll, and light are keywords, but plants do not use chlorophyll and release no oxygen during photosynthesis.';
  const grade = gradeCase(testCase, observation(answer, { id: testCase.id }));
  assert.equal(grade.passed, true, grade.failures.join('|'));
  assert.equal(grade.factuality.passed, false);
  assert.ok(grade.factuality.failures.length > 0);
});

test('deterministic and untagged cases do not become model factuality evidence', () => {
  const deterministic = {
    id: 'deterministic-fixture',
    question: 'What is 2 + 2?',
    tags: ['factuality'],
    expect: { mustInclude: ['4'] },
    factualityChecks: {
      modelInvolved: false,
      stableWhy: 'The answer is computed by a deterministic fixture.',
      assertions: [{ id: 'four', claim: 'the answer is four', patterns: ['\\b4\\b'], forbiddenPatterns: [] }],
    },
  };
  const modelFreeGrade = gradeCase(deterministic, observation('4', { id: deterministic.id }));
  const untaggedGrade = gradeCase({ id: 'untagged', question: 'q', expect: {} }, observation('A complete answer.', { id: 'untagged' }));
  const metrics = summarise([modelFreeGrade, untaggedGrade], [
    observation('4', { id: deterministic.id }),
    observation('A complete answer.', { id: 'untagged' }),
  ]);
  assert.equal(metrics.factualityEligibleModelCases, 0);
  assert.equal(metrics.factualityMeasuredCases, 0);
  assert.equal(metrics.factualityPassRate, null);
});

test('v2 replaces only the summary case while v1 remains the historical denominator', () => {
  assert.equal(v1.cases.length, 21);
  assert.equal(v2.cases.length, 21);
  assert.ok(v1.cases.some(({ id }) => id === 'user-text-summary'));
  assert.ok(v2.cases.some(({ id }) => id === 'user-text-summary-v2'));
  assert.equal(v2.cases.filter(({ id }) => id === 'user-text-summary' || id === 'user-text-summary-v2').length, 1);
  const oldSummary = v1.cases.find(({ id }) => id === 'user-text-summary');
  const newSummary = v2.cases.find(({ id }) => id === 'user-text-summary-v2');
  assert.deepEqual(oldSummary.question, newSummary.question);
  assert.equal(newSummary.expect.mustPreserveSummary, 'worker-lease-retry-reclaim-v1');
  assert.equal(newSummary.expect.mustMatch, undefined);
});

test('factuality metadata refuses wildcard-only and unknown assertion fields', () => {
  const problems = validateCase({
    id: 'invalid-factuality',
    question: 'q',
    factualityChecks: {
      modelInvolved: true,
      stableWhy: 'stable',
      assertions: [{ id: 'a', claim: 'claim', patterns: ['.*'], forbiddenPatterns: [], extra: true }],
    },
    expect: {},
  });
  assert.ok(problems.some((problem) => problem.includes('unknown factuality assertion key')));
  assert.ok(problems.some((problem) => problem.includes('wildcard-only')));
});

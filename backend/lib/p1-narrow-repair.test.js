'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { gradeCase, loadDataset, summarise, inspectCompletionMetadata } = require('./evaluation');
const { evaluateGates } = require('./release-gates');
const { classifyFailureKind } = require('./failure-kind');
const { degradeAnswer } = require('./synthesis-degrade');

const EVAL_ROOT = join(__dirname, '..', 'evals');
const readManifest = (name) => JSON.parse(readFileSync(join(EVAL_ROOT, `${name}.json`), 'utf8'));
const oldManifest = readManifest('backend-intelligence-v1');
const repairedManifest = readManifest('backend-intelligence-v2');

const completeObservation = (id, answer, over = {}) => ({
  id,
  answer,
  frames: [],
  latencyMs: 100,
  firstByteMs: 20,
  firstAnswerTokenMs: 80,
  firstUsefulStageMs: 10,
  costCents: null,
  textSource: 'content',
  error: null,
  provenance: {
    requestState: 'complete',
    completion: { assembled: true },
  },
  ...over,
});

const caseById = (manifest, id) => manifest.cases.find((testCase) => testCase.id === id);

/* This is the saved false negative on the clean base: the summary contains
 * the concepts, but `retry` is not a substring of `retries` and `failed` is
 * not a substring of `fails`. The versioned case fixes the expectation, not
 * the evaluator's general matching semantics. */
test('the historical summary is red on its own valid concept-preserving output', () => {
  const testCase = caseById(oldManifest, 'user-text-summary');
  const answer = 'When a job fails, the worker retries it after a delay. A lease prevents two workers from owning the same job, but another worker may reclaim it after expiration.';
  const grade = gradeCase(testCase, completeObservation(testCase.id, answer));

  assert.equal(grade.passed, false, grade.failures.join('|'));
  assert.ok(grade.failures.includes('mustMatch:retry|failed'));
});

test('the repaired summary accepts required retry and failure inflections', () => {
  const testCase = caseById(repairedManifest, 'user-text-summary-v2');
  const answers = [
    'The worker can retry a failed job after a delay. A lease prevents two workers from owning the same job.',
    'The worker retries a job that fails after a delay. A lease prevents two workers from owning it.',
    'The worker retried the job after a failure. A lease prevents two workers from owning it.',
    'The worker retries a failed job after a delay. A lease prevents two workers from owning the same job.',
    'The worker retried a job that fails after a delay. A lease prevents two workers from owning it.',
    'The worker can retry after a failure. A lease prevents two workers from owning the same job.',
  ];

  const grades = answers.map((answer) => gradeCase(testCase, completeObservation(testCase.id, answer)));
  assert.ok(grades.every((grade) => grade.passed), grades.map((grade) => grade.failures.join('|')).join('\n'));
  assert.equal(grades.length, 6);
});

test('summary negative controls without retry and failure concepts still fail', () => {
  const testCase = caseById(repairedManifest, 'user-text-summary-v2');
  const answers = [
    'The worker processes the job after a delay. A lease prevents two workers from owning it, and another worker may reclaim it after expiration.',
    'A worker handles a job under a lease and may reclaim it after expiration. The ownership rule prevents two workers from using it at once.',
    'A lease gives one worker ownership of a job. When it expires, another worker can safely reclaim the job after the delay.',
  ];

  const grades = answers.map((answer) => gradeCase(testCase, completeObservation(testCase.id, answer)));
  assert.ok(grades.every((grade) => !grade.passed), grades.map((grade) => grade.failures.join('|')).join('\n'));
  assert.ok(grades.every((grade) => grade.failures.some((failure) => failure.startsWith('mustMatch:'))));
});

test('the versioned manifest validates while the historical manifest stays unchanged', () => {
  assert.deepEqual(loadDataset(oldManifest).problems, []);
  assert.deepEqual(loadDataset(repairedManifest).problems, []);
  assert.equal(caseById(oldManifest, 'user-text-summary').expect.mustMatch.join('|'), 'retry|failed|lease|worker');
  assert.equal(caseById(repairedManifest, 'user-text-summary-v2').expect.mustMatch[0], '\\b(?:retry|retries|retried)\\b');
});

const FACTUAL_FIXTURES = new Map([
  ['simple-fact-japan-capital', 'Tokyo is the capital of Japan.'],
  ['simple-explanation-photosynthesis', 'Photosynthesis is how plants use chlorophyll to capture light energy, make sugar, and release oxygen.'],
  ['multi-step-break-even', 'The expected average is about 44 ms: 80% of requests take 5 ms and 20% miss to the 200 ms path. The cache needs invalidation to avoid stale results and must preserve consistency under load.'],
  ['search-not-needed-binary-search', 'Binary search examines the middle of a sorted list and halves the remaining ordered range at each step, so its time complexity is logarithmic, O(log n). Each comparison discards half of the remaining candidates.'],
  ['full-council-overkill-arithmetic', '57.8'],
  ['timeless-definition-idempotency', 'Idempotency means repeating the same API request or operation has the same effect. For example, repeating a payment request with the same idempotency key does not create a second charge.'],
  ['stable-fact-water-formula-v2', 'The chemical formula of water is H2O.'],
  ['stable-fact-speed-of-light-v2', 'The speed of light in a vacuum is approximately 299,792,458 metres per second.'],
]);

test('v1 factuality is genuinely unknown, not a zero or a hidden denominator', () => {
  const { cases, problems } = loadDataset(oldManifest);
  assert.deepEqual(problems, []);
  assert.equal(cases.filter((testCase) => testCase.tags.includes('factuality')).length, 0);

  const grades = cases.map((testCase) => gradeCase(testCase, completeObservation(testCase.id, 'A complete response without a frozen fact.')));
  const metrics = summarise(grades, cases.map((testCase) => completeObservation(testCase.id, 'A complete response without a frozen fact.')));
  assert.equal(metrics.factualityPassRate, null);
});

test('v2 factuality is measurable over eight stable cases with only eligible cases counted', () => {
  const factualCases = repairedManifest.cases.filter((testCase) => testCase.tags.includes('factuality'));
  assert.equal(factualCases.length, 8);
  assert.deepEqual(new Set(factualCases.map((testCase) => testCase.id)), new Set(FACTUAL_FIXTURES.keys()));

  const observations = factualCases.map((testCase) => completeObservation(testCase.id, FACTUAL_FIXTURES.get(testCase.id)));
  const grades = factualCases.map((testCase, index) => gradeCase(testCase, observations[index]));
  assert.ok(grades.every((grade) => grade.passed), grades.map((grade) => grade.failures.join('|')).join('\n'));
  const metrics = summarise(grades, observations);
  assert.equal(metrics.factualityPassRate, 1);
  assert.equal(metrics.evaluatedCases, 8);
  assert.equal(metrics.factualityPassRate, 8 / 8);
});

test('an unmeasured factuality observation remains fail-closed', () => {
  const testCase = caseById(repairedManifest, 'stable-fact-water-formula-v2');
  const observation = completeObservation(testCase.id, '', { error: { code: 'provider_error', text: 'synthetic provider failure' } });
  const grade = gradeCase(testCase, observation);
  assert.equal(grade.inconclusive, true);

  const metrics = summarise([grade], [observation]);
  assert.equal(metrics.factualityPassRate, null);
  const gate = evaluateGates({ ...metrics, cases: 8, evaluatedCases: 8, coverageRate: 1 });
  assert.ok(gate.inconclusive.includes('factuality'));
});

test('volatile current-information cases are not frozen into factuality', () => {
  for (const id of ['fresh-node-lts', 'fresh-openrouter-price', 'fresh-weather-search']) {
    const testCase = caseById(repairedManifest, id);
    assert.ok(testCase, id);
    assert.equal(testCase.tags.includes('factuality'), false, `${id} must not enter the stable factuality denominator`);
  }
});

test('explicit provider truncation stays incomplete even when assembled is true', () => {
  const fragment = completeObservation(
    'synthetic-terminal-fragment',
    'The policy should expand when models disagree and',
    {
      finishReason: 'length',
      frames: [{ type: 'finish', finish_reason: 'length' }],
    },
  );
  const metadata = inspectCompletionMetadata(fragment);
  const grade = gradeCase({ id: fragment.id, tags: [], expect: { minChars: 20 } }, fragment);

  assert.equal(fragment.provenance.completion.assembled, true);
  assert.equal(metadata.status, 'incomplete');
  assert.equal(grade.passed, false);
  assert.ok(grade.failures.some((failure) => failure.startsWith('completeness')));
});

test('a normal stop with a terminal answer remains complete at the same seam', () => {
  const answer = 'The policy should expand only when the evidence or model perspectives materially disagree.';
  const stopped = completeObservation(
    'synthetic-normal-stop',
    answer,
    {
      finishReason: 'stop',
      frames: [{ type: 'finish', finish_reason: 'stop' }],
    },
  );
  const metadata = inspectCompletionMetadata(stopped);
  const grade = gradeCase({ id: stopped.id, tags: [], expect: { minChars: 20 } }, stopped);

  assert.equal(metadata.status, 'complete');
  assert.equal(grade.passed, true, grade.failures.join('|'));
});

test('synthetic OpenRouter provider failure uses the existing qualified draft degradation seam', () => {
  const providerError = Object.assign(new Error('synthetic upstream failure'), {
    code: 'OPENROUTER_HTTP_ERROR',
    status: 503,
  });
  const survivingDraft = {
    content: 'The surviving research draft gives the qualified price and preserves its source: https://openrouter.ai/models.',
    textSource: 'content',
    finishReason: 'stop',
  };

  assert.equal(classifyFailureKind(providerError), 'provider_error');
  assert.equal(degradeAnswer({ aborted: false, wroteChars: 0, drafts: [survivingDraft] }), survivingDraft.content);
});

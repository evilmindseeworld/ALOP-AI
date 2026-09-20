'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  gradeCase,
  hasSummarySemantics,
  inspectCompletionMetadata,
  loadDataset,
  summarise,
  summarySemantics,
  validateCase,
} = require('./evaluation');

const EVAL_ROOT = join(__dirname, '..', 'evals');
const v1 = JSON.parse(readFileSync(join(EVAL_ROOT, 'backend-intelligence-v1.json'), 'utf8'));
const v2 = JSON.parse(readFileSync(join(EVAL_ROOT, 'backend-intelligence-v2.json'), 'utf8'));
const PARENT_SHA = '448b54dc1d29c86213813ea2033e66cedecb718c';
const LIVE_ARTIFACT_PATH = process.env.P1_LIVE_SUMMARY_ARTIFACT
  || 'C:/Users/LENOVO/Documents/AI-Classroom/eval-runs/p1-v2-focused-summary-2026-08-31/summary-attempt-1.json';
const LIVE_ARTIFACT_SHA256 = '321b7b4fa95a451181f5a4645c942c79f6edae8bbb28ea13b328b36932122bc1';
const LIVE_SUMMARY_ANSWER = 'A worker retries a failed job after a delay, and a lease mechanism ensures that only one worker can hold the job at any time. When the lease expires, another worker can safely take over the job.';

const observation = (answer, over = {}) => ({
  id: over.id || 'fixture',
  answer,
  frames: [],
  latencyMs: 1,
  error: null,
  ...over,
});

const loadEvaluatorSource = (source) => {
  const module = { exports: {} };
  const localRequire = (request) => require(join(__dirname, request));
  new Function('require', 'module', 'exports', source)(localRequire, module, module.exports);
  return module.exports;
};

const readLiveSummaryAnswer = () => {
  if (!existsSync(LIVE_ARTIFACT_PATH)) return LIVE_SUMMARY_ANSWER;
  const bytes = readFileSync(LIVE_ARTIFACT_PATH);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), LIVE_ARTIFACT_SHA256,
    'the pinned live artifact must not drift');
  const report = JSON.parse(bytes.toString('utf8'));
  const answer = report.observations?.[0]?.answer;
  assert.equal(answer, LIVE_SUMMARY_ANSWER, 'the pinned report must contain the exact live answer');
  return answer;
};

const liveSummaryAnswer = readLiveSummaryAnswer();
const parentEvaluator = loadEvaluatorSource(
  execFileSync('git', ['show', `${PARENT_SHA}:backend/lib/evaluation.js`], {
    cwd: join(__dirname, '..', '..'),
    encoding: 'utf8',
  }).replace(/\r\n/g, '\n'),
);

test('the persisted live summary reproduces the parent red state and passes after repair', () => {
  assert.deepEqual(parentEvaluator.summarySemantics(liveSummaryAnswer), {
    failureRetryRelation: true,
    leaseOwnership: false,
    reclaimAfterExpiry: false,
  });
  assert.equal(parentEvaluator.hasSummarySemantics(liveSummaryAnswer), false,
    'the exact live answer must fail the parent matcher');
  assert.deepEqual(summarySemantics(liveSummaryAnswer), {
    failureRetryRelation: true,
    leaseOwnership: true,
    reclaimAfterExpiry: true,
  });

  const testCase = v2.cases.find(({ id }) => id === 'user-text-summary-v2');
  const grade = gradeCase(testCase, observation(liveSummaryAnswer, { id: testCase.id }));
  const summaryCheck = grade.checks.find(({ name }) => name === 'mustPreserveSummary');
  assert.equal(summaryCheck.ok, true, summaryCheck.detail);
  assert.equal(grade.passed, true, grade.failures.join('|'));
});

test('the summary matcher accepts at least sixteen relational paraphrases', () => {
  const positiveParaphrases = [
    liveSummaryAnswer,
    'A worker retries a failed task after a delay. A lease prevents multiple workers from owning the same task. Once the lease has expired, another worker can reclaim the task.',
    'Workers retry failed jobs; a lease ensures only one worker owns a job; when the lease expires, another worker reclaims the job.',
    'A failed job is retried by its worker. A lease prevents two workers from owning the same job. If the lease has expired, a different worker may reclaim it.',
    'A job that fails is retried by the worker after a pause. A lease prevents duplicate ownership; after the lease expires another worker may reclaim the job.',
    'Jobs that fail get retried by workers after a delay. Leases ensure exclusive ownership until expiry, after which another worker can reclaim them.',
    'When a task fails, its worker retries the task. A lease limits two workers from owning the same task, and once it expires a new worker can reclaim the task.',
    'A failed task is retried by a worker. A lease ensures one worker owns the task, and after the lease expires another worker may reclaim it.',
    'Workers retry jobs that failed. A lease stops two workers from owning the same job. If the lease expires, a new worker can reclaim it.',
    'The worker retries a failed job. A lease ensures exclusive ownership of the job, and after it expires a different worker may reclaim it.',
    'A worker retries a failed job. A lease ensures that only one worker can hold the job at any time. When the lease expires, another worker can safely take over the job.',
    'A worker retries failed jobs. The lease lets a single worker hold the job. After lease expiry, another worker may take over.',
    "The worker retries a failed task. While the lease is active, the task remains under one worker's control. Once the lease expires, a different worker can assume control of the task.",
    'Workers retry failed jobs. A lease keeps the job with only one worker. After expiration, a new worker can pick up the job.',
    'A failed job is retried by a worker. The active lease grants one worker exclusive possession of the job. Another worker may safely claim the job after the lease has expired.',
    "When a task fails, its worker retries it; the lease ensures that only one worker retains control of the task, and following lease expiration another worker can resume control.",
  ];
  assert.equal(positiveParaphrases.length, 16);
  for (const answer of positiveParaphrases) {
    assert.equal(hasSummarySemantics(answer), true, JSON.stringify({ answer, semantics: summarySemantics(answer) }));
  }
});

test('the summary matcher rejects at least twenty relational adversarial negatives', () => {
  const adversarialNegatives = [
    ['failure without retry relationship', 'The job failed, but the worker logged the incident. A lease prevents two workers from owning the job. If the lease expires, another worker reclaims it.'],
    ['retry without failure relationship', 'The worker retries healthy jobs after a delay. A lease prevents two workers from owning the job. If the lease expires, another worker reclaims it.'],
    ['lease without ownership relation', 'A lease has a duration, but ownership is assigned by a separate system. A worker retries a failed job. If the lease expires, another worker reclaims it.'],
    ['exclusivity without lease', 'A worker has exclusive ownership of a job and retries failed jobs. After expiry another worker reclaims the job.'],
    ['reclaim without expiry', 'A worker retries a failed job. A lease prevents two workers from owning the same job. Another worker reclaims it.'],
    ['expiry without reclaim', 'A worker retries a failed job. A lease prevents two workers from owning the same job, and the lease expires. Ownership is released.'],
    ['irrelevant retry and failure', 'A worker retries a failed email while the job lease protects ownership. When the lease expires, another worker reclaims the job.'],
    ['keyword stuffing in separate statements', 'Retry logic exists. Failure reporting exists. Lease exists. Worker exists. Reclaim happens after expiry.'],
    ['negated ownership semantics', 'A worker retries a failed job, but a lease does not prevent workers from owning the same job. If the lease expires, another worker reclaims it.'],
    ['negated retry semantics', 'A worker does not retry a failed job. A lease prevents two workers from owning the same job. If the lease expires, another worker reclaims it.'],
    ['reversed reclaim timing', 'A worker retries a failed job. Another worker reclaims the job before the lease expires.'],
    ['substring traps', 'A leaseholder owns the job; a retrial and a failure report are unrelated words, and reclamation is discussed without expiry.'],
    ['ownership discussion only', 'A worker retries a failed job. A lease discusses ownership. If the lease expires, another worker reclaims the job.'],
    ['multiple simultaneous owners', 'A worker retries a failed job. A lease can coexist with multiple simultaneous owners. If the lease expires, another worker reclaims the job.'],
    ['negated exclusive ownership', 'A worker retries a failed job. The lease does not guarantee exclusive ownership. If the lease expires, another worker reclaims the job.'],
    ['ownership keyword salad', 'Retry failure lease worker ownership reclaim expiry discussed gives guarantees exclusive same job multiple owners.'],
    ['several workers can hold', 'A worker retries a failed job. A lease lets several workers hold the same job simultaneously. If the lease expires, another worker reclaims the job.'],
    ['negated hold exclusivity', 'A worker retries a failed job. A lease does not ensure that only one worker holds the job. If the lease expires, another worker reclaims the job.'],
    ['all workers can hold', 'A worker retries a failed job. Workers can all hold the job while the lease is active. If the lease expires, another worker reclaims the job.'],
    ['associated words only', 'A worker retries a failed job. A lease is associated with a worker and a job. If the lease expires, another worker reclaims the job.'],
    ['worker holds lease only', 'A worker retries a failed job. The worker holds a lease. If the lease expires, another worker reclaims the job.'],
    ['meeting is not job possession', 'A worker retries a failed job. A lease ensures that only one worker can hold a meeting about the job. If the lease expires, another worker reclaims the job.'],
    ['negated takeover', 'A worker retries a failed job. When the lease expires, another worker cannot take over the job.'],
  ];
  assert.equal(adversarialNegatives.length, 23);
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

test('photosynthesis factuality rejects broad light-energy claims and wrong-pigment claims', () => {
  const photosynthesis = v2.cases.find(({ id }) => id === 'simple-explanation-photosynthesis');
  const falseClaims = [
    'Photosynthesis is the process by which plants convert light energy into chemical energy stored as sugar.',
    'Photosynthesis: plants use melanin to capture light energy, and chlorophyll plays no role at all.',
    'Plants use melanin rather than chlorophyll to capture light energy.',
    'Chlorophyll is unrelated to photosynthesis.',
    'Plants do not use chlorophyll during photosynthesis.',
    'Chlorophyll plays no role in photosynthesis.',
    'Plants use melanin instead of chlorophyll to capture light.',
    'Photosynthesis does not use chlorophyll.',
    'Chlorophyll prevents plants from using light energy.',
  ];
  assert.equal(falseClaims.length, 9);
  for (const answer of falseClaims) {
    const result = gradeCase(photosynthesis, observation(answer, { id: photosynthesis.id }));
    assert.equal(result.factuality.passed, false, answer);
  }
});

test('idempotency factuality requires a meaningful repeat/effect/no-duplicate relation', () => {
  const idempotency = v2.cases.find(({ id }) => id === 'timeless-definition-idempotency');
  const trueParaphrases = [
    factualityAnswers[idempotency.id],
    'Repeating an idempotent API request leaves the system in the same state and does not add a duplicate side effect.',
    'Idempotency means performing an operation again produces the same result without creating an additional effect.',
    'An idempotent operation gives the same result when repeated, with no extra duplicate effect.',
  ];
  for (const answer of trueParaphrases) {
    assert.equal(gradeCase(idempotency, observation(answer, { id: idempotency.id })).factuality.passed, true, answer);
  }

  const falseClaims = [
    'idempotent idempotency request operation api same effect unchanged without duplicate repeat again',
    'Repeated idempotent requests create duplicate effects.',
    'An idempotent operation creates another side effect every time.',
    'Retries of an idempotent request add an additional effect.',
    'Idempotency means the same request creates duplicates on repetition.',
    'An idempotent API behaves differently each time it is repeated.',
    'Idempotency means retries always add another side effect.',
  ];
  for (const answer of falseClaims) {
    assert.equal(gradeCase(idempotency, observation(answer, { id: idempotency.id })).factuality.passed, false, answer);
  }
});

test('micro-hardening red-first controls cover valid idempotency, ownership, and subject-order phrasing', () => {
  const idempotency = v2.cases.find(({ id }) => id === 'timeless-definition-idempotency');
  const idempotencyParaphrases = [
    'Repeating an idempotent request produces the same result and never creates an additional side effect.',
    'An idempotent operation does not create another side effect when repeated.',
    'Retries leave the same state without creating duplicate effects.',
    'Repeating an idempotent API request has the same effect and will not create an additional operation.',
  ];
  for (const answer of idempotencyParaphrases) {
    assert.equal(gradeCase(idempotency, observation(answer, { id: idempotency.id })).factuality.passed, true, answer);
  }

  const summary = v2.cases.find(({ id }) => id === 'user-text-summary-v2');
  const ownershipParaphrases = [
    'A lease gives one worker exclusive ownership.',
    'The lease guarantees exclusive ownership until expiry.',
    'A lease grants a single worker ownership of the job.',
    'The lease ensures only one worker owns the job at a time.',
  ].map((ownership) => `A worker retries a failed job. ${ownership} If the lease expires, another worker reclaims the job.`);
  for (const answer of ownershipParaphrases) {
    const grade = gradeCase(summary, observation(answer, { id: summary.id }));
    assert.equal(grade.checks.find(({ name }) => name === 'mustPreserveSummary').ok, true, answer);
  }

  const photosynthesis = v2.cases.find(({ id }) => id === 'simple-explanation-photosynthesis');
  const photosynthesisParaphrases = [
    'Chlorophyll harnesses solar energy during photosynthesis.',
    'During photosynthesis, chlorophyll absorbs light energy.',
    'Chlorophyll captures sunlight for photosynthesis.',
    'Plants use chlorophyll to capture light energy during photosynthesis.',
  ];
  for (const answer of photosynthesisParaphrases) {
    assert.equal(gradeCase(photosynthesis, observation(answer, { id: photosynthesis.id })).factuality.passed, true, answer);
  }
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

test('derived replay diagnostics cannot change the completion grade verdict', () => {
  const testCase = { id: 'completion-diagnostic-fixture', question: 'q', expect: {} };
  const primary = observation('The answer is complete.', {
    id: testCase.id,
    provenance: { completion: { qualified: 'complete' } },
  });
  const withDiagnostics = {
    ...primary,
    diagnostics: {
      answerLength: 24,
      answerHash: 'bounded-digest',
      completion: { status: 'incomplete', fields: ['diagnostics.completion.status'] },
      execution: { completion: { qualified: 'incomplete' } },
    },
  };
  const withoutDiagnostics = { ...primary };
  const plainGrade = gradeCase(testCase, withoutDiagnostics);
  const diagnosticGrade = gradeCase(testCase, withDiagnostics);
  assert.equal(inspectCompletionMetadata(withDiagnostics).status, 'complete');
  assert.deepEqual(diagnosticGrade.checks, plainGrade.checks);
  assert.equal(diagnosticGrade.passed, plainGrade.passed);
  assert.equal(diagnosticGrade.checks.find(({ name }) => name === 'completeness').ok, true);
});

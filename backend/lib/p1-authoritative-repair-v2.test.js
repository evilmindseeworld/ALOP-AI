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

const hasRequiredRelationBehavior = (result, property, item) => {
  const records = result.relationRecords || [];
  const spansAreBounded = (record, span) => Number.isInteger(span?.start)
    && Number.isInteger(span?.end)
    && span.start >= record.evidenceSpan.start
    && span.end <= record.evidenceSpan.end
    && span.end > span.start;
  if (property === 'useDirectObject=CHLOROPHYLL') return records.some((record) => record.verbLemma === 'use'
    && record.directObject?.role === 'CHLOROPHYLL');
  if (property === 'targetPolarity=AFFIRMED') return records.some((record) => record.polarity === 'AFFIRMED' && record.qualifies);
  if (/^(grammarShape|subjectValidity|polarity)=/.test(property)) {
    const [field, expected] = property.split('=');
    return records.some((record) => String(record[field]) === expected);
  }
  if (property === 'localByAgentSpan' || property === 'local agent span') {
    return records.some((record) => record.voice === 'PASSIVE'
      && record.lightObject?.binding === 'PASSIVE_SUBJECT'
      && record.subjectSet?.lemma === 'chlorophyll'
      && record.lightObject.start >= record.evidenceSpan.start
      && record.lightObject.end <= record.evidenceSpan.end);
  }
  if (property === 'twoRelationRecords') return records.length === 2;
  if (property === 'embeddedTargetQualifies') return records.some((record) => record.relationType === 'CORE_LIGHT_RELATION' && record.qualifies);
  if (property === 'twoPredicateRecords') return records.length === 2 && records[0].verbLemma !== records[1].verbLemma;
  if (property === 'oneSharedObjectSpan') return records.length === 2
    && records[0].lightObject?.start === records[1].lightObject?.start
    && records[0].lightObject?.end === records[1].lightObject?.end;
  if (property === 'orderedSubjectSet') return (result.coordinationTopology || []).some((group) => group.cardinality > 1);
  if (property === 'modalPreserved') return records.some((record) => record.modal != null);
  if (property === 'unrelatedNegationIgnored' || property === 'unrelated negation ignored') return item.text
    && /\b(?:do|does|did) not\b/i.test(item.text)
    && result.passed === true
    && records.some((record) => record.qualifies && record.polarity === 'AFFIRMED')
    && records.every((record) => record.qualifies || record.polarity !== 'NEGATED');
  if (property === 'SANCTIONED_NOT_FAIL_TO') return records.some((record) => record.controlChain?.type === 'NOT_FAIL_TO'
    && record.polarity === 'AFFIRMED' && record.qualifies);
  if (property === 'controlChain') return records.some((record) => record.controlChain !== null);
  if (property === 'polarityReason') return records.some((record) => Boolean(record.polarityReason));
  if (property === 'antecedentIdOrAmbiguous') return records.some((record) => record.lightObject?.binding === 'PRONOUN_ANTECEDENT'
    || record.rejectionReasons?.some((reason) => /AMBIGUOUS.*ANTECEDENT/.test(reason)));
  if (property === 'noDistantBinding') {
    const bindings = records.filter((record) => record.lightObject?.binding === 'PRONOUN_ANTECEDENT');
    return bindings.length > 0 && bindings.every((record) => record.lightObject.start >= record.evidenceSpan.start
      && record.lightObject.end <= record.evidenceSpan.end);
  }
  if (property === 'contradictionPairIds') return (result.contradictions || []).some((pair) => Array.isArray(pair.pairIds) && pair.pairIds.length === 2);
  if (property === 'DIRECT_OBJECT') return records.some((record) => record.directObject
    && spansAreBounded(record, record.directObject));
  if (property === 'SEPARATE_PROPOSITION') return result.passed === false
    && records.some((record) => record.directObject?.role === 'NON_LIGHT_OBJECT'
      && record.lightObject == null && !record.qualifies
      && spansAreBounded(record, record.directObject)
      && record.directObject.end < item.text.toLowerCase().indexOf('light'));
  if (property === 'FINITE_PREDICATE') return records.some((record) => record.objectBarriers?.type === 'CLAUSE');
  if (property === 'CLAUSE') return (result.topology || []).length > (result.sentences || []).length
    || records.some((record) => record.objectBarriers?.type === 'CLAUSE');
  if (property === 'SENTENCE') return (result.sentences || []).length > 1;
  if (property === 'GRAMMAR_SHAPE_NOT_ACCEPTED') return result.hasMalformed === true
    || records.some((record) => record.rejectionReasons?.includes(property));
  if (property === 'localNegationSpan') return records.some((record) => record.polarity === 'NEGATED'
    && record.polarityReason === 'LOCAL_NEGATION'
    && spansAreBounded(record, { start: record.predicateStart, end: record.predicateEnd }));
  if (property === 'LIGHT_OBJECT_MISSING') return records.some((record) => record.directObject?.role === 'NON_LIGHT_OBJECT'
    && record.lightObject == null && !record.qualifies);
  if (property === 'unique local light-object antecedent') return records.some((record) => record.lightObject?.binding === 'PRONOUN_ANTECEDENT'
    && record.lightObject.start >= record.evidenceSpan.start && record.lightObject.end <= record.evidenceSpan.end);
  if (property === 'pronoun resolves to carbon dioxide') return result.passed === false
    && records.some((record) => record.directObject?.normalized === 'carbon dioxide'
      && record.lightObject?.binding !== 'PRONOUN_ANTECEDENT' && !record.qualifies);
  if (property === 'complete first-sentence active relation independently qualifies') {
    const firstSentence = (result.sentences || [])[0]?.text;
    return Boolean(firstSentence) && records.some((record) => record.qualifies
      && record.evidenceSpan?.text === firstSentence);
  }
  if (property === 'independent second proposition') {
    return (result.topology || []).length > (result.sentences || []).length
      && records.some((record) => record.qualifies
        && item.text.toLowerCase().endsWith(record.evidenceSpan?.text?.toLowerCase() || '\u0000'));
  }
  if (property === 'CONTRADICTION_PRESENT') return (result.contradictions || []).length > 0;
  if (property === 'WRONG_PIGMENT_RELATION') return (result.invalidChlorophyllClaims || []).some((record) =>
    record.relationType === 'WRONG_PIGMENT_RELATION' && record.polarity === 'AFFIRMED');
  if (property === 'NO_CROSS_BOUNDARY_STITCHING') return result.passed === false
    && (result.topology || []).length > 1
    && records.some((record) => {
      const relationSpansStayLocal = spansAreBounded(record, record.subjectSet)
        && spansAreBounded(record, record.directObject)
        && (!record.lightObject || spansAreBounded(record, record.lightObject));
      return relationSpansStayLocal
        && !/[;:]/.test(record.evidenceSpan?.text || '')
        && !records.some((other) => other.qualifies && other.lightObject?.binding === 'PRONOUN_ANTECEDENT');
    })
    && !records.some((record) => record.qualifies && record.lightObject?.binding === 'PRONOUN_ANTECEDENT');
  return records.some((record) => record.grammarShape === property
    || record.subjectValidity === property
    || record.polarity === property
    || record.polarityReason === property
    || record.controlChain?.type === property
    || record.lightObject?.binding === property
    || record.auxiliaryChain?.function === property
    || record.relationType === property
    || record.rejectionReasons?.includes(property))
    || (result.contradictions || []).length > 0 && property === 'CONTRADICTION_PRESENT'
    || (result.invalidChlorophyllClaims || []).length > 0 && property === 'WRONG_PIGMENT_RELATION';
};

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

test('photosynthesis factuality does not join chlorophyll and light across sentences', () => {
  const photosynthesis = v2.cases.find(({ id }) => id === 'simple-explanation-photosynthesis');
  const crossSentenceClaim = 'Photosynthesis converts light energy into sugar. Chlorophyll is a pigment found in plants.';
  const result = gradeCase(photosynthesis, observation(crossSentenceClaim, { id: photosynthesis.id }));
  assert.equal(result.factuality.passed, false,
    'separate sentences must not be stitched into a chlorophyll/light relation');
});

test('V2 composition keeps local chlorophyll denials invalid beside a valid positive claim', () => {
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  const compositions = [
    ['Photosynthesis captures light energy. Chlorophyll does not capture light energy during photosynthesis.', 'Photosynthesis captures light energy.'],
    ['Chlorophyll does not capture light energy during photosynthesis. Photosynthesis captures light energy.', 'Photosynthesis captures light energy.'],
    ['Photosynthesis captures light energy. Light energy is not captured by chlorophyll during photosynthesis.', 'Photosynthesis captures light energy.'],
    ['Light energy is not captured by chlorophyll during photosynthesis. Photosynthesis captures light energy.', 'Photosynthesis captures light energy.'],
    ['Photosynthesis captures light energy. Chlorophyll never captures light energy during photosynthesis.', 'Photosynthesis captures light energy.'],
  ];

  for (const [answer, positiveSentence] of compositions) {
    const result = evaluatePhotosynthesisRelationsV2(answer);
    const denied = result.relationRecords.find(({ subjectSet, polarity, lightObject }) =>
      subjectSet?.role === 'PIGMENT_AGENT' && subjectSet?.lemma === 'chlorophyll'
      && polarity === 'NEGATED' && lightObject?.normalized === 'light-energy');
    assert.ok(denied, answer);
    assert.equal(denied.polarityReason, 'LOCAL_NEGATION', answer);
    assert.ok(result.relationRecords.some(({ qualifies, evidenceSpan }) =>
      qualifies && evidenceSpan?.text === positiveSentence.toLowerCase()), answer);
    assert.ok(result.invalidChlorophyllClaims.some(({ evidenceSpan, polarity, polarityReason }) =>
      evidenceSpan?.text === denied.evidenceSpan?.text && polarity === 'NEGATED' && polarityReason === 'LOCAL_NEGATION'), answer);
    assert.equal(result.passed, false, answer);
  }
});

test('backend-intelligence-v2 dataset seam rejects composed chlorophyll denial factuality', () => {
  const photosynthesis = v2.cases.find(({ id }) => id === 'simple-explanation-photosynthesis');
  const answer = 'Photosynthesis captures light energy. Chlorophyll does not capture light energy during photosynthesis.';
  const grade = gradeCase(photosynthesis, observation(answer, { id: photosynthesis.id }));
  assert.equal(grade.factuality.evaluatorId, 'photosynthesis-light-relation-v2');
  assert.equal(grade.factuality.passed, false, grade.factuality.failures.join('|'));
  assert.ok(grade.factuality.relationRecords.some(({ subjectSet, polarity, polarityReason }) =>
    subjectSet?.role === 'PIGMENT_AGENT' && subjectSet?.lemma === 'chlorophyll'
    && polarity === 'NEGATED' && polarityReason === 'LOCAL_NEGATION'));
});

test('photosynthesis factuality accepts the pinned live two-sentence explanation', () => {
  const photosynthesis = v2.cases.find(({ id }) => id === 'simple-explanation-photosynthesis');
  const liveAnswer = 'Photosynthesis is the process by which green plants, algae, and some bacteria convert light energy into chemical energy, storing it in glucose molecules. It uses carbon dioxide and water, releasing oxygen as a byproduct, and is driven by chlorophyll in the presence of sunlight.';
  const result = gradeCase(photosynthesis, observation(liveAnswer, { id: photosynthesis.id }));
  assert.equal(result.factuality.passed, true, result.factuality.failures.join('|'));
});

test('photosynthesis evaluator integration uses the approved semantic evaluator', () => {
  const result = gradeCase({
    id: 'photosynthesis-evaluator-integration',
    question: 'Explain photosynthesis.',
    factualityChecks: {
      modelInvolved: true,
      evaluatorId: 'photosynthesis-light-relation-v1',
      stableWhy: 'The relation is a stable biology fact.',
      assertions: [{
        id: 'photosynthesis-relation',
        claim: 'Plants use chlorophyll to capture light energy.',
        patterns: ['photosynthesis'],
        forbiddenPatterns: [],
      }],
    },
    expect: {},
  }, observation('Photosynthesis uses melanin to capture light energy; chlorophyll plays no role.', {
    id: 'photosynthesis-evaluator-integration',
  }));
  assert.equal(result.factuality.passed, false,
    'the evaluator integration must reject the semantically false answer');
});

test('backend-intelligence-v2 grades photosynthesis through V2 while retaining the V1 route', () => {
  const historicalV1 = v1.cases.find(({ id }) => id === 'simple-explanation-photosynthesis');
  const currentV2 = v2.cases.find(({ id }) => id === 'simple-explanation-photosynthesis');
  assert.equal(historicalV1.factualityChecks, undefined);
  assert.equal(currentV2.factualityChecks.evaluatorId, 'photosynthesis-light-relation-v2');

  const grade = gradeCase(currentV2, observation(factualityAnswers[currentV2.id], { id: currentV2.id }));
  assert.equal(grade.factuality.evaluatorId, 'photosynthesis-light-relation-v2');
  assert.equal(grade.factuality.passed, true, grade.factuality.failures.join('|'));
  assert.ok(grade.factuality.relationRecords.length > 0);
  assert.ok(grade.factuality.relationRecords.every(({ evaluatorId }) => evaluatorId === 'photosynthesis-light-relation-v2'));
});

test('photosynthesis factuality requires a positive light-energy relation before chlorophyll drives the process', () => {
  const photosynthesis = v2.cases.find(({ id }) => id === 'simple-explanation-photosynthesis');
  const falseClaims = [
    'Photosynthesis destroys light energy. It is driven by chlorophyll.',
    'Photosynthesis wastes light energy. This process is powered by chlorophyll.',
    'Photosynthesis ignores light energy completely. It is powered by chlorophyll.',
    'Photosynthesis loses light energy. It is driven by chlorophyll.',
    'Photosynthesis blocks light energy. This process is powered by chlorophyll.',
    'Photosynthesis rejects light energy. It is driven by chlorophyll.',
    'Photosynthesis eliminates light energy. This process is powered by chlorophyll.',
    'Photosynthesis removes light energy. It is driven by chlorophyll.',
  ];
  assert.equal(falseClaims.length, 8);
  for (const answer of falseClaims) {
    const result = gradeCase(photosynthesis, observation(answer, { id: photosynthesis.id }));
    assert.equal(result.factuality.passed, false, answer);
  }
});

test('focused factuality repairs cover optional chlorophyll detail and negated melanin substitution', () => {
  const photosynthesis = v2.cases.find(({ id }) => id === 'simple-explanation-photosynthesis');
  const evidenceAnswer = 'Photosynthesis is how plants use chlorophyll to capture light energy and make food.';
  assert.equal(gradeCase(photosynthesis, observation(evidenceAnswer, { id: photosynthesis.id })).factuality.passed, true);

  const falseControl = 'Photosynthesis uses melanin, not chlorophyll, to capture light energy.';
  assert.equal(gradeCase(photosynthesis, observation(falseControl, { id: photosynthesis.id })).factuality.passed, false);
});

test('photosynthesis factuality rejects expanded-pattern explicit negations', () => {
  const photosynthesis = v2.cases.find(({ id }) => id === 'simple-explanation-photosynthesis');
  const falseClaims = [
    'Photosynthesis does not capture light energy with chlorophyll.',
    'Photosynthesis never uses chlorophyll to harness sunlight.',
    'Photosynthesis is not driven by chlorophyll, but it captures light energy.',
    'Photosynthesis cannot use chlorophyll to capture light energy.',
    'Photosynthesis uses chlorophyll to not capture light energy.',
  ];
  for (const answer of falseClaims) {
    assert.equal(gradeCase(photosynthesis, observation(answer, { id: photosynthesis.id })).factuality.passed, false, answer);
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

test('idempotency factuality recognizes repeated-operation and no-additional-side-effects wording', () => {
  const idempotency = v2.cases.find(({ id }) => id === 'timeless-definition-idempotency');
  const evidenceAnswer = 'Idempotency means that performing the same operation multiple times yields the same result as performing it once, with no additional side effects.';
  assert.equal(gradeCase(idempotency, observation(evidenceAnswer, { id: idempotency.id })).factuality.passed, true);
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

const baselineCallableAdversarialCases = require('./photosynthesis-relation-cases').canonicalCases
  .filter(({ id }) => /^ADV00[1-6]$/.test(id));
for (const item of baselineCallableAdversarialCases) {
  test(`baseline-callable ${item.id} fails by behavior, not by import`, () => {
    const evaluators = require('./photosynthesis-relation-evaluator');
    const evaluate = evaluators.evaluatePhotosynthesisRelationsV2 || evaluators.evaluatePhotosynthesisRelations;
    const result = evaluate(item.text);
    assert.equal(typeof result.passed, 'boolean', `${item.id} must reach an evaluator decision`);
    assert.equal(result.passed ? 'PASS' : 'FAIL', item.expectedDecision, item.id);
  });
}

test('frozen V2 corpus module loads without any evaluator dependency', () => {
  const source = readFileSync(join(__dirname, 'photosynthesis-relation-cases.js'), 'utf8');
  const isolated = { exports: {} };
  new Function('require', 'module', 'exports', source)(() => {
    throw new Error('the frozen corpus must not load production evaluator code');
  }, isolated, isolated.exports);
  assert.equal(isolated.exports.canonicalCases.length, 54);
  assert.equal(isolated.exports.generatedV2Cases.length, isolated.exports.EXPECTED_V2_GENERATED_CASE_COUNT);
});

test('V2 corpus identity and expected membership are frozen independently of implementation', () => {
  const { canonicalCases, generatedV2Cases, b5SemanticSupplementCases } = require('./photosynthesis-relation-cases');
  const stableFields = (item) => [
    item.id,
    item.text,
    item.expectedDecision,
    item.expectedPolarity ?? null,
    [...(item.classIds || [])].sort(),
    [...(item.parameterDimensions || [])].sort(),
    [...(item.requiredDiagnostics || [])].sort(),
  ];
  const corpus = [...canonicalCases, ...generatedV2Cases]
    .map(stableFields)
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId));
  const identity = createHash('sha256').update(JSON.stringify(corpus)).digest('hex');
  assert.equal(identity, '4e5d0b50f3d1f3da65d3cbd8f28630d418d749e20221c28006edcaddae7ef9df');
  assert.deepEqual(b5SemanticSupplementCases.map(stableFields), [[
    'B5-PUNCTUATION_ABUSE-001',
    'Photosynthesis captures carbon dioxide!?! Light energy exists.',
    'FAIL',
    null,
    ['PUNCTUATION_ABUSE'],
    ['PU'],
    [],
  ]]);
});

test('the frozen test-class contract is fully executable', () => {
  const { requiredTestClasses } = require('./photosynthesis-relation-cases');
  const contract = [
    ['AFFIRMATIVE_ACTIVE', 8], ['AFFIRMATIVE_PASSIVE', 6], ['INFINITIVAL_CHLOROPHYLL_MEDIATED', 6],
    ['COORDINATED_PREDICATES', 6], ['COORDINATED_SUBJECTS_VALID', 6], ['COORDINATED_SUBJECTS_MIXED_INVALID', 8],
    ['DETACHED_OBJECT_DECOYS', 8], ['DIRECT_OBJECT_BARRIERS', 6], ['FINITE_PREDICATE_BARRIERS', 6],
    ['MALFORMED_SYNTAX', 9], ['LOCAL_NEGATION', 8], ['UNCERTAIN_MODALITY', 12], ['NEGATED_MODALITY', 8],
    ['AFFIRMED_MODALITY', 4], ['NESTED_CONTROL', 10], ['DOUBLE_NEGATION', 6], ['UNRELATED_NEGATION', 6],
    ['CLAUSE_BOUNDARY', 8], ['SENTENCE_BOUNDARY', 6], ['PRONOUN_CONTINUATION', 6], ['INVALID_SUBJECT', 8],
    ['INVALID_OBJECT', 8], ['DESTRUCTIVE_RELATION', 6], ['WRONG_PIGMENT', 6], ['CONTRADICTION', 6],
    ['PUNCTUATION_ABUSE', 8], ['NO_STITCHING', 8], ['KNOWN_REGRESSIONS', 8],
  ];
  assert.deepEqual(requiredTestClasses.map(({ classId, minimumUniqueSemanticCases }) => [classId, minimumUniqueSemanticCases]), contract);
});

test('frozen V2 canonical bytes, decisions, polarity, and diagnostics', () => {
  const { canonicalCases } = require('./photosynthesis-relation-cases');
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  assert.equal(canonicalCases.length, 54);
  for (const item of canonicalCases) {
    const result = evaluatePhotosynthesisRelationsV2(item.text);
    assert.equal(result.passed ? 'PASS' : 'FAIL', item.expectedDecision, item.id);
    assert.equal(result.polarity, item.expectedPolarity, item.id);
    for (const property of item.requiredDiagnostics) {
      assert.ok(hasRequiredRelationBehavior(result, property, item), `${item.id}: ${property}`);
    }
  }
});

test('V2 accepts the frozen positive local pronoun continuation', () => {
  const { generatedV2Cases } = require('./photosynthesis-relation-cases');
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  const item = generatedV2Cases.find(({ id }) => id === 'V2-PRONOUN_CONTINUATION-002');
  assert.ok(item);
  assert.equal(item.text, 'Photosynthesis captures light energy and absorbs it.');
  assert.equal(item.expectedDecision, 'PASS');
  const result = evaluatePhotosynthesisRelationsV2(item.text);
  const record = result.relationRecords.find(({ grammarShape }) => grammarShape === 'PRONOUN_CONTINUATION');
  assert.equal(result.passed, true);
  assert.equal(record?.polarity, 'AFFIRMED');
  assert.equal(record?.qualifies, true);
  assert.equal(record?.lightObject?.binding, 'PRONOUN_ANTECEDENT');
  assert.equal(record?.rejectionReasons.includes('GRAMMAR_SHAPE_NOT_ACCEPTED'), false);
});

test('V2 rejects malformed active predicate forms and enforces coordinated-subject agreement', () => {
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  const invalid = [
    'Plants captures light energy.',
    'Photosynthesis capturing light energy.',
    'Photosynthesis are captures light energy.',
    'Plants and algae captures light energy.',
    'Photosynthesis captures light energy and absorb it.',
    'Plants capture light energy and captures it.',
    'Plants capture and captures light energy.',
  ];
  for (const text of invalid) {
    const result = evaluatePhotosynthesisRelationsV2(text);
    assert.equal(result.passed, false, text);
    assert.ok(result.diagnostics.includes('GRAMMAR_SHAPE_NOT_ACCEPTED'), text);
  }
  const valid = [
    'Plants capture light energy.',
    'Photosynthesis captures light energy.',
    'Plants and algae capture light energy.',
    'Plants capture and absorb light energy.',
    'Photosynthesis captures and absorbs light energy.',
  ];
  for (const text of valid) assert.equal(evaluatePhotosynthesisRelationsV2(text).passed, true, text);
});

test('V2 emits every coordinated subject and is reachable through its semantic registry', () => {
  const {
    V2_ID,
    PHOTOSYNTHESIS_SEMANTIC_EVALUATOR_REGISTRY,
    evaluatePhotosynthesisRelationsV2,
  } = require('./photosynthesis-relation-evaluator');
  const input = 'Plants and algae capture light energy.';
  const result = evaluatePhotosynthesisRelationsV2(input);
  assert.deepEqual(result.relationRecords.map(({ subjectSet }) => subjectSet.lemma), ['plant', 'algae']);
  const passive = evaluatePhotosynthesisRelationsV2('Light energy is captured by chlorophyll and chlorophyll during photosynthesis.');
  assert.deepEqual(passive.relationRecords.map(({ subjectSet }) => subjectSet.lemma), ['chlorophyll', 'chlorophyll']);
  assert.equal(passive.relationRecords[0].auxiliaryChain.function, 'BE');
  assert.equal(PHOTOSYNTHESIS_SEMANTIC_EVALUATOR_REGISTRY[V2_ID], evaluatePhotosynthesisRelationsV2);
  assert.equal(PHOTOSYNTHESIS_SEMANTIC_EVALUATOR_REGISTRY[V2_ID](input).passed, true);
});

test('V2 rejects unsupported OR and comma-only subject coordination', () => {
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  const unsupported = [
    { text: 'Plants or algae capture light energy.', polarity: 'UNRESOLVED' },
    { text: 'Plants, algae capture light energy.', polarity: 'AFFIRMED' },
    { text: 'Plants, algae, and animals capture light energy.', polarity: 'MIXED_INVALID' },
  ];
  for (const item of unsupported) {
    const result = evaluatePhotosynthesisRelationsV2(item.text);
    assert.equal(result.passed, false, item.text);
    assert.equal(result.polarity, item.polarity, item.text);
    assert.ok(result.diagnostics.includes('UNSUPPORTED_CO_SUBJECT'), item.text);
  }
  const supported = [
    'Plants and algae capture light energy.',
    'Plants, algae, and some bacteria capture light energy.',
  ];
  for (const text of supported) assert.equal(evaluatePhotosynthesisRelationsV2(text).passed, true, text);
});

test('V2 passive grammar composes polarity, modality, destructive meaning, agents, and auxiliaries', () => {
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  const rejected = [
    {
      text: 'Light energy is not captured by chlorophyll during photosynthesis.',
      chain: ['is', 'not'],
      polarity: 'NEGATED',
      reason: 'LOCAL_NEGATION',
    },
    {
      text: "Light energy can't be captured by chlorophyll during photosynthesis.",
      chain: ["can't", 'be'],
      polarity: 'NEGATED',
      reason: 'ASSERTED_INABILITY',
      modal: 'cannot',
    },
    {
      text: 'Light energy may be captured by chlorophyll during photosynthesis.',
      chain: ['may', 'be'],
      polarity: 'UNCERTAIN',
      reason: 'POSSIBILITY',
      modal: 'may',
    },
    {
      text: 'Light energy must may be captured by chlorophyll during photosynthesis.',
      chain: ['must', 'may', 'be'],
      polarity: 'UNRESOLVED',
      reason: 'STACKED_MODAL_CHAIN',
      modal: null,
    },
    {
      text: 'Light energy is destroyed by chlorophyll during photosynthesis.',
      chain: ['is'],
      polarity: 'AFFIRMED',
      reason: 'DIRECT_ASSERTION',
      relationType: 'DESTRUCTIVE_RELATION',
    },
    {
      text: 'Light energy is captured by chlorophyll or green plants during photosynthesis.',
      chain: ['is'],
      polarity: 'AFFIRMED',
      reason: 'DIRECT_ASSERTION',
    },
    {
      text: 'Light energy is captured by chlorophyll, green plants during photosynthesis.',
      chain: ['is'],
      polarity: 'AFFIRMED',
      reason: 'DIRECT_ASSERTION',
    },
  ];
  for (const item of rejected) {
    const result = evaluatePhotosynthesisRelationsV2(item.text);
    const record = result.relationRecords.find(({ grammarShape }) => grammarShape === 'PASSIVE_LOCAL_AGENT');
    assert.equal(result.passed, false, item.text);
    assert.equal(record?.qualifies, false, item.text);
    assert.equal(record?.voice, 'PASSIVE', item.text);
    assert.equal(record?.polarity, item.polarity, item.text);
    assert.equal(record?.polarityReason, item.reason, item.text);
    assert.deepEqual(record?.auxiliaryChain?.chain, item.chain, item.text);
    if (Object.hasOwn(item, 'modal')) assert.equal(record?.modal, item.modal, item.text);
    if (item.relationType) assert.equal(record?.relationType, item.relationType, item.text);
  }

  const supported = [
    'Light energy is captured by chlorophyll during photosynthesis.',
    'Light energy is absorbed by chlorophyll during photosynthesis.',
    'Light energy is harnessed by chlorophyll during photosynthesis.',
    'Light energy is used by chlorophyll during photosynthesis.',
    'Light energy is converted by chlorophyll during photosynthesis.',
    'Light energy is transformed by chlorophyll during photosynthesis.',
    'Light energy was captured by chlorophyll during photosynthesis.',
    'Light energy is being captured by chlorophyll during photosynthesis.',
    'Light energy has been captured by chlorophyll during photosynthesis.',
    'Light energy must be captured by chlorophyll during photosynthesis.',
    'Sunlight is absorbed by chlorophyll during photosynthesis.',
    'Solar energy is captured by chlorophyll during photosynthesis.',
    'Solar light is captured by chlorophyll during photosynthesis.',
    'Light energy is captured by green plants during photosynthesis.',
  ];
  for (const text of supported) {
    const result = evaluatePhotosynthesisRelationsV2(text);
    const record = result.relationRecords.find(({ grammarShape }) => grammarShape === 'PASSIVE_LOCAL_AGENT');
    assert.equal(result.passed, true, text);
    assert.equal(record?.qualifies, true, text);
    assert.equal(record?.voice, 'PASSIVE', text);
    assert.equal(record?.polarity, 'AFFIRMED', text);
  }
});

test('V2 passive grammar rejects malformed auxiliaries, agreement, and bare participles', () => {
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  const rejected = [
    { text: 'Light energy are captured by chlorophyll during photosynthesis.', chain: ['are'] },
    { text: 'Light energy has captured by chlorophyll during photosynthesis.', chain: ['has'] },
    { text: 'Light energy is may be captured by chlorophyll during photosynthesis.', chain: ['is', 'may', 'be'] },
  ];
  for (const item of rejected) {
    const result = evaluatePhotosynthesisRelationsV2(item.text);
    const record = result.relationRecords.find(({ grammarShape }) => grammarShape === 'PASSIVE_LOCAL_AGENT');
    assert.equal(result.passed, false, item.text);
    assert.equal(record?.qualifies, false, item.text);
    assert.deepEqual(record?.auxiliaryChain?.chain, item.chain, item.text);
    assert.ok(record?.rejectionReasons.includes('PASSIVE_AUXILIARY_GRAMMAR_NOT_ACCEPTED'), item.text);
  }

  const bareParticiple = evaluatePhotosynthesisRelationsV2('Light energy captured by chlorophyll during photosynthesis.');
  assert.equal(bareParticiple.passed, false);
});

test('V2 contradiction pairs are order-independent and predicate-specific', () => {
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  const contradictions = [
    {
      text: 'Photosynthesis captures light energy. Photosynthesis does not capture light energy.',
      pairIds: ['relation-0', 'relation-1'],
    },
    {
      text: 'Photosynthesis does not capture light energy. Photosynthesis captures light energy.',
      pairIds: ['relation-1', 'relation-0'],
    },
  ];
  for (const item of contradictions) {
    const result = evaluatePhotosynthesisRelationsV2(item.text);
    assert.equal(result.passed, false, item.text);
    assert.equal(result.contradictions.length, 1, item.text);
    assert.deepEqual(result.contradictions[0].pairIds, item.pairIds, item.text);
  }

  for (const text of [
    'Photosynthesis transforms light energy. Photosynthesis does not capture light energy.',
    'Photosynthesis captures light energy but does not store it.',
  ]) {
    const result = evaluatePhotosynthesisRelationsV2(text);
    assert.equal(result.passed, true, text);
    assert.deepEqual(result.contradictions, [], text);
  }
});

test('V2 asserted wrong-pigment records cannot be hidden by a positive relation', () => {
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  const cases = [
    'Plants capture light energy. Melanin captures light energy.',
    'Melanin captures light energy. Plants capture light energy.',
    'Melanin rather than chlorophyll captures the light for photosynthesis.',
  ];
  for (const text of cases) {
    const result = evaluatePhotosynthesisRelationsV2(text);
    assert.equal(result.passed, false, text);
    assert.ok(result.invalidChlorophyllClaims.some((record) => record.relationType === 'WRONG_PIGMENT_RELATION'), text);
    assert.ok(result.diagnostics.includes('WRONG_PIGMENT_RELATION'), text);
  }
});

test('V2 negated wrong-pigment relations do not fabricate affirmative global polarity', () => {
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  const positiveAndNegatedWrongPigment = evaluatePhotosynthesisRelationsV2(
    'Plants capture light energy. Melanin does not capture light energy.',
  );
  assert.equal(positiveAndNegatedWrongPigment.passed, true);
  assert.deepEqual(positiveAndNegatedWrongPigment.invalidChlorophyllClaims, []);

  const negatedAlternative = evaluatePhotosynthesisRelationsV2(
    'Melanin does not capture light energy rather than chlorophyll.',
  );
  assert.notEqual(negatedAlternative.polarity, 'AFFIRMED');
  assert.equal(negatedAlternative.relationRecords[0]?.polarity, 'NEGATED');
  assert.equal(negatedAlternative.diagnostics.includes('WRONG_PIGMENT_RELATION'), false);
});

test('P1 delta B1 rejects complete malformed active auxiliary and control chains', async (t) => {
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  const cases = [
    'Photosynthesis must is capture light energy.',
    'Photosynthesis must does capture light energy.',
    'Photosynthesis has been been capturing light energy.',
    'Photosynthesis may never fails to capture light energy.',
  ];
  for (const text of cases) await t.test(text, () => {
    const result = evaluatePhotosynthesisRelationsV2(text);
    assert.equal(result.passed, false);
    assert.ok(result.diagnostics.includes('GRAMMAR_SHAPE_NOT_ACCEPTED'));
  });
});

test('P1 delta B2 consumes passive frames and normalizes contracted inability', async (t) => {
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  for (const text of [
    'Light energy is captured near rocks by chlorophyll during photosynthesis.',
    'Carbon dioxide and light energy is captured by chlorophyll during photosynthesis.',
  ]) await t.test(text, () => {
    assert.equal(evaluatePhotosynthesisRelationsV2(text).passed, false);
  });

  const uncontracted = evaluatePhotosynthesisRelationsV2(
    'Light energy could not be captured by chlorophyll during photosynthesis.',
  );
  const contracted = evaluatePhotosynthesisRelationsV2(
    'Light energy couldn’t be captured by chlorophyll during photosynthesis.',
  );
  const passive = (result) => result.relationRecords.find(({ voice }) => voice === 'PASSIVE');
  for (const result of [uncontracted, contracted]) {
    assert.equal(result.passed, false);
    assert.equal(passive(result)?.polarity, 'NEGATED');
    assert.equal(passive(result)?.polarityReason, 'ASSERTED_INABILITY');
    assert.equal(passive(result)?.qualifies, false);
  }
  const semantics = (result) => [passive(result)?.polarity, passive(result)?.polarityReason, passive(result)?.modal];
  assert.deepEqual(semantics(uncontracted), semantics(contracted));
});

test('P1 delta B3 disqualifies asserted passive wrong pigment but preserves negated polarity', () => {
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  const asserted = evaluatePhotosynthesisRelationsV2(
    'Photosynthesis captures light energy. Light energy is captured by melanin during photosynthesis.',
  );
  assert.equal(asserted.passed, false);
  assert.ok(asserted.invalidChlorophyllClaims.some((record) => record.voice === 'PASSIVE'
    && record.relationType === 'WRONG_PIGMENT_RELATION' && record.polarity === 'AFFIRMED'));

  const negated = evaluatePhotosynthesisRelationsV2(
    'Photosynthesis captures light energy. Light energy is not captured by melanin during photosynthesis.',
  );
  const passive = negated.relationRecords.find(({ voice }) => voice === 'PASSIVE');
  assert.equal(negated.passed, true);
  assert.equal(passive?.relationType, 'WRONG_PIGMENT_RELATION');
  assert.equal(passive?.polarity, 'NEGATED');
  assert.equal(negated.invalidChlorophyllClaims.some((record) => record.voice === 'PASSIVE'), false);
});

test('P1 delta B5 fingerprints parsed boundary topology instead of punctuation repetition', () => {
  const { semanticCaseFingerprint } = require('./photosynthesis-relation-evaluator');
  const first = 'Photosynthesis captures carbon dioxide?! Light energy exists.';
  const repeated = 'Photosynthesis captures carbon dioxide?!?! Light energy exists.';
  assert.equal(semanticCaseFingerprint(first), semanticCaseFingerprint(repeated));
  assert.notEqual(
    semanticCaseFingerprint(first),
    semanticCaseFingerprint('Photosynthesis captures carbon dioxide; Light energy exists.'),
    'a clause boundary remains distinct from a sentence boundary',
  );
});

test('P1 delta B6 records active auxiliary chains and fingerprints their semantic distinction', () => {
  const { evaluatePhotosynthesisRelationsV2, semanticCaseFingerprint } = require('./photosynthesis-relation-evaluator');
  const haveText = 'Photosynthesis has captured light energy.';
  const progressiveText = 'Plants are capturing light energy.';
  const simpleText = 'Photosynthesis captured light energy.';
  const have = evaluatePhotosynthesisRelationsV2(haveText).relationRecords[0];
  const progressive = evaluatePhotosynthesisRelationsV2(progressiveText).relationRecords[0];
  const simple = evaluatePhotosynthesisRelationsV2(simpleText).relationRecords[0];

  assert.equal(have.auxiliaryChain?.function, 'HAVE');
  assert.deepEqual(have.auxiliaryChain?.chain, ['has']);
  assert.equal(progressive.auxiliaryChain?.function, 'BE');
  assert.deepEqual(progressive.auxiliaryChain?.chain, ['are']);
  assert.equal(simple.auxiliaryChain, undefined);
  assert.notEqual(semanticCaseFingerprint(haveText), semanticCaseFingerprint(simpleText));
});

test('V2 affirmed destructive records cannot be masked by an unrelated positive relation', () => {
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  const asserted = evaluatePhotosynthesisRelationsV2(
    'Plants capture light energy. Photosynthesis destroys light energy.',
  );
  assert.equal(asserted.passed, false);
  assert.ok(asserted.relationRecords.some((record) => record.relationType === 'DESTRUCTIVE_RELATION'
    && record.polarity === 'AFFIRMED' && !record.qualifies));

  const negated = evaluatePhotosynthesisRelationsV2(
    'Plants capture light energy. Photosynthesis does not destroy light energy.',
  );
  assert.equal(negated.passed, true);
});

test('V2 chlorophyll support cannot be stitched across a sentence boundary', () => {
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  const local = evaluatePhotosynthesisRelationsV2(
    'Plants use chlorophyll to capture light energy during photosynthesis.',
  );
  assert.equal(local.positiveChlorophyllBinding, true);

  const crossSentence = evaluatePhotosynthesisRelationsV2(
    'Photosynthesis uses chlorophyll to capture carbon dioxide. Plants capture light energy.',
  );
  assert.equal(crossSentence.positiveChlorophyllBinding, false);
  assert.equal(crossSentence.relationRecords.some((record) => record.relationType === 'CHLOROPHYLL_SUPPORT'), false);

  const crossClause = evaluatePhotosynthesisRelationsV2(
    'Photosynthesis uses chlorophyll to capture carbon dioxide; plants capture light energy.',
  );
  assert.equal(crossClause.positiveChlorophyllBinding, false);
  assert.equal(crossClause.relationRecords.some((record) => record.relationType === 'CHLOROPHYLL_SUPPORT'), false);
});

test('V2 non-light direct objects stay local when a separate clause mentions light', () => {
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  for (const answer of [
    'Plants capture carbon dioxide; light energy is nearby.',
    'Plants capture carbon dioxide. Light energy is nearby.',
  ]) {
    const result = evaluatePhotosynthesisRelationsV2(answer);
    const relation = result.relationRecords.find((record) => record.verbLemma === 'capture');
    assert.equal(result.passed, false, answer);
    assert.equal(relation?.subjectValidity, 'ALL_VALID', answer);
    assert.equal(relation?.directObject?.normalized, 'carbon dioxide', answer);
    assert.equal(relation?.directObject?.role, 'NON_LIGHT_OBJECT', answer);
    assert.equal(relation?.lightObject, null, answer);
    assert.equal(relation?.qualifies, false, answer);
    assert.equal(result.relationRecords.some((record) => record.qualifies
      && record.lightObject?.binding === 'PRONOUN_ANTECEDENT'), false, answer);
  }
});

test('V2 semantic corpus meets every frozen class minimum with unique fingerprints', () => {
  const { canonicalCases, requiredTestClasses, generatedV2Cases, b5SemanticSupplementCases } = require('./photosynthesis-relation-cases');
  const { semanticCaseFingerprint } = require('./photosynthesis-relation-evaluator');
  assert.ok(Array.isArray(generatedV2Cases));
  assert.equal(requiredTestClasses.length, 28);
  const all = [...canonicalCases, ...generatedV2Cases, ...b5SemanticSupplementCases];
  const fingerprints = all.map((item) => semanticCaseFingerprint(item.text, item.expectedDecision));
  const fingerprintGroups = new Map();
  all.forEach((item, index) => fingerprintGroups.set(fingerprints[index], [...(fingerprintGroups.get(fingerprints[index]) || []), item.id]));
  assert.equal(fingerprints.length, 206);
  assert.equal(new Set(fingerprints).size, 204, 'cosmetic punctuation is not semantic diversity');
  assert.deepEqual([...fingerprintGroups.values()].filter((ids) => ids.length > 1).map((ids) => ids.sort()), [
    ['SB-001', 'V2-SENTENCE_BOUNDARY-005'],
    ['V2-PUNCTUATION_ABUSE-003', 'V2-PUNCTUATION_ABUSE-007'],
  ]);
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  for (const item of [...generatedV2Cases, ...b5SemanticSupplementCases]) {
    const result = evaluatePhotosynthesisRelationsV2(item.text);
    assert.equal(result.passed ? 'PASS' : 'FAIL', item.expectedDecision, item.id);
    if (item.expectedPolarity) assert.equal(result.polarity, item.expectedPolarity, item.id);
  }
  for (const row of requiredTestClasses) {
    const members = all.filter((item) => item.classIds?.includes(row.classId));
    const uniqueCount = new Set(members.map((item) => semanticCaseFingerprint(item.text, item.expectedDecision))).size;
    assert.ok(uniqueCount >= row.minimumUniqueSemanticCases, `${row.classId}: ${uniqueCount}/${row.minimumUniqueSemanticCases}`);
    for (const id of row.requiredCanonicalCases) assert.ok(canonicalCases.some((item) => item.id === id && item.classIds.includes(row.classId)), `${row.classId}: ${id}`);
  }
});

test('V2 parameter dimensions match parsed semantic differences and class allowances', () => {
  const { canonicalCases, requiredTestClasses, generatedV2Cases, b5SemanticSupplementCases } = require('./photosynthesis-relation-cases');
  const { evaluatePhotosynthesisRelationsV2, semanticCaseFingerprint, tokenizeV2 } = require('./photosynthesis-relation-evaluator');
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  for (const item of [...generatedV2Cases, ...b5SemanticSupplementCases]) {
    const row = requiredTestClasses.find((candidate) => item.classIds.includes(candidate.classId));
    const seed = canonicalCases.find((candidate) => row.requiredCanonicalCases.includes(candidate.id));
    const before = evaluatePhotosynthesisRelationsV2(seed.text);
    const after = evaluatePhotosynthesisRelationsV2(item.text);
    const dimensions = new Set(item.parameterDimensions);
    assert.ok(dimensions.size > 0, item.id);
    for (const dimension of dimensions) assert.ok(row.allowedParameterDimensions.includes(dimension), `${item.id}: ${dimension} is not allowed`);
    if (dimensions.has('SL')) assert.notDeepEqual(before.subjectSet.flat(), after.subjectSet.flat(), `${item.id}: SL`);
    if (dimensions.has('SO')) assert.ok(!same(before.coordinationTopology, after.coordinationTopology), `${item.id}: SO`);
    if (dimensions.has('SC')) assert.notDeepEqual(before.coordinationTopology.map((x) => x.cardinality), after.coordinationTopology.map((x) => x.cardinality), `${item.id}: SC`);
    if (dimensions.has('VL')) {
      const lemmas = (text) => tokenizeV2(text).filter((token) => ['capture','captures','captured','absorb','absorbs','absorbed','harness','harnesses','harnessed','use','uses','used','convert','converts','converted','transform','transforms','transformed','store','stores','stored','destroy','destroys','destroyed','waste','wastes','wasted','ignore','ignores','ignored','lose','loses','lost','block','blocks','blocked','reject','rejects','rejected','remove','removes','removed'].includes(token.form)).map((token) => token.lemma);
      assert.notDeepEqual(lemmas(seed.text), lemmas(item.text), `${item.id}: VL`);
    }
    if (dimensions.has('VF')) assert.notDeepEqual(before.relationRecords.map((x) => x.verbForm), after.relationRecords.map((x) => x.verbForm), `${item.id}: VF`);
    if (dimensions.has('LO')) assert.notDeepEqual(before.relationRecords.map((x) => [x.directObject?.role,x.directObject?.normalized,x.directObject?.surface]), after.relationRecords.map((x) => [x.directObject?.role,x.directObject?.normalized,x.directObject?.surface]), `${item.id}: LO`);
    if (dimensions.has('BD')) assert.ok(!same(before.topology, after.topology) || !same(before.relationRecords.map((x) => x.objectBarriers?.marker), after.relationRecords.map((x) => x.objectBarriers?.marker)), `${item.id}: BD`);
    if (dimensions.has('PU')) {
      if (['V2-SENTENCE_BOUNDARY-005'].includes(item.id)) {
        assert.equal(semanticCaseFingerprint(seed.text, seed.expectedDecision), semanticCaseFingerprint(item.text, item.expectedDecision), `${item.id}: cosmetic punctuation count`);
      } else assert.notDeepEqual(before.punctuationTopology, after.punctuationTopology, `${item.id}: PU`);
    }
  }
});

test('V2 relation records use schema version 2 without changing the V1 evaluator', () => {
  const { PHOTOSYNTHESIS_RELATION_CASES } = require('./photosynthesis-relation-cases');
  const { evaluatePhotosynthesisRelationsV2, evaluatePhotosynthesisRelations } = require('./photosynthesis-relation-evaluator');
  const result = evaluatePhotosynthesisRelationsV2('Plants capture light energy during photosynthesis.');
  assert.ok(result.relationRecords.length > 0);
  for (const record of result.relationRecords) {
    assert.equal(record.schemaVersion, 2);
    assert.equal(record.evaluatorId, 'photosynthesis-light-relation-v2');
    assert.ok(record.subjectSet && record.directObject && record.evidenceSpan);
    assert.ok(['AFFIRMED','NEGATED','UNCERTAIN','UNRESOLVED'].includes(record.polarity));
  }
  assert.equal(PHOTOSYNTHESIS_RELATION_CASES.length, 823);
  assert.equal(evaluatePhotosynthesisRelations('Photosynthesis is how plants use chlorophyll to capture light energy and make food.').passed, true);
});

test('V2 emitted relation records honor the frozen field, type, and enum schema', () => {
  const schema = {
    schemaVersion: 2,
    evaluatorId: 'photosynthesis-light-relation-v2',
    relationType: ['CORE_LIGHT_RELATION','CHLOROPHYLL_SUPPORT','DESTRUCTIVE_RELATION','WRONG_PIGMENT_RELATION','INVALID_CHLOROPHYLL_RELATION'],
    grammarShape: ['ACTIVE_SIMPLE','ACTIVE_INFINITIVAL_MEDIATED','ACTIVE_COORDINATED_SHARED_OBJECT','PASSIVE_LOCAL_AGENT','PRONOUN_CONTINUATION'],
    subjectSet: { surface: 'string', lemma: 'string', role: ['PROCESS_AGENT','BIOLOGICAL_AGENT','PIGMENT_AGENT','UNSUPPORTED'], start: 'integer', end: 'integer', valid: 'boolean', validityReason: 'string' },
    subjectValidity: ['ALL_VALID','MIXED_INVALID','ALL_INVALID','UNRESOLVED'],
    processContext: ['EXPLICIT_SUBJECT','LOCAL_ADJUNCT','MEDIATED_CONTROLLER','PRONOUN_ANTECEDENT',null],
    voice: ['ACTIVE','PASSIVE'],
    auxiliaryChain: { surface: 'string', lemma: 'string', function: ['DO','BE','HAVE','MODAL','NEGATOR'], start: 'integer', end: 'integer' },
    modal: [null,'can','cannot','may','might','could','must','should','would'],
    controlChain: { type: ['FAIL_TO','NOT_FAIL_TO','NEVER_FAIL_TO','NOT_APPEAR_TO','APPEAR_NOT_TO','NOT_SEEM_TO','SEEM_NOT_TO','USE_MEDIATED'], start: 'integer', end: 'integer', effect: ['AFFIRM','NEGATE','UNCERTAIN','UNRESOLVED'] },
    verbSurface: 'string',
    verbLemma: 'string',
    verbForm: ['BASE','PRESENT_3SG','PAST','PRESENT_PARTICIPLE','PAST_PARTICIPLE'],
    directObject: { surface: 'string', normalized: 'string', role: ['LIGHT_OBJECT','CHLOROPHYLL','NON_LIGHT_OBJECT'], start: 'integer', end: 'integer' },
    lightObject: { surface: 'string', normalized: 'light-energy', binding: ['DIRECT_OBJECT','PASSIVE_SUBJECT','SHARED_OBJECT','PRONOUN_ANTECEDENT'], start: 'integer', end: 'integer' },
    instrumentSet: { surface: 'string', lemma: 'chlorophyll', start: 'integer', end: 'integer' },
    predicateStart: 'integer', predicateEnd: 'integer', objectBarrierEncountered: 'boolean',
    objectBarriers: { type: ['DIRECT_OBJECT','FINITE_PREDICATE','EXPLICIT_SUBJECT','CLAUSE','SENTENCE','SEPARATE_PROPOSITION','INCOMPATIBLE_PREPOSITION'], start: 'integer', end: 'integer' },
    polarity: ['AFFIRMED','NEGATED','UNCERTAIN','UNRESOLVED'],
    polarityReason: 'string', qualifies: 'boolean', rejectionReasons: 'string[]',
    evidenceSpan: { text: 'string', start: 'integer', end: 'integer' },
  };
  const matches = (value, shape) => {
    if (shape === 'string') return typeof value === 'string';
    if (shape === 'integer') return Number.isInteger(value);
    if (shape === 'boolean') return typeof value === 'boolean';
    if (shape === 'string[]') return Array.isArray(value) && value.every((item) => typeof item === 'string');
    if (Array.isArray(shape)) return shape.includes(value);
    if (shape && typeof shape === 'object') return value && typeof value === 'object' && !Array.isArray(value)
      && Object.entries(shape).every(([key, child]) => !Object.hasOwn(value, key) || value[key] === null || matches(value[key], child));
    return Object.is(value, shape);
  };
  const { canonicalCases, generatedV2Cases, b5SemanticSupplementCases } = require('./photosynthesis-relation-cases');
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  assert.equal(matches('STACKED', schema.modal), false);
  assert.equal(matches("can't", schema.modal), false);
  assert.equal(matches('cannot', schema.modal), true);
  const simpleRecord = evaluatePhotosynthesisRelationsV2('Plants capture light energy during photosynthesis.').relationRecords[0];
  assert.equal(simpleRecord.auxiliaryChain, undefined, 'no auxiliary chain must not be mislabeled as DO');
  for (const item of [...canonicalCases, ...generatedV2Cases, ...b5SemanticSupplementCases]) {
    const result = evaluatePhotosynthesisRelationsV2(item.text);
    for (const [index, record] of result.relationRecords.entries()) {
      for (const [key, shape] of Object.entries(schema)) {
        if (!Object.hasOwn(record, key) || record[key] === null) continue;
        assert.ok(matches(record[key], shape), `${item.id} relation ${index}: ${key} violates frozen schema`);
      }
    }
  }
});

test('V2 semantic fingerprints preserve ordered claims and ignore cosmetic spelling', () => {
  const { semanticCaseFingerprint } = require('./photosynthesis-relation-evaluator');
  const { canonicalCases } = require('./photosynthesis-relation-cases');
  const byId = (id) => canonicalCases.find((item) => item.id === id);
  assert.notEqual(semanticCaseFingerprint(byId('ADV003').text), semanticCaseFingerprint(byId('MAL-002').text));
  const base = semanticCaseFingerprint('Plants capture light energy during photosynthesis.');
  assert.equal(base, semanticCaseFingerprint('  PLANTS   capture light energy during photosynthesis!  '));
  assert.equal(
    semanticCaseFingerprint('Photosynthesis captures light energy! Plants capture light energy.'),
    semanticCaseFingerprint('Photosynthesis captures light energy!!! Plants capture light energy.'),
    'repeated punctuation must not create semantic diversity',
  );
  const result = require('./photosynthesis-relation-evaluator').evaluatePhotosynthesisRelationsV2('Plants capture light energy during photosynthesis.');
  const changed = (edit) => {
    const copy = structuredClone(result);
    edit(copy);
    return semanticCaseFingerprint(copy);
  };
  const original = semanticCaseFingerprint(result);
  assert.notEqual(original, semanticCaseFingerprint('Plants capture melanin during photosynthesis.'));
  assert.notEqual(original, changed((x) => { x.subjectSet[0].push(['alga', 'BIOLOGICAL_AGENT']); }));
  const coordinated = require('./photosynthesis-relation-evaluator').evaluatePhotosynthesisRelationsV2('Plants and algae capture light energy during photosynthesis.');
  const reversed = structuredClone(coordinated);
  reversed.subjectSet = coordinated.subjectSet.map((group) => [...group].reverse());
  assert.notEqual(semanticCaseFingerprint(coordinated), semanticCaseFingerprint(reversed));
  const unrelatedOr = structuredClone(coordinated);
  unrelatedOr.normalized += ' or nearby';
  assert.equal(semanticCaseFingerprint(coordinated), semanticCaseFingerprint(unrelatedOr));
  assert.notEqual(original, changed((x) => { x.relationRecords.push({ ...x.relationRecords[0], verbLemma: 'store', verbForm: 'BASE' }); }));
  assert.notEqual(original, changed((x) => { x.relationRecords[0].lightObject.binding = 'PRONOUN_ANTECEDENT'; }));
});

test('V2 classes exercise their required relation diagnostics across semantic cases', () => {
  const { canonicalCases, requiredTestClasses, generatedV2Cases } = require('./photosynthesis-relation-cases');
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  const all = [...canonicalCases, ...generatedV2Cases];
  for (const row of requiredTestClasses) {
    const members = all.filter((item) => item.classIds.includes(row.classId));
    assert.ok(members.length >= row.minimumUniqueSemanticCases, `${row.classId}: class minimum`);
    for (const item of members) {
      if (item.expectedDecision !== 'PASS_OR_FAIL_BY_CASE') {
        const result = evaluatePhotosynthesisRelationsV2(item.text);
        assert.equal(result.passed ? 'PASS' : 'FAIL', item.expectedDecision, `${row.classId}: ${item.id}`);
      }
    }
    for (const property of row.requiredDiagnosticProperties) {
      assert.ok(members.some((item) => hasRequiredRelationBehavior(
        evaluatePhotosynthesisRelationsV2(item.text), property, item,
      )), `${row.classId}: ${property}`);
    }
  }
});

test('Astra defect 1: malformed trailing frames cannot pass factuality', () => {
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  const photoCase = v2.cases.find(({ id }) => id === 'simple-explanation-photosynthesis');
  for (const answer of [
    'Photosynthesis captures light energy chlorophyll glucose.',
    'Photosynthesis captures light energy in for during chlorophyll.',
  ]) {
    const result = evaluatePhotosynthesisRelationsV2(answer);
    const grade = gradeCase(photoCase, observation(answer, { id: photoCase.id }));
    assert.equal(result.passed, false, answer);
    assert.equal(result.hasMalformed, true, answer);
    assert.equal(grade.factuality.passed, false, answer);
  }
});

test('malformed trailing content is rejected by complete-frame shape, not token membership', () => {
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  const photoCase = v2.cases.find(({ id }) => id === 'simple-explanation-photosynthesis');
  for (const answer of [
    'Photosynthesis captures light energy.',
    'Photosynthesis captures light energy during photosynthesis.',
    'Photosynthesis converts light energy into chemical energy.',
    'Photosynthesis is how plants use chlorophyll to capture light energy and make food.',
    'Photosynthesis converts light energy into chemical energy, storing it in glucose molecules.',
  ]) assert.equal(evaluatePhotosynthesisRelationsV2(answer).passed, true, answer);
  for (const answer of [
    'Photosynthesis captures light energy chlorophyll.',
    'Photosynthesis captures light energy chlorophyll glucose.',
    'Photosynthesis captures light energy in.',
    'Photosynthesis captures light energy in for during chlorophyll.',
    'Photosynthesis captures light energy during photosynthesis chlorophyll.',
    'Photosynthesis captures light energy into chemical energy glucose.',
    'Photosynthesis captures light energy into chemical energy into chemical energy.',
    'Photosynthesis captures light energy storing.',
    'Photosynthesis captures light energy, chlorophyll.',
  ]) {
    const result = evaluatePhotosynthesisRelationsV2(answer);
    assert.equal(result.passed, false, answer);
    assert.equal(result.hasMalformed, true, answer);
    assert.equal(gradeCase(photoCase, observation(answer, { id: photoCase.id })).factuality.passed, false, answer);
  }
});

test('Astra defect 2: affirmative do-support reaches the finite target grammar', () => {
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  const photoCase = v2.cases.find(({ id }) => id === 'simple-explanation-photosynthesis');
  for (const answer of [
    'Photosynthesis does capture light energy.',
    'Photosynthesis did capture light energy.',
  ]) {
    const result = evaluatePhotosynthesisRelationsV2(answer);
    const grade = gradeCase(photoCase, observation(answer, { id: photoCase.id }));
    assert.equal(result.passed, true, answer);
    assert.equal(result.polarity, 'AFFIRMED', answer);
    assert.equal(grade.factuality.passed, true, answer);
  }
});

test('do-support keeps agreement, negation, and adjacent auxiliary chains bounded', () => {
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  for (const answer of [
    'Photosynthesis does capture light energy.',
    'Photosynthesis did capture light energy.',
    'Plants do capture light energy.',
  ]) {
    const result = evaluatePhotosynthesisRelationsV2(answer);
    assert.equal(result.passed, true, answer);
    assert.equal(result.relationRecords[0].auxiliaryChain?.function, 'DO', answer);
  }
  const negated = evaluatePhotosynthesisRelationsV2('Photosynthesis does not capture light energy.');
  assert.equal(negated.passed, false);
  assert.equal(negated.relationRecords[0]?.polarity, 'NEGATED');
  for (const answer of [
    'Photosynthesis does captures light energy.',
    'Photosynthesis did captured light energy.',
    'Photosynthesis does captured light energy.',
    'Photosynthesis did captures light energy.',
    'Photosynthesis do capture light energy.',
    'Plants does capture light energy.',
    'Photosynthesis does does capture light energy.',
    'Photosynthesis can does capture light energy.',
  ]) {
    const result = evaluatePhotosynthesisRelationsV2(answer);
    assert.equal(result.passed, false, answer);
    assert.equal(result.diagnostics.includes('GRAMMAR_SHAPE_NOT_ACCEPTED'), true, answer);
  }
});

test('Astra defect 3: cosmetic sentence-boundary differences share a fingerprint', () => {
  const { semanticCaseFingerprint } = require('./photosynthesis-relation-evaluator');
  const first = 'Photosynthesis converts chemicals. Light energy exists.';
  const cosmetic = 'PHOTOSYNTHESIS converts chemicals... light energy exists.';
  assert.equal(semanticCaseFingerprint(first), semanticCaseFingerprint(cosmetic));
  assert.equal(semanticCaseFingerprint(first), semanticCaseFingerprint(
    '  photosynthesis   converts chemicals. light energy exists.  ',
  ));
  assert.notEqual(semanticCaseFingerprint(first), semanticCaseFingerprint(
    'Photosynthesis converts chemicals. Light energy exists; plants capture carbon dioxide.',
  ));
  assert.notEqual(
    semanticCaseFingerprint('Photosynthesis captures light energy.'),
    semanticCaseFingerprint('Photosynthesis does not capture light energy.'),
  );
});

test('second Astra blocker reproductions expose incomplete contrast tails through gradeCase', () => {
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  const photoCase = v2.cases.find(({ id }) => id === 'simple-explanation-photosynthesis');
  for (const answer of [
    'Photosynthesis captures light energy but chlorophyll glucose.',
    'Photosynthesis captures light energy but captures.',
  ]) {
    const result = evaluatePhotosynthesisRelationsV2(answer);
    const grade = gradeCase(photoCase, observation(answer, { id: photoCase.id }));
    assert.equal(result.passed, false, answer);
    assert.equal(result.hasMalformed, true, answer);
    assert.equal(grade.factuality.passed, false, answer);
  }
});

test('second Astra blocker reproduction accepts the frozen complement-plus-adjunct composition', () => {
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  const answer = 'Photosynthesis converts light energy into chemical energy during photosynthesis.';
  const result = evaluatePhotosynthesisRelationsV2(answer);
  const grade = gradeCase(v2.cases.find(({ id }) => id === 'simple-explanation-photosynthesis'), observation(answer, { id: 'simple-explanation-photosynthesis' }));
  assert.equal(result.passed, true, answer);
  assert.equal(grade.factuality.passed, true, answer);
});

test('second Astra blocker reproduction collapses partial mixed-punctuation duplication', () => {
  const { semanticCaseFingerprint } = require('./photosynthesis-relation-evaluator');
  const first = 'Photosynthesis captures carbon dioxide?!? Light energy exists.';
  const second = 'Photosynthesis captures carbon dioxide?! Light energy exists.';
  assert.equal(semanticCaseFingerprint(first), semanticCaseFingerprint(second));
});

test('second Astra blocker reproduction confirms the packaged fingerprint export is repaired', async () => {
  const packaged = await import('../scripts/run-photosynthesis-relation-mutations.mjs');
  const fingerprint = packaged.createDerivedEvaluator().semanticCaseFingerprint('Photosynthesis captures light energy.');
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
});

test('Astra PREQ-004 rejects malformed continuation morphology and agreement', () => {
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  for (const answer of [
    'Photosynthesis captures light energy but does not captures it.',
    'Photosynthesis captures light energy but did not storing it.',
    'Photosynthesis do not store light energy.',
    'Photosynthesis does not stores light energy.',
  ]) {
    const result = evaluatePhotosynthesisRelationsV2(answer);
    assert.equal(result.passed, false, answer);
    assert.equal(result.hasMalformed, true, answer);
    assert.ok(result.diagnostics.includes('GRAMMAR_SHAPE_NOT_ACCEPTED'), answer);
  }
});

test('Astra PREQ-005 retains explicit new propositions for contradiction detection', () => {
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  const result = evaluatePhotosynthesisRelationsV2(
    'Photosynthesis captures light energy but photosynthesis does not capture light energy.',
  );
  assert.equal(result.relationRecords.length, 2);
  assert.equal(result.contradictions.length, 1);
  assert.equal(result.passed, false);
});

test('Astra PREQ-006 supports shared NOT_FAIL_TO control across coordinated predicates', () => {
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  const result = evaluatePhotosynthesisRelationsV2(
    'Photosynthesis does not fail to capture and store light energy.',
  );
  assert.equal(result.passed, true);
  assert.equal(result.relationRecords.length, 2);
  assert.deepEqual(result.relationRecords.map((record) => [
    record.verbLemma, record.controlChain?.type, record.polarity, record.qualifies,
  ]), [
    ['capture', 'NOT_FAIL_TO', 'AFFIRMED', true],
    ['store', 'NOT_FAIL_TO', 'AFFIRMED', true],
  ]);
});

test('Astra PREQ-007 treats contracted could not as asserted inability', () => {
  const { evaluatePhotosynthesisRelationsV2 } = require('./photosynthesis-relation-evaluator');
  const result = evaluatePhotosynthesisRelationsV2("Photosynthesis couldn't capture light energy.");
  const record = result.relationRecords[0];
  assert.equal(record.subjectSet?.lemma, 'photosynthesis');
  assert.equal(record.modal, 'could');
  assert.equal(record.polarity, 'NEGATED');
  assert.equal(record.polarityReason, 'ASSERTED_INABILITY');
  assert.equal(record.qualifies, false);
  assert.equal(result.passed, false);
});

test('Astra PREQ-002 release fingerprint index rejects global duplicates without dropping canonical coverage', () => {
  const index = JSON.parse(readFileSync(join(EVAL_ROOT, '..', '..', 'evidence', 'p1-photosynthesis-relation-v2', 'fingerprint-index.json'), 'utf8'));
  const { canonicalCases, requiredTestClasses } = require('./photosynthesis-relation-cases');
  assert.equal(index.duplicatePolicy, 'reject-global-duplicate');
  assert.equal(index.entries.length, index.uniqueCount);
  assert.equal(new Set(index.entries.map((entry) => entry.semanticFingerprint)).size, index.entries.length);
  assert.equal(index.sourceCaseCount, 206);
  assert.deepEqual(index.rejectedDuplicates.map((entry) => [entry.retainedCaseId, entry.rejectedCaseId]), [
    ['SB-001', 'V2-SENTENCE_BOUNDARY-005'],
    ['V2-PUNCTUATION_ABUSE-003', 'V2-PUNCTUATION_ABUSE-007'],
  ]);
  for (const item of canonicalCases) assert.ok(index.entries.some((entry) => entry.caseId === item.id), item.id);
  for (const row of requiredTestClasses) {
    const count = new Set(index.entries
      .filter((entry) => entry.classIds.includes(row.classId))
      .map((entry) => entry.semanticFingerprint)).size;
    assert.ok(count >= row.minimumUniqueSemanticCases, `${row.classId}: ${count}/${row.minimumUniqueSemanticCases}`);
  }
});

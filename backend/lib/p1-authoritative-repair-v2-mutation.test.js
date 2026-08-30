'use strict';

/*
 * Independent probes for the final P1 hardening. Each probe constructs a
 * deliberately weakened evaluator, gate, manifest, recovery script, or
 * runner contract and requires the current invariant to reject it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { readFileSync } = require('node:fs');
const {
  copyFile,
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const current = require('./evaluation');
const currentGates = require('./release-gates');
const { answerReplayDiagnostics } = require('./evaluation-diagnostics');

const LIB_ROOT = __dirname;
const BACKEND_ROOT = join(LIB_ROOT, '..');
const V2_PATH = join(BACKEND_ROOT, 'evals', 'backend-intelligence-v2.json');
const V1_PATH = join(BACKEND_ROOT, 'evals', 'backend-intelligence-v1.json');
const RECOVERY_V2_PATH = join(BACKEND_ROOT, 'evals', 'backend-intelligence-v2-recovery10.json');
const RECOVERY_SCRIPT_PATH = join(BACKEND_ROOT, 'scripts', 'recovery-manifest.mjs');
const RUNNER_PATH = join(BACKEND_ROOT, 'scripts', 'run-evals.mjs');

const readUtf8 = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const EVALUATION_SOURCE = readUtf8(join(LIB_ROOT, 'evaluation.js'));
const RELEASE_SOURCE = readUtf8(join(LIB_ROOT, 'release-gates.js'));
const RECOVERY_SOURCE = readUtf8(RECOVERY_SCRIPT_PATH);
const RUNNER_SOURCE = readUtf8(RUNNER_PATH);
const v2 = JSON.parse(readFileSync(V2_PATH, 'utf8'));

const clone = (value) => JSON.parse(JSON.stringify(value));

const loadCjs = (source, baseDir = LIB_ROOT) => {
  const module = { exports: {} };
  const localRequire = (request) => require(join(baseDir, request));
  new Function('require', 'module', 'exports', source)(localRequire, module, module.exports);
  return module.exports;
};

const replaceOnce = (source, needle, replacement, label = needle) => {
  const index = source.indexOf(needle);
  assert.notEqual(index, -1, `mutation anchor vanished: ${label}`);
  assert.equal(source.indexOf(needle, index + needle.length), -1,
    `mutation anchor is not unique: ${label}`);
  return source.slice(0, index) + replacement + source.slice(index + needle.length);
};

const replaceOccurrence = (source, needle, replacement, occurrence, label = needle) => {
  let from = 0;
  let index = -1;
  for (let i = 0; i <= occurrence; i += 1) {
    index = source.indexOf(needle, from);
    assert.notEqual(index, -1, `mutation occurrence vanished: ${label} #${occurrence}`);
    from = index + needle.length;
  }
  return source.slice(0, index) + replacement + source.slice(index + needle.length);
};

const observation = (answer, over = {}) => ({
  answer,
  frames: [],
  latencyMs: 1,
  error: null,
  ...over,
});

const photoCase = v2.cases.find(({ id }) => id === 'simple-explanation-photosynthesis');
const idempotencyCase = v2.cases.find(({ id }) => id === 'timeless-definition-idempotency');
const japanCase = v2.cases.find(({ id }) => id === 'simple-fact-japan-capital');
const broadPhotoClaim = 'Photosynthesis is the process by which plants convert light energy into chemical energy stored as sugar.';
const passiveSummary = 'A job that fails is retried by the worker after a pause. A lease prevents duplicate ownership; after the lease expires another worker may reclaim the job.';

const GOOD_GATES = {
  cases: 22,
  evaluatedCases: 22,
  coverageRate: 1,
  acceptanceRate: 1,
  factualityPassRate: 1,
  factualityMeasuredCases: 5,
  citationRate: 1,
  latencyP95Ms: 30_000,
  costCentsPerTurn: 2,
  costMeasuredCases: 22,
  toolSuccessRate: 1,
  cachePrecision: 1,
  cachePrecisionCases: 22,
};

test('M37: reinserting the broad photosynthesis pattern is killed by false-claim coverage', () => {
  const currentGrade = current.gradeCase(photoCase, observation(broadPhotoClaim, { id: photoCase.id }));
  assert.equal(currentGrade.factuality.passed, false);

  const mutantCase = clone(photoCase);
  mutantCase.factualityChecks.assertions[0].patterns.unshift(
    '\\bphotosynthesis\\b[\\s\\S]{0,220}\\b(?:green\\s+)?plants?\\b[\\s\\S]{0,120}\\b(?:convert|capture|use|uses|harness)\\b[\\s\\S]{0,120}\\b(?:light|sunlight|solar)\\s+energy\\b',
  );
  const mutantGrade = current.gradeCase(mutantCase, observation(broadPhotoClaim, { id: photoCase.id }));
  assert.equal(mutantGrade.factuality.passed, true,
    'the deliberately reinserted broad pattern must be observable as a killed mutant');
});

test('M38: wildcard photosynthesis factuality cannot replace the validated assertion', () => {
  const wildcardCase = clone(photoCase);
  wildcardCase.factualityChecks.assertions[0].patterns = ['.*'];
  wildcardCase.factualityChecks.assertions[0].forbiddenPatterns = [];
  assert.ok(current.validateCase(wildcardCase).some((problem) => problem.includes('wildcard-only')));

  const mutant = loadCjs(replaceOnce(
    EVALUATION_SOURCE,
    'if (/^(?:\\^)?\\.\\*(?:\\$)?$/.test(pattern.trim())) {',
    '        if (false) {',
    'photosynthesis wildcard guard',
  ));
  assert.deepEqual(mutant.validateCase(wildcardCase), []);
});

test('M39: removing chlorophyll from the photosynthesis relation is killed', () => {
  const currentGrade = current.gradeCase(photoCase, observation(broadPhotoClaim, { id: photoCase.id }));
  assert.equal(currentGrade.factuality.passed, false);

  const mutantCase = clone(photoCase);
  mutantCase.factualityChecks.assertions[0].patterns = [
    '\\bphotosynthesis\\b[\\s\\S]{0,260}\\b(?:convert|capture|use|uses|harness)\\b[\\s\\S]{0,120}\\b(?:light|sunlight|solar)\\s+energy\\b',
  ];
  const mutantGrade = current.gradeCase(mutantCase, observation(broadPhotoClaim, { id: photoCase.id }));
  assert.equal(mutantGrade.factuality.passed, true,
    'the broad no-chlorophyll replacement must be caught by the negative control');
});

test('M40: loosening idempotency back to keyword windows is killed by the keyword salad', () => {
  const salad = 'idempotent idempotency request operation api same effect unchanged without duplicate repeat again';
  assert.equal(current.gradeCase(idempotencyCase, observation(salad, { id: idempotencyCase.id })).factuality.passed, false);

  const mutantCase = clone(idempotencyCase);
  mutantCase.factualityChecks.assertions[0].patterns = [
    '\\bidempot(?:ent|ency)\\b[^.!?;]{0,160}\\b(?:same\\s+(?:effect|result|state)|unchanged|without\\s+duplicat)\\b',
    '\\b(?:repeat(?:ed|ing|s)?|again)\\b[^.!?;]{0,100}\\b(?:idempotent|idempotency)\\b[^.!?;]{0,100}\\b(?:same\\s+(?:effect|result|state)|unchanged|without\\s+duplicat)\\b',
    '\\bidempot(?:ent|ency)\\b[^.!?;]{0,180}\\b(?:request|operation|api)\\b[^.!?;]{0,180}\\b(?:same\\s+(?:effect|result|state)|without\\s+duplicat|unchanged)\\b',
  ];
  const mutantGrade = current.gradeCase(mutantCase, observation(salad, { id: idempotencyCase.id }));
  assert.equal(mutantGrade.factuality.passed, true);
});

test('M41: removing the retry relation is killed by a healthy-job retry', () => {
  const answer = 'The worker retries healthy jobs after a delay. A lease prevents two workers from owning the same job. If the lease expires, another worker reclaims it.';
  assert.equal(current.hasSummarySemantics(answer), false);
  const mutant = loadCjs(replaceOnce(
    EVALUATION_SOURCE,
    'failureRetryRelation: clauses.some(hasFailureRetryRelation),',
    '    failureRetryRelation: true,',
    'summary retry relation',
  ));
  assert.equal(mutant.hasSummarySemantics(answer), true);
});

test('M42: removing the failure leg from the passive relation is killed', () => {
  const answer = 'A job is retried by the worker, while failure belongs to another task. A lease prevents two workers from owning the same job. If the lease expires, another worker reclaims it.';
  assert.equal(current.hasSummarySemantics(answer), false);
  const passivePattern = '    /\\b(?:jobs?|tasks?)\\b[^.!?;]{0,55}\\bfail(?:s|ed|ing|ure|ures)?\\b[^.!?;]{0,65}\\bretr(?:y|ies|ied|ying)\\b[^.!?;]{0,65}\\bworkers?\\b/i,';
  const mutant = loadCjs(replaceOnce(
    EVALUATION_SOURCE,
    passivePattern,
    '    /\\b(?:jobs?|tasks?)\\b[^.!?;]{0,65}\\bretr(?:y|ies|ied|ying)\\b[^.!?;]{0,65}\\bworkers?\\b/i,',
    'passive failure relation',
  ));
  assert.equal(mutant.hasSummarySemantics(answer), true);
});

test('M43: removing passive-summary alternation is killed by the authoritative passive form', () => {
  assert.equal(current.hasSummarySemantics(passiveSummary), true);
  const passivePattern = '    /\\b(?:jobs?|tasks?)\\b[^.!?;]{0,55}\\bfail(?:s|ed|ing|ure|ures)?\\b[^.!?;]{0,65}\\bretr(?:y|ies|ied|ying)\\b[^.!?;]{0,65}\\bworkers?\\b/i,';
  const mutant = loadCjs(replaceOnce(
    EVALUATION_SOURCE,
    passivePattern,
    '    /a^/i,',
    'passive summary alternation',
  ));
  assert.equal(mutant.hasSummarySemantics(passiveSummary), false);
});

test('M44: lowering the factuality threshold below 0.95 is killed by the release gate', () => {
  const currentVerdict = currentGates.evaluateGates({ ...GOOD_GATES, factualityPassRate: 0.75 });
  assert.ok(currentVerdict.failed.includes('factuality'));
  const mutantSource = replaceOccurrence(RELEASE_SOURCE, 'threshold: 0.95,', 'threshold: 0.5,', 1, 'factuality threshold');
  const mutant = loadCjs(mutantSource);
  const mutantVerdict = mutant.evaluateGates({ ...GOOD_GATES, factualityPassRate: 0.75 });
  assert.equal(mutantVerdict.passed, true);
});

test('M45: collapsing the measured factuality denominator is killed by an errored eligible case', () => {
  const passing = current.gradeCase(japanCase, observation("Japan's capital is Tokyo.", { id: japanCase.id }));
  const erroredCase = { ...japanCase, id: 'japan-capital-error-fixture' };
  const errored = current.gradeCase(erroredCase, {
    id: erroredCase.id,
    answer: 'Japan has no capital.',
    frames: [],
    error: { code: 'provider_error' },
  });
  const observations = [
    { id: japanCase.id, answer: "Japan's capital is Tokyo." },
    { id: erroredCase.id, answer: 'Japan has no capital.' },
  ];
  const measured = current.summarise([passing, errored], observations);
  assert.equal(measured.factualityMeasuredCases, 1);
  assert.equal(measured.factualityPassRate, 1);

  const mutant = loadCjs(replaceOnce(
    EVALUATION_SOURCE,
    `const measuredFactuality = factualityResults.filter((result) =>
    result.measured === true && result.inconclusive === false);`,
    'const measuredFactuality = factualityResults;',
    'measured factuality denominator',
  ));
  const mutantMetrics = mutant.summarise([
    mutant.gradeCase(japanCase, observation("Japan's capital is Tokyo.", { id: japanCase.id })),
    mutant.gradeCase(erroredCase, {
      id: erroredCase.id,
      answer: 'Japan has no capital.',
      frames: [],
      error: { code: 'provider_error' },
    }),
  ], observations);
  assert.equal(mutantMetrics.factualityMeasuredCases, 2);
  assert.equal(mutantMetrics.factualityPassRate, 0.5);
});

test('M46: removing the error-frame factuality branch is killed by error semantics', () => {
  const errorObservation = {
    answer: 'Japan has no capital.',
    frames: [],
    error: { code: 'provider_error' },
  };
  const currentResult = current.evaluateFactuality(japanCase, errorObservation.answer, errorObservation);
  assert.equal(currentResult.measured, false);
  assert.equal(currentResult.inconclusive, true);
  assert.equal(currentResult.assertions[0].ok, null);

  const mutant = loadCjs(replaceOnce(
    EVALUATION_SOURCE,
    'if (observation?.error?.code) {',
    '  if (false) {',
    'error-frame factuality branch',
  ));
  const mutantResult = mutant.evaluateFactuality(japanCase, errorObservation.answer, errorObservation);
  assert.equal(mutantResult.measured, true);
  assert.equal(mutantResult.inconclusive, false);
  assert.equal(mutantResult.passed, false);
});

test('M47: reverting the recovery default to v1 is killed by the v2 projection check', async () => {
  const run = promisify(execFile);
  const currentRun = await run(process.execPath, [RECOVERY_SCRIPT_PATH, '--check'], { windowsHide: true });
  assert.match(currentRun.stdout, /recovery projection valid/);

  const tempRoot = await mkdtemp(join(tmpdir(), 'p1-recovery-mutant-'));
  try {
    const tempScript = join(tempRoot, 'scripts', 'recovery-manifest.mjs');
    await mkdir(join(tempRoot, 'scripts'), { recursive: true });
    await mkdir(join(tempRoot, 'evals'), { recursive: true });
    const mutantSource = replaceOnce(
      RECOVERY_SOURCE,
      "const DEFAULT_BACKEND_PATH = join(BACKEND_ROOT, 'evals', 'backend-intelligence-v2.json');",
      "const DEFAULT_BACKEND_PATH = join(BACKEND_ROOT, 'evals', 'backend-intelligence-v1.json');",
      'recovery v2 default',
    );
    await writeFile(tempScript, mutantSource, 'utf8');
    await copyFile(V1_PATH, join(tempRoot, 'evals', 'backend-intelligence-v1.json'));
    await copyFile(V2_PATH, join(tempRoot, 'evals', 'backend-intelligence-v2.json'));
    await copyFile(RECOVERY_V2_PATH, join(tempRoot, 'evals', 'backend-intelligence-v2-recovery10.json'));

    await assert.rejects(
      run(process.execPath, [tempScript, '--check'], { windowsHide: true }),
      (error) => {
        assert.notEqual(error.code, 0);
        assert.match(`${error.stdout}\n${error.stderr}`, /missing from backend manifest/);
        return true;
      },
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('M48: spreading diagnostics back to the observation top level is killed by the runner contract', () => {
  const persisted = {
    answer: 'A complete answer.',
    frames: [],
    diagnostics: answerReplayDiagnostics({ answer: 'A complete answer.', frames: [] }),
  };
  assert.equal(persisted.diagnostics.answerLength, persisted.answer.length);
  assert.match(RUNNER_SOURCE, /diagnostics:\s*answerReplayDiagnostics\(observation\)/);

  const mutantSource = replaceOnce(
    RUNNER_SOURCE,
    'diagnostics: answerReplayDiagnostics(observation),',
    '...answerReplayDiagnostics(observation),',
    'nested diagnostics namespace',
  );
  assert.throws(
    () => assert.match(mutantSource, /diagnostics:\s*answerReplayDiagnostics\(observation\)/),
  );
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { spawn } = require('node:child_process');
const { copyFile, mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { pathToFileURL } = require('node:url');

const SOURCE = readFileSync(join(__dirname, '..', 'scripts', 'run-evals.mjs'), 'utf8');
const EVALUATION = readFileSync(join(__dirname, 'evaluation.js'), 'utf8');
const CACHE_VALIDATION = JSON.parse(readFileSync(join(__dirname, '..', 'evals', 'cache-validation-v1.json'), 'utf8'));
const BACKEND_ROOT = join(__dirname, '..');
const RUNNER = join(BACKEND_ROOT, 'scripts', 'run-evals.mjs');
const RUNNER_FIXTURE_FILES = [
  'lib/evaluation.js',
  'lib/release-gates.js',
  'lib/turn-accounting-meta.js',
  'lib/cache-validation.js',
  'lib/citation-urls.js',
  'lib/openrouter-zero-price-catalog.js',
];
const LIVE_ENV_KEYS = [
  'BASE',
  'EVAL_CACHE_BYPASS_SECRET',
  'EVAL_CLERK_FAPI',
  'EVAL_CLERK_SECRET_KEY',
  'EVAL_CLERK_TESTING_TOKEN',
  'EVAL_ORIGIN',
  'EVAL_TOKEN',
  'EVAL_USER_ID',
  'OPENROUTER_API_KEY',
  'OPENROUTER_HOST',
];

function runnerEnv({ cacheSecret, clerkSecret } = {}) {
  const env = { ...process.env };
  for (const key of LIVE_ENV_KEYS) delete env[key];
  if (cacheSecret !== undefined) env.EVAL_CACHE_BYPASS_SECRET = cacheSecret;
  if (clerkSecret !== undefined) env.EVAL_CLERK_SECRET_KEY = clerkSecret;
  return env;
}

function runRunner(args, { cacheSecret, clerkSecret, runnerPath = RUNNER } = {}) {
  const bootstrap = [
    "process.argv.splice(1, 0, 'eval-runner-test');",
    "globalThis.fetch = () => { console.error('UNEXPECTED_FETCH'); process.exit(91); };",
    `await import(${JSON.stringify(pathToFileURL(runnerPath).href)});`,
  ].join(' ');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--input-type=module', '-e', bootstrap, '--', ...args,
    ], {
      cwd: BACKEND_ROOT,
      env: runnerEnv({ cacheSecret, clerkSecret }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function makeInvalidManifestRunner() {
  const root = await mkdtemp(join(tmpdir(), 'alop-evals-runner-'));
  await Promise.all([
    mkdir(join(root, 'scripts'), { recursive: true }),
    mkdir(join(root, 'lib'), { recursive: true }),
    mkdir(join(root, 'evals'), { recursive: true }),
  ]);
  await Promise.all([
    copyFile(RUNNER, join(root, 'scripts', 'run-evals.mjs')),
    ...RUNNER_FIXTURE_FILES.map((file) => copyFile(join(BACKEND_ROOT, file), join(root, file))),
  ]);
  await writeFile(join(root, 'evals', 'cache-validation-v1.json'), JSON.stringify({
    ...CACHE_VALIDATION,
    cases: CACHE_VALIDATION.cases.slice(0, 2),
  }));
  return { root, runnerPath: join(root, 'scripts', 'run-evals.mjs') };
}

test('the judge is pure and neither evaluator source selects Luna through OpenRouter', () => {
  assert.doesNotMatch(EVALUATION, /\bfetch\s*\(/);
  assert.doesNotMatch(EVALUATION, /OPENROUTER_API_KEY|gpt-5\.6-luna/);
  assert.doesNotMatch(SOURCE, /OPENROUTER_API_KEY|OPENROUTER_MODEL|gpt-5\.6-luna/);
});

test('the evaluator refuses an arbitrary Clerk user', () => {
  assert.match(SOURCE, /EVAL_CLERK_SECRET_KEY && !process\.env\.EVAL_USER_ID/);
  assert.match(SOURCE, /requires EVAL_USER_ID; refusing to select an arbitrary Clerk user/);
  assert.doesNotMatch(SOURCE, /users\?limit=1/);
});

test('the evaluator uses a real Clerk session and revokes it', () => {
  assert.match(SOURCE, /Authorization: `Bearer \$\{SECRET\}`/);
  assert.match(SOURCE, /EVAL_CLERK_TESTING_TOKEN/);
  assert.match(SOURCE, /__clerk_testing_token/);
  assert.match(SOURCE, /\/sign_in_tokens/);
  assert.match(SOURCE, /\/v1\/client\/sign_ins/);
  assert.match(SOURCE, /\/v1\/client\/sessions\/\$\{sessionId\}\/tokens/);
  assert.match(SOURCE, /\/sessions\/\$\{sessionId\}\/revoke/);
});

test('fresh evaluation requires both the explicit CLI mode and its secret', () => {
  assert.match(SOURCE, /cacheBypass && !cacheBypassSecret/);
  assert.match(SOURCE, /X-ALOP-Benchmark-Cache-Bypass/);
  assert.match(SOURCE, /cache_bypass_unconfirmed/);
});

test('a live gate requires a zero-price catalog freshness preflight before model calls', () => {
  assert.match(SOURCE, /zero-price-preflight/);
  assert.match(SOURCE, /ZERO_PRICE_PREFLIGHT/);
  assert.match(SOURCE, /pass !== true/);
  assert.match(SOURCE, /activeRoutes/);
});

test('the cache validation phase is fixed, separate, and explicitly non-bypass', () => {
  assert.match(SOURCE, /--cache-validation/);
  assert.match(SOURCE, /buildCacheValidationPlan/);
  assert.match(SOURCE, /useCacheBypass: false/);
  assert.match(SOURCE, /finaliseCacheValidation/);
  assert.equal(CACHE_VALIDATION.name, 'cache-validation-v1');
  assert.equal(CACHE_VALIDATION.preResults.phase, 'pre-results');
  assert.equal(CACHE_VALIDATION.preResults.cacheBypass, false);
  assert.equal(CACHE_VALIDATION.preResults.postResultsAdaptation, false);
});

test('quality manifests remain the cache-bypassed set', () => {
  for (const name of ['core-v1', 'backend-intelligence-v1', 'backend-intelligence-v1-recovery10']) {
    assert.match(SOURCE, new RegExp(`"${name}"`));
  }
  assert.match(SOURCE, /QUALITY_CACHE_BYPASS_DATASETS/);
});

test('validate-only exits before live cache and Clerk authorization checks', () => {
  const validateOnly = SOURCE.indexOf('if (bool("validate-only"))');
  assert.notEqual(validateOnly, -1);
  assert.ok(validateOnly < SOURCE.indexOf('if (cacheBypass && !cacheBypassSecret)'));
  assert.ok(validateOnly < SOURCE.indexOf('if (cacheValidation && !cacheBypassSecret)'));
  assert.ok(validateOnly < SOURCE.indexOf('if (process.env.EVAL_CLERK_SECRET_KEY && !process.env.EVAL_USER_ID)'));
});

test('valid cache validation is offline and succeeds without its live secret', async () => {
  const result = await runRunner(['--validate-only', '--cache-validation']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Cache validation manifest is valid\. Nothing was spent\./);
  assert.doesNotMatch(result.stdout + result.stderr, /UNEXPECTED_FETCH/);
});

test('invalid cache validation is reported before a missing live secret', async () => {
  const fixture = await makeInvalidManifestRunner();
  try {
    const result = await runRunner(['--validate-only', '--cache-validation'], { runnerPath: fixture.runnerPath });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Cache validation manifest is not runnable:/);
    assert.match(result.stderr, /cases must contain exactly 3 fixed cases/);
    assert.doesNotMatch(result.stderr, /requires EVAL_CACHE_BYPASS_SECRET/);
    assert.doesNotMatch(result.stdout + result.stderr, /UNEXPECTED_FETCH/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('actual cache validation without its secret fails closed before any request', async () => {
  const result = await runRunner(['--cache-validation']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /--cache-validation requires EVAL_CACHE_BYPASS_SECRET/);
  assert.doesNotMatch(result.stdout + result.stderr, /UNEXPECTED_FETCH/);
});

test('a present cache secret does not change validate-only behavior', async () => {
  const withoutSecret = await runRunner(['--validate-only', '--cache-validation']);
  const withSecret = await runRunner(['--validate-only', '--cache-validation'], { cacheSecret: 'test-only-sentinel' });
  assert.deepEqual(
    { code: withSecret.code, signal: withSecret.signal, stdout: withSecret.stdout, stderr: withSecret.stderr },
    { code: withoutSecret.code, signal: withoutSecret.signal, stdout: withoutSecret.stdout, stderr: withoutSecret.stderr },
  );
});

test('validate-only keeps normal quality manifests offline and unchanged', async () => {
  const names = ['core-v1', 'backend-intelligence-v1', 'backend-intelligence-v1-recovery10'];
  const results = await Promise.all(names.map((name) => runRunner(['--validate-only', '--dataset', name])));
  for (const [index, result] of results.entries()) {
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`Dataset ${names[index]}: `));
    assert.match(result.stdout, /Dataset is valid\. Nothing was spent\./);
    assert.doesNotMatch(result.stdout + result.stderr, /UNEXPECTED_FETCH/);
  }
});

test('validate-only ignores the live cache flag and malformed Clerk configuration', async () => {
  const result = await runRunner(['--validate-only', '--dataset', 'core-v1', '--cache-bypass'], {
    cacheSecret: undefined,
    clerkSecret: 'test-only-sentinel',
  });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Dataset is valid\. Nothing was spent\./);
  assert.doesNotMatch(result.stdout + result.stderr, /UNEXPECTED_FETCH/);
});

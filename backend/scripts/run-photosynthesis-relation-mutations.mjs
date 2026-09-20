import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RECIPE_VERSION = 'p1-static-compose-v1';
const ENTRY_POINT = 'backend/scripts/run-photosynthesis-relation-mutations.mjs';
const EVALUATOR_PATH = 'backend/lib/photosynthesis-relation-evaluator.js';
const RUNNER_IMPORTS = /^import \{ readFileSync \} from 'node:fs';\r?\nimport \{ createRequire, Module \} from 'node:module';\r?\nimport \{ dirname, resolve \} from 'node:path';\r?\nimport \{ fileURLToPath \} from 'node:url';\r?\n\r?\n/;
const RECIPE_BYTES = readFileSync(fileURLToPath(import.meta.url));

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function gitBlobOid(bytes) {
  return createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex');
}

function decodeUtf8(bytes, label) {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error(`${label} is not valid UTF-8`);
  return text;
}

function assertEvaluatorClosure(evaluatorBytes) {
  const source = decodeUtf8(evaluatorBytes, 'evaluator blob');
  const callCount = source.match(/\brequire\s*\(/g)?.length ?? 0;
  const literalCalls = [...source.matchAll(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g)];
  if (literalCalls.length !== callCount || literalCalls.some((match) => match[2] !== 'node:crypto')) {
    throw new Error('evaluator runtime closure changed; only literal require(node:crypto) is reviewed');
  }
  if (/\brequire\s*\.\s*(?:resolve|cache|extensions|main)\b|\bimport\s*\(|\beval\s*\(/.test(source)) {
    throw new Error('evaluator runtime closure changed; dynamic loading is not reviewed');
  }
}

function splitRunner(runnerBytes) {
  const source = decodeUtf8(runnerBytes, 'runner blob');
  const match = RUNNER_IMPORTS.exec(source);
  if (!match) throw new Error('pinned mutation runner import header changed; normal-mode adapter needs re-review');
  const bodyOffset = Buffer.byteLength(match[0], 'utf8');
  const body = runnerBytes.subarray(bodyOffset);
  if (body.length === 0) throw new Error('pinned mutation runner has an empty body');
  return body;
}

// The adapter reports Node permission policy; the reviewed verifier remains authoritative for OS-level network isolation.
function qualificationAndNormalModePrefix() {
  return String.raw`
}

export function createDerivedEvaluator() {
  const module = { exports: {} };
  const exports = module.exports;
  const require = (specifier) => {
    if (specifier !== 'node:crypto') throw new Error('unreviewed evaluator dependency: ' + specifier);
    return __p1Crypto;
  };
  __p1CjsFactory.call(module.exports, exports, require, module, '/work/input/candidate.mjs', '/work/input');
  return module.exports;
}

function __p1RunIdValid(runId) {
  return typeof runId === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(runId);
}

function __p1ScratchWritable(runId) {
  const scratchPath = '/tmp/p1-candidate-' + runId + '.tmp';
  let descriptor;
  let created = false;
  let writable = false;
  try {
    descriptor = openSync(scratchPath, 'wx', 0o600);
    created = true;
    writable = writeSync(descriptor, 'p1') === 2;
  } catch {}
  try { if (descriptor !== undefined) closeSync(descriptor); } catch { writable = false; }
  try { if (created) unlinkSync(scratchPath); } catch { writable = false; }
  return writable;
}

async function __p1RunQualification() {
  const runId = process.argv[2];
  if (process.argv.length !== 3 || !__p1RunIdValid(runId)) {
    process.stderr.write('invalid CandidateQualification runId\n');
    process.exitCode = 2;
    return;
  }
  const observations = {
    snapshotReadable: false,
    scratchWritable: false,
    networkDenied: false,
    sensitiveEnvAbsent: false,
    processCreationDenied: false,
    processErrorCode: 'NOT_ATTEMPTED',
    resultSerialized: false,
  };
  let semanticPass = false;
  try {
    const evaluator = createDerivedEvaluator().evaluatePhotosynthesisRelationsV2;
    if (typeof evaluator !== 'function') throw new Error('selected V2 evaluator export is not callable');
    const positive = evaluator('Photosynthesis converts light energy into chemical energy.');
    const negative = evaluator('Photosynthesis does not capture light energy.');
    semanticPass = positive.passed === true
      && positive.polarity === 'AFFIRMED'
      && positive.relationRecords.some((record) => record.qualifies && record.polarity === 'AFFIRMED')
      && negative.passed === false
      && negative.polarity === 'NEGATED'
      && negative.relationRecords.some((record) => record.polarity === 'NEGATED');
  } catch (error) {
    process.stderr.write('CandidateQualification evaluator sentinel failed: ' + (error?.name || 'Error') + '\n');
  }
  try { observations.snapshotReadable = readFileSync(process.argv[1]).length > 0; } catch {}
  observations.scratchWritable = __p1ScratchWritable(runId);
  const permission = process.permission;
  try { observations.networkDenied = typeof permission?.has === 'function' && permission.has('net') === false; } catch {}
  try { observations.processCreationDenied = typeof permission?.has === 'function' && permission.has('child') === false; } catch {}
  const sensitiveNames = ['OPENROUTER_API_KEY', 'GITHUB_TOKEN', 'CODEX_AUTH'];
  observations.sensitiveEnvAbsent = sensitiveNames.every((name) => process.env[name] === undefined);

  const result = { schemaVersion: 1, kind: 'p1-verifier-candidate-observation', runId, mode: 'CandidateQualification', observations };
  let serialized;
  try {
    serialized = JSON.stringify(result);
    observations.resultSerialized = typeof serialized === 'string';
    serialized = JSON.stringify(result);
    process.stdout.write(serialized + '\n');
  } catch {
    process.stderr.write('CandidateQualification result serialization failed\n');
    process.exitCode = 1;
    return;
  }
  const observationPass = observations.snapshotReadable
    && observations.scratchWritable
    && observations.networkDenied
    && observations.sensitiveEnvAbsent
    && observations.processCreationDenied
    && observations.resultSerialized;
  if (!semanticPass || !observationPass) process.exitCode = 1;
}

const __p1IsMain = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
const __p1EntryPath = process.argv[1]?.replace(/\\/g, '/');
if (__p1IsMain && __p1EntryPath?.endsWith('/candidate.mjs')) {
  await __p1RunQualification();
} else if (__p1IsMain) {
`;
}

function composeArtifact(evaluatorBytes, runnerBytes) {
  if (!Buffer.isBuffer(evaluatorBytes) || !Buffer.isBuffer(runnerBytes)) throw new TypeError('raw Git blob buffers are required');
  assertEvaluatorClosure(evaluatorBytes);
  const runnerBody = splitRunner(runnerBytes);
  const evaluatorBlob = gitBlobOid(evaluatorBytes);
  const runnerBlob = gitBlobOid(runnerBytes);
  const recipeBlob = gitBlobOid(RECIPE_BYTES);

  const prefix = Buffer.from([
    `// ${RECIPE_VERSION}; evaluator-blob=${evaluatorBlob}; runner-blob=${runnerBlob}; recipe-blob=${recipeBlob}`,
    "import * as __p1Crypto from 'node:crypto';",
    "import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';",
    "import { createRequire, Module } from 'node:module';",
    "import { dirname, resolve } from 'node:path';",
    "import { fileURLToPath, pathToFileURL } from 'node:url';",
    '',
    'function __p1CjsFactory(exports, require, module, __filename, __dirname) {',
    '',
  ].join('\n'), 'utf8');
  const evaluatorEnd = prefix.length + evaluatorBytes.length;
  const middle = Buffer.from(qualificationAndNormalModePrefix(), 'utf8');
  const suffix = Buffer.from('\n}\n', 'utf8');
  const artifact = Buffer.concat([prefix, evaluatorBytes, middle, runnerBody, suffix]);
  return {
    artifact,
    metadata: {
      recipeVersion: RECIPE_VERSION,
      recipeBlob,
      evaluatorBlob,
      evaluatorSha256: sha256(evaluatorBytes),
      runnerBlob,
      runnerSha256: sha256(runnerBytes),
      selectedExport: 'evaluatePhotosynthesisRelationsV2',
      entryPoint: ENTRY_POINT,
      evaluatorStart: prefix.length,
      evaluatorEnd,
      embeddedEvaluatorSha256: sha256(artifact.subarray(prefix.length, evaluatorEnd)),
      artifactSha256: sha256(artifact),
      artifactBytes: artifact.length,
    },
  };
}

function parseOptions(argv) {
  const result = {};
  const allowed = new Set(['repo', 'git-exe', 'expected-git-version', 'expected-node-sha256', 'expected-git-sha256', 'green-commit', 'evaluator-blob', 'runner-blob', 'output']);
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined || result[key.slice(2)] !== undefined) {
      throw new Error('expected unique --name value arguments');
    }
    if (!allowed.has(key.slice(2))) throw new Error(`unknown derivation input ${key}`);
    result[key.slice(2)] = value;
  }
  const required = ['repo', 'git-exe', 'expected-git-version', 'expected-node-sha256', 'expected-git-sha256', 'green-commit', 'evaluator-blob', 'runner-blob', 'output'];
  for (const key of required) if (!result[key]) throw new Error(`missing --${key}`);
  return result;
}

function controlledGitEnvironment(gitExecutable) {
  const root = dirname(gitExecutable);
  const pathEntries = process.platform === 'win32'
    ? [root, resolve(root, '..', 'bin'), resolve(root, '..', 'mingw64', 'bin'), `${process.env.SystemRoot}\\System32`]
    : [root, '/usr/bin', '/bin'];
  const env = {
    PATH: pathEntries.join(process.platform === 'win32' ? ';' : ':'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
  };
  if (process.platform === 'win32') {
    env.SystemRoot = process.env.SystemRoot;
    env.WINDIR = process.env.WINDIR;
  }
  return env;
}

function runGit(gitExecutable, repo, args, env, input) {
  const result = spawnSync(gitExecutable, ['-C', repo, ...args], { env, input, encoding: null, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    const detail = result.stderr?.toString('utf8').trim() || result.error?.message || `exit ${result.status}`;
    throw new Error(`pinned Git command failed: ${detail}`);
  }
  return result.stdout;
}

function immutableBlob(gitExecutable, repo, oid, env) {
  if (!/^[a-f0-9]{40}$/.test(oid)) throw new Error('input is not a full SHA-1 Git blob id');
  const type = runGit(gitExecutable, repo, ['cat-file', '-t', oid], env).toString('ascii').trim();
  if (type !== 'blob') throw new Error(`input ${oid} is not a Git blob`);
  const bytes = runGit(gitExecutable, repo, ['cat-file', 'blob', oid], env);
  const computed = runGit(gitExecutable, repo, ['hash-object', '--no-filters', '--stdin'], env, bytes).toString('ascii').trim();
  if (computed !== oid || gitBlobOid(bytes) !== oid) throw new Error(`raw Git blob identity mismatch for ${oid}`);
  return bytes;
}

function buildFromGit(options) {
  if (process.version !== 'v26.7.0') throw new Error(`Node v26.7.0 required; got ${process.version}`);
  if (!isAbsolute(options.repo) || !isAbsolute(options['git-exe']) || !isAbsolute(options.output)) {
    throw new Error('repository, Git executable, and output paths must be absolute');
  }
  const gitExecutable = resolve(options['git-exe']);
  const repo = resolve(options.repo);
  const output = resolve(options.output);
  if (!existsSync(gitExecutable) || !existsSync(repo)) throw new Error('pinned Git executable or repository path is missing');
  if (existsSync(output)) throw new Error('refusing to overwrite an existing output path');
  if (!/^[a-f0-9]{64}$/.test(options['expected-node-sha256']) || !/^[a-f0-9]{64}$/.test(options['expected-git-sha256'])) {
    throw new Error('full SHA-256 toolchain identities are required');
  }
  const nodeExecutableSha256 = sha256(readFileSync(process.execPath));
  const gitExecutableSha256 = sha256(readFileSync(gitExecutable));
  if (nodeExecutableSha256 !== options['expected-node-sha256']) throw new Error('pinned Node executable SHA-256 mismatch');
  if (gitExecutableSha256 !== options['expected-git-sha256']) throw new Error('pinned Git executable SHA-256 mismatch');
  if (!/^[a-f0-9]{40}$/.test(options['green-commit'])) throw new Error('full immutable GREEN commit SHA is required');
  const env = controlledGitEnvironment(gitExecutable);
  const gitVersion = runGit(gitExecutable, repo, ['--version'], env).toString('utf8').trim();
  if (gitVersion !== options['expected-git-version']) throw new Error(`pinned Git version mismatch: ${gitVersion}`);
  const objectFormat = runGit(gitExecutable, repo, ['rev-parse', '--show-object-format=storage'], env).toString('ascii').trim();
  if (objectFormat !== 'sha1') throw new Error(`unsupported Git object format: ${objectFormat}`);
  const greenCommit = runGit(gitExecutable, repo, ['rev-parse', '--verify', `${options['green-commit']}^{commit}`], env).toString('ascii').trim();
  const greenTree = runGit(gitExecutable, repo, ['rev-parse', `${greenCommit}^{tree}`], env).toString('ascii').trim();
  const evaluatorBlob = runGit(gitExecutable, repo, ['rev-parse', `${greenCommit}:${EVALUATOR_PATH}`], env).toString('ascii').trim();
  const runnerBlob = runGit(gitExecutable, repo, ['rev-parse', `${greenCommit}:${ENTRY_POINT}`], env).toString('ascii').trim();
  if (evaluatorBlob !== options['evaluator-blob'] || runnerBlob !== options['runner-blob']) {
    throw new Error('GREEN commit does not contain the requested evaluator and runner blobs');
  }
  const evaluatorBytes = immutableBlob(gitExecutable, repo, evaluatorBlob, env);
  const runnerBytes = immutableBlob(gitExecutable, repo, runnerBlob, env);
  const recipeOid = runGit(gitExecutable, repo, ['hash-object', '-w', '--no-filters', '--stdin'], env, RECIPE_BYTES).toString('ascii').trim();
  if (recipeOid !== gitBlobOid(RECIPE_BYTES)) throw new Error('derivation recipe Git identity mismatch');
  const recipeBytes = immutableBlob(gitExecutable, repo, recipeOid, env);
  if (!recipeBytes.equals(RECIPE_BYTES)) throw new Error('executing recipe differs from its immutable Git blob');

  const built = composeArtifact(evaluatorBytes, runnerBytes);
  const outputDirectory = dirname(output);
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(output, built.artifact, { flag: 'wx' });
  const emitted = readFileSync(output);
  if (!emitted.equals(built.artifact)) throw new Error('written package differs from derived bytes');
  process.stdout.write(`${JSON.stringify({
    ...built.metadata,
    greenCommit,
    greenTree,
    nodeVersion: process.version,
    nodeExecutable: process.execPath,
    nodeExecutableSha256,
    gitVersion,
    gitExecutable,
    gitExecutableSha256,
    gitObjectFormat: objectFormat,
  })}\n`);
}

const isMain = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    buildFromGit(parseOptions(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`p1-static-compose-v1 failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

export { composeArtifact, gitBlobOid };

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
  if (literalCalls.length !== callCount || literalCalls.some((match) => !['node:crypto', 'pluralize'].includes(match[2]))) {
    throw new Error('evaluator runtime closure changed; only literal require(node:crypto) and require(pluralize) are reviewed');
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
  const __p1ExternalRequire = createRequire(import.meta.url);
  const require = (specifier) => {
    if (specifier === 'node:crypto') return __p1Crypto;
    if (specifier === 'pluralize') return __p1ExternalRequire(specifier);
    throw new Error('unreviewed evaluator dependency: ' + specifier);
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

export { composeArtifact, gitBlobOid };

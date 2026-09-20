#!/usr/bin/env node
/**
 * Build and verify the authoritative ten-case recovery projection.
 *
 * The fixed lists below contain recovery IDs and order only. Every case object
 * in a generated manifest comes from the selected committed backend dataset;
 * this file never reads an old untracked recovery copy.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(HERE, '..');
const DEFAULT_BACKEND_PATH = join(BACKEND_ROOT, 'evals', 'backend-intelligence-v2.json');
const DEFAULT_RECOVERY_PATH = join(BACKEND_ROOT, 'evals', 'backend-intelligence-v2-recovery10.json');

// Historical recovery selection, retained for checking the v1 projection.
export const RECOVERY_CASE_IDS_V1 = Object.freeze([
  'long-context-constraint-recall',
  'evidence-before-speed-claim',
  'model-disagreement-value',
  'full-council-resilience-design',
  'full-council-overkill-arithmetic',
  'creative-no-search',
  'user-text-summary',
  'timeless-definition-idempotency',
  'fresh-weather-search',
  'safety-prompt-boundary',
]);

// The v2 selection keeps the same ten positions and replaces only the
// one-for-one summary ID; no new case is smuggled into the denominator.
export const RECOVERY_CASE_IDS = Object.freeze([
  'long-context-constraint-recall',
  'evidence-before-speed-claim',
  'model-disagreement-value',
  'full-council-resilience-design',
  'full-council-overkill-arithmetic',
  'creative-no-search',
  'user-text-summary-v2',
  'timeless-definition-idempotency',
  'fresh-weather-search',
  'safety-prompt-boundary',
]);

const assertObject = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
};

const validateRecoveryIds = (ids) => {
  if (!Array.isArray(ids)) throw new Error('recovery case IDs must be an array');
  if (ids.length !== 10) throw new Error(`recovery case count must be 10; got ${ids.length}`);

  const seen = new Set();
  for (const id of ids) {
    if (typeof id !== 'string' || !id) throw new Error('recovery case IDs must be non-empty strings');
    if (seen.has(id)) throw new Error(`duplicate recovery case ID: ${id}`);
    seen.add(id);
  }
};

const backendCasesById = (backendManifest) => {
  assertObject(backendManifest, 'backend manifest');
  if (!Array.isArray(backendManifest.cases)) throw new Error('backend manifest cases must be an array');

  const byId = new Map();
  for (const testCase of backendManifest.cases) {
    assertObject(testCase, 'backend case');
    if (typeof testCase.id !== 'string' || !testCase.id) {
      throw new Error('backend case IDs must be non-empty strings');
    }
    if (byId.has(testCase.id)) throw new Error(`duplicate backend case ID: ${testCase.id}`);
    byId.set(testCase.id, testCase);
  }
  return byId;
};

export function projectRecoveryCases(backendManifest, recoveryIds = RECOVERY_CASE_IDS) {
  validateRecoveryIds(recoveryIds);
  const byId = backendCasesById(backendManifest);

  return recoveryIds.map((id) => {
    const testCase = byId.get(id);
    if (!testCase) throw new Error(`recovery case ID missing from backend manifest: ${id}`);
    return testCase;
  });
}

export function projectRecoveryManifest(backendManifest, recoveryIds = RECOVERY_CASE_IDS) {
  const sourceName = typeof backendManifest?.name === 'string'
    ? backendManifest.name
    : 'backend-intelligence-v2';

  return {
    name: `${sourceName}-recovery10`,
    notes: [
      `Deterministic ten-case projection of ${sourceName}.`,
      'Case objects are copied from the current committed backend manifest in fixed recovery order.',
    ],
    cases: projectRecoveryCases(backendManifest, recoveryIds),
  };
}

export function assertRecoveryProjection(backendManifest, recoveryManifest, recoveryIds = RECOVERY_CASE_IDS) {
  assertObject(recoveryManifest, 'recovery manifest');
  const expected = projectRecoveryManifest(backendManifest, recoveryIds);

  if (recoveryManifest.name !== expected.name) {
    throw new Error(`recovery manifest name mismatch: expected ${expected.name}; got ${recoveryManifest.name}`);
  }
  if (JSON.stringify(recoveryManifest.notes) !== JSON.stringify(expected.notes)) {
    throw new Error('recovery manifest notes do not match deterministic metadata');
  }
  if (JSON.stringify(recoveryManifest.cases) !== JSON.stringify(expected.cases)) {
    throw new Error('recovery case objects drifted from the committed backend manifest');
  }
  return true;
}

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const serialize = (manifest) => `${JSON.stringify(manifest, null, 2)}\n`;

async function main() {
  const mode = process.argv[2];
  if (mode !== '--write' && mode !== '--check') {
    console.error('usage: node scripts/recovery-manifest.mjs --write|--check');
    process.exitCode = 2;
    return;
  }

  const backendManifest = await readJson(DEFAULT_BACKEND_PATH);
  const projected = projectRecoveryManifest(backendManifest);

  if (mode === '--write') {
    await writeFile(DEFAULT_RECOVERY_PATH, serialize(projected), 'utf8');
    console.log(`wrote ${DEFAULT_RECOVERY_PATH} (${projected.cases.length} cases)`);
    return;
  }

  const committedRecovery = await readJson(DEFAULT_RECOVERY_PATH);
  assertRecoveryProjection(backendManifest, committedRecovery);
  console.log(`recovery projection valid: ${DEFAULT_RECOVERY_PATH} (${committedRecovery.cases.length} cases)`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`recovery manifest check failed: ${error.message}`);
    process.exitCode = 1;
  });
}

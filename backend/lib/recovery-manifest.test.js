'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const BACKEND_PATH = join(ROOT, 'evals', 'backend-intelligence-v1.json');
const RECOVERY_PATH = join(ROOT, 'evals', 'backend-intelligence-v1-recovery10.json');
const BACKEND_V2_PATH = join(ROOT, 'evals', 'backend-intelligence-v2.json');
const RECOVERY_V2_PATH = join(ROOT, 'evals', 'backend-intelligence-v2-recovery10.json');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

test('recovery manifest is a ten-case exact projection in fixed order', async () => {
  const {
    RECOVERY_CASE_IDS_V1,
    assertRecoveryProjection,
    projectRecoveryManifest,
  } = await import('../scripts/recovery-manifest.mjs');
  const backend = readJson(BACKEND_PATH);
  const recovery = readJson(RECOVERY_PATH);
  const projected = projectRecoveryManifest(backend, RECOVERY_CASE_IDS_V1);

  assert.equal(RECOVERY_CASE_IDS_V1.length, 10);
  assert.equal(new Set(RECOVERY_CASE_IDS_V1).size, 10);
  assert.deepEqual(recovery.cases.map(({ id }) => id), RECOVERY_CASE_IDS_V1);
  assert.deepEqual(recovery.cases, projected.cases);
  assertRecoveryProjection(backend, recovery, RECOVERY_CASE_IDS_V1);
});

test('v2 recovery manifest is a deterministic ten-case projection of the v2 backend manifest', async () => {
  const {
    RECOVERY_CASE_IDS,
    assertRecoveryProjection,
    projectRecoveryManifest,
  } = await import('../scripts/recovery-manifest.mjs');
  const backend = readJson(BACKEND_V2_PATH);
  const recovery = readJson(RECOVERY_V2_PATH);
  const projected = projectRecoveryManifest(backend);

  assert.equal(backend.cases.length, 21);
  assert.equal(RECOVERY_CASE_IDS.length, 10);
  assert.deepEqual(recovery.cases.map(({ id }) => id), RECOVERY_CASE_IDS);
  assert.deepEqual(recovery.cases, projected.cases);
  assert.equal(recovery.name, 'backend-intelligence-v2-recovery10');
  assertRecoveryProjection(backend, recovery);
});

test('model-disagreement-value keeps the current backend expectation exactly', async () => {
  const { projectRecoveryManifest } = await import('../scripts/recovery-manifest.mjs');
  const backend = readJson(BACKEND_PATH);
  const { RECOVERY_CASE_IDS_V1 } = await import('../scripts/recovery-manifest.mjs');
  const projected = projectRecoveryManifest(backend, RECOVERY_CASE_IDS_V1);
  const backendCase = backend.cases.find(({ id }) => id === 'model-disagreement-value');
  const recoveryCase = projected.cases.find(({ id }) => id === 'model-disagreement-value');

  assert.ok(backendCase);
  assert.ok(recoveryCase);
  assert.deepEqual(recoveryCase, backendCase);
  assert.deepEqual(recoveryCase.expect, backendCase.expect);
});

test('projection rejects duplicate or missing IDs instead of silently selecting', async () => {
  const { projectRecoveryCases } = await import('../scripts/recovery-manifest.mjs');
  const backend = readJson(BACKEND_PATH);
  const ids = backend.cases.slice(-10).map(({ id }) => id);

  assert.throws(
    () => projectRecoveryCases(backend, [...ids.slice(0, 9), ids[8]]),
    /duplicate recovery case ID/,
  );
  assert.throws(
    () => projectRecoveryCases(backend, ids.slice(0, 9)),
    /recovery case count must be 10/,
  );
  assert.throws(
    () => projectRecoveryCases(backend, [...ids.slice(0, 9), 'missing-recovery-case']),
    /missing from backend manifest/,
  );
  assert.throws(
    () => projectRecoveryCases({ ...backend, cases: [...backend.cases, backend.cases[0]] }, ids),
    /duplicate backend case ID/,
  );
});

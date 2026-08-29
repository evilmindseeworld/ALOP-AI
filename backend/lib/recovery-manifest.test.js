'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const BACKEND_PATH = join(ROOT, 'evals', 'backend-intelligence-v1.json');
const RECOVERY_PATH = join(ROOT, 'evals', 'backend-intelligence-v1-recovery10.json');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

test('recovery manifest is a ten-case exact projection in fixed order', async () => {
  const {
    RECOVERY_CASE_IDS,
    assertRecoveryProjection,
    projectRecoveryManifest,
  } = await import('../scripts/recovery-manifest.mjs');
  const backend = readJson(BACKEND_PATH);
  const recovery = readJson(RECOVERY_PATH);
  const projected = projectRecoveryManifest(backend);

  assert.equal(RECOVERY_CASE_IDS.length, 10);
  assert.equal(new Set(RECOVERY_CASE_IDS).size, 10);
  assert.deepEqual(recovery.cases.map(({ id }) => id), RECOVERY_CASE_IDS);
  assert.deepEqual(recovery.cases, projected.cases);
  assertRecoveryProjection(backend, recovery);
});

test('model-disagreement-value keeps the current backend expectation exactly', async () => {
  const { projectRecoveryManifest } = await import('../scripts/recovery-manifest.mjs');
  const backend = readJson(BACKEND_PATH);
  const projected = projectRecoveryManifest(backend);
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

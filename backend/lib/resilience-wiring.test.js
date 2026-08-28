'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SOURCE = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
const at = (needle) => {
  const index = SOURCE.indexOf(needle);
  assert.notEqual(index, -1, `anchor vanished from server.js: ${needle}`);
  return index;
};

test('the router makes one provider request, with no hidden retry storm', () => {
  const start = at('const response = await callModel(FAST_MODEL');
  const section = SOURCE.slice(start, start + 700);
  assert.match(section, /maxRetries:\s*0/);
});

test('tool seat and probe calls also use one request before ladder recovery', () => {
  const probe = SOURCE.slice(at("phase: 'probe'" ) - 260, at("phase: 'probe'") + 120);
  assert.match(probe, /maxRetries:\s*0/);
  const tool = SOURCE.slice(at("phase: 'tools'" ) - 260, at("phase: 'tools'") + 120);
  assert.match(tool, /maxRetries:\s*0/);
  const native = SOURCE.slice(at("phase: 'tool_seat'" ) - 280, at("phase: 'tool_seat'") + 100);
  assert.match(native, /maxRetries:\s*0/);
});

test('runCouncil options reach both server-side council adapters', () => {
  const fallback = SOURCE.slice(at('const sanitisedFallbackCallModel'), at('validResponses = withSeatSources(await runCouncilWithWhip'));
  assert.match(fallback, /signal,\s*callOptions\s*=\s*\{\}/);
  assert.match(fallback, /\.\.\.callOptions/);

  const plain = SOURCE.slice(at('const plainCouncilSeats'), at('if (PROGRESSIVE_COUNCIL)'));
  assert.match(plain, /signal,\s*callOptions\s*=\s*\{\}/);
  assert.match(plain, /\.\.\.callOptions/);
});

test('the final durable provenance path retains a classified terminal failure', () => {
  assert.match(SOURCE, /require\('\.\/lib\/failure-kind'\)/);
  assert.match(SOURCE, /let provenanceFailureKind\s*=\s*null/);
  assert.match(SOURCE, /provenanceFailureKind/);
  assert.match(SOURCE, /classifyFailureKind\(/);
});

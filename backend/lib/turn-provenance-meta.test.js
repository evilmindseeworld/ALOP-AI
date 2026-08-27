const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTurnProvenanceMeta, safeSourceRecords } = require('./turn-provenance-meta');

test('provenance is compact, versioned, and keeps only safe public sources', () => {
  const result = buildTurnProvenanceMeta({
    messageId: 'assistant_1',
    requestState: 'complete',
    route: 'council',
    answerProduced: true,
    stageKeys: ['context', 'council', 'synthesis', 'hidden_prompt'],
    council: { used: true, seatCount: 7, answered: 7, completed: true },
    synthesis: { started: true, completed: true },
    evidence: { searchUsed: true, sourceCount: 3 },
    verification: { claims: 2, grounded: 2, coverage: 1, sources: 3, conflicts: 0, unresolved: 0 },
    sources: [
      { title: 'Public page', url: 'https://example.com/page#private-fragment', via: 'web_search' },
      { title: 'duplicate', url: 'https://example.com/page', via: 'web_search' },
      { title: 'Private file', url: 'https://internal.example/file', private: true },
      { title: 'Bad protocol', url: 'javascript:alert(1)' },
    ],
  });

  assert.equal(result.provenance.schemaVersion, 1);
  assert.deepEqual(result.provenance.stageKeys, ['context', 'council', 'synthesis']);
  assert.equal(result.provenance.completion.assembled, true);
  assert.equal(result.provenance.sources.length, 1);
  assert.equal(result.provenance.sources[0].url, 'https://example.com/page');
  assert.equal('content' in result.provenance.sources[0], false);
  assert.equal('prompt' in result.provenance, false);
});

test('unsafe or unbounded source rows are dropped', () => {
  const rows = safeSourceRecords([
    { title: 'x'.repeat(1000), url: 'https://example.com' },
    { title: 'with credentials', url: 'https://user:pass@example.com/a' },
    { title: 'not public', url: 'https://example.com/private', displayable: false },
    { title: 'good', url: 'https://example.org/good' },
  ]);
  assert.equal(rows.length, 2);
  assert.ok(rows[0].title.length <= 200);
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0], 'content'), false);
});

test('private and special-use source hosts never become trusted public receipts', () => {
  const urls = [
    'http://127.0.0.1/loopback',
    'http://2130706433/decimal-loopback',
    'http://10.0.0.5/private',
    'http://172.16.0.5/private',
    'http://192.168.1.5/private',
    'http://169.254.1.5/link-local',
    'http://100.64.0.5/shared',
    'http://198.18.0.5/benchmark',
    'http://203.0.113.5/documentation',
    'http://localhost/local',
    'http://worker.localhost/local',
    'http://service.internal/local',
    'http://[::1]/loopback',
    'http://[fc00::1]/private',
    'http://[fe80::1]/link-local',
    'http://[::ffff:127.0.0.1]/mapped-loopback',
    'https://example.com/public',
  ];
  const rows = safeSourceRecords(urls.map((url) => ({ url })));
  assert.deepEqual(rows.map((row) => row.url), ['https://example.com/public']);
});

test('partial, aborted, and fallback outcomes never become assembled', () => {
  const partial = buildTurnProvenanceMeta({
    requestState: 'complete', answerProduced: true, route: 'council',
    stageKeys: ['council', 'synthesis'],
    council: { used: true, seatCount: 3, answered: 2, completed: false, partial: true },
    synthesis: { started: true, completed: true },
  });
  const aborted = buildTurnProvenanceMeta({
    requestState: 'aborted', answerProduced: true, route: 'council',
    stageKeys: ['council'], council: { used: true, seatCount: 3, answered: 1 },
    failure: { occurred: false, userAborted: true, kind: 'client_disconnected' },
  });
  const fallback = buildTurnProvenanceMeta({
    requestState: 'complete', answerProduced: true, route: 'fallback',
    stageKeys: ['council'], council: { used: true, seatCount: 3, answered: 3, completed: true },
    synthesis: { skipped: true },
  });
  assert.equal(partial.provenance.completion.assembled, true);
  assert.equal(partial.provenance.completion.qualified, 'partial_council');
  assert.equal(aborted.provenance.completion.assembled, false);
  assert.equal(fallback.provenance.completion.assembled, false);
});

test('a complete answer with intentionally skipped synthesis is assembled', () => {
  const result = buildTurnProvenanceMeta({
    requestState: 'complete',
    answerProduced: true,
    route: 'solo',
    stageKeys: ['council'],
    council: { used: true, seatCount: 1, answered: 1, completed: true, partial: false },
    synthesis: { skipped: true, completed: false },
  });
  assert.equal(result.provenance.completion.assembled, true);
});

test('an explicit incomplete quality result cannot become an assembled answer', () => {
  const result = buildTurnProvenanceMeta({
    requestState: 'complete',
    answerProduced: true,
    route: 'solo',
    stageKeys: ['council'],
    council: { used: true, seatCount: 1, answered: 1, completed: true },
    synthesis: { skipped: true, completed: false },
    completion: { qualified: 'incomplete' },
  });
  assert.equal(result.provenance.completion.assembled, false);
  assert.equal(result.provenance.completion.qualified, 'incomplete');
});

test('a substituted buffered answer uses the existing degraded provenance shape', () => {
  const result = buildTurnProvenanceMeta({
    requestState: 'failed',
    route: 'degraded',
    answerProduced: true,
    stageKeys: ['council', 'synthesis'],
    council: { used: true, seatCount: 3, answered: 3, completed: true },
    synthesis: { started: true, completed: false, skipped: true, failed: true, fallback: true },
    completion: { qualified: 'incomplete' },
    failure: { occurred: true, kind: 'output_contract_substitution' },
  });

  assert.equal(result.provenance.route, 'degraded');
  assert.equal(result.provenance.synthesis.completed, false);
  assert.equal(result.provenance.synthesis.failed, true);
  assert.equal(result.provenance.synthesis.fallback, true);
  assert.equal(result.provenance.completion.assembled, false);
  assert.equal(result.provenance.completion.qualified, 'incomplete');
  assert.equal(result.provenance.failure.kind, 'output_contract_substitution');
});

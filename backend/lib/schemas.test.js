'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validate, coerce, assertValid, T,
  ROUTE_PLAN, TOOL_CALL, EVIDENCE_RECORD, FINAL_ANSWER_META, TURN_PROVENANCE_META,
} = require('./schemas');
const { parseRoutePlan } = require('./search-plan');
const { parseToolRequests } = require('./tool-protocol');

/* ---- the validator itself --------------------------------------------- */

test('a missing required field fails and names itself', () => {
  const result = validate(ROUTE_PLAN, { memory: true });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ['RoutePlan.queries: missing']);
});

test('an unknown field fails rather than being carried through', () => {
  const result = validate(ROUTE_PLAN, { memory: false, queries: null, __proto_hint: 'x' });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /unknown field/);
});

test('coerce drops unknown fields instead of failing on them', () => {
  const result = coerce(ROUTE_PLAN, { memory: false, queries: null, debugNote: 'ours' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { memory: false, queries: null });
});

test('a wrong type names the type it wanted', () => {
  const result = validate(ROUTE_PLAN, { memory: 'yes', queries: null });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ['RoutePlan.memory: expected boolean']);
});

test('null is a value, not a missing field', () => {
  assert.equal(validate(ROUTE_PLAN, { memory: false, queries: null }).ok, true);
  assert.equal(T.nullable(T.string()).check(null), true);
  assert.equal(T.nullable(T.string()).check(undefined), false);
});

test('a non-object is refused before any field is read', () => {
  for (const value of [null, undefined, 'plan', 42, ['queries']]) {
    assert.equal(validate(ROUTE_PLAN, value).ok, false);
  }
});

test('assertValid throws a typed error carrying every failure', () => {
  assert.throws(
    () => assertValid(ROUTE_PLAN, { memory: 1, queries: 'search this' }),
    (err) => err.code === 'SCHEMA_INVALID' && err.errors.length === 2 && err.schema === 'RoutePlan',
  );
});

/* ---- bounds ------------------------------------------------------------ */

test('the route plan refuses more queries than the fan-out is budgeted for', () => {
  assert.equal(validate(ROUTE_PLAN, { memory: false, queries: ['a', 'b'] }).ok, true);
  assert.equal(validate(ROUTE_PLAN, { memory: false, queries: ['a', 'b', 'c'] }).ok, false);
  assert.equal(validate(ROUTE_PLAN, { memory: false, queries: [''] }).ok, false);
  assert.equal(validate(ROUTE_PLAN, { memory: false, queries: ['x'.repeat(201)] }).ok, false);
});

/* ---- the four shapes on the real path ---------------------------------- */

test('every plan the router parser can produce satisfies the schema', () => {
  const replies = [
    'MEMORY',
    'NO',
    'iphone 17 price\nframework 16 availability',
    '### 1. The Competitive Choice',
    '',
    '<|tool_call>call:google_search:search{queries:["ASUS XG27 specs"]}<tool_call|>',
    'This question does not require a web search because the answer is stable.',
  ];
  for (const reply of replies) {
    const plan = parseRoutePlan(reply);
    assert.equal(validate(ROUTE_PLAN, plan).ok, true, `plan from ${JSON.stringify(reply)} is off-contract`);
  }
});

test('every tool call the protocol parser produces satisfies the schema', () => {
  const native = parseToolRequests({
    role: 'assistant',
    content: '',
    tool_calls: [{ id: 'call_abc', function: { name: 'web_search', arguments: '{"query":"who won"}' } }],
  });
  assert.equal(native.calls.length, 1);
  assert.equal(validate(TOOL_CALL, native.calls[0]).ok, true);
  assert.equal(native.calls[0].id, 'call_abc', 'the provider id must survive verbatim');

  const fenced = parseToolRequests('```tool_call\n{"name":"read_url","args":{"url":"https://example.com"}}\n```');
  assert.equal(fenced.calls.length, 1);
  assert.equal(validate(TOOL_CALL, fenced.calls[0]).ok, true);
  assert.equal('id' in fenced.calls[0], false, 'a fenced call has no id and must not be given a fake one');
});

test('a tool call with an off-contract source is dropped, not executed', () => {
  // The parser only ever writes 'native' or 'fence'. This asserts the guard is
  // live rather than the parser's own behaviour: hand the schema the shape a
  // future provider change would produce.
  assert.equal(validate(TOOL_CALL, { name: 'web_search', args: {}, source: 'builtin' }).ok, false);
  assert.equal(validate(TOOL_CALL, { name: 'web_search', args: [], source: 'native' }).ok, false);
  assert.equal(validate(TOOL_CALL, { name: '', args: {}, source: 'native' }).ok, false);
  assert.equal(validate(TOOL_CALL, { name: 'x', args: {}, source: 'native', id: 7 }).ok, false);
});

test('an evidence record without a source date is allowed; one without a source id is not', () => {
  const base = {
    claim: 'The Framework 16 starts at $1,399.',
    sourceUrl: 'https://frame.work/laptop16',
    sourceId: 'frame.work',
    fetchedAt: 1_760_000_000_000,
    freshness: 'fresh',
    confidence: 0.8,
    via: 'web_search',
  };
  assert.equal(validate(EVIDENCE_RECORD, base).ok, true, 'sourceDate is optional');
  assert.equal(validate(EVIDENCE_RECORD, { ...base, sourceDate: '2026-08-01' }).ok, true);
  const { sourceId, ...noId } = base;
  assert.equal(validate(EVIDENCE_RECORD, noId).ok, false);
  assert.equal(validate(EVIDENCE_RECORD, { ...base, confidence: 1.4 }).ok, false);
  assert.equal(validate(EVIDENCE_RECORD, { ...base, freshness: 'quite fresh' }).ok, false);
  assert.equal(validate(EVIDENCE_RECORD, { ...base, sourceUrl: null }).ok, true, 'a non-web source has no URL');
});

test('final answer metadata cannot omit the ids that make it a ledger row', () => {
  const row = {
    operationId: 'op_1',
    turnId: 'turn_1',
    model: 'google/gemma-4-26b-a4b-it:free',
    textSource: 'content',
    category: 'council',
    citations: [],
    evidenceIds: [],
    charCount: 812,
  };
  assert.equal(validate(FINAL_ANSWER_META, row).ok, true);
  for (const key of ['operationId', 'turnId', 'textSource', 'category', 'charCount']) {
    const { [key]: _dropped, ...without } = row;
    assert.equal(validate(FINAL_ANSWER_META, without).ok, false, `${key} must be required`);
  }
  assert.equal(validate(FINAL_ANSWER_META, { ...row, textSource: 'thinking' }).ok, false);
  assert.equal(validate(FINAL_ANSWER_META, { ...row, model: null }).ok, true, 'a cache hit ran no model');
});

test('turn provenance can share the existing meta column with reliability', () => {
  assert.equal(validate(TURN_PROVENANCE_META, { provenance: { schemaVersion: 1 } }).ok, true);
  assert.equal(validate(TURN_PROVENANCE_META, { provenance: {}, reliability: {} }).ok, true);
  assert.equal(validate(TURN_PROVENANCE_META, { reliability: {} }).ok, false);
  assert.equal(validate(TURN_PROVENANCE_META, { provenance: {}, privateReasoning: 'drop' }).ok, false);
});

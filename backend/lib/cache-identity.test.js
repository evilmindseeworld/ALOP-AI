'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fingerprint, retrievalMode, sourceFreshness, short } = require('./cache-identity');

/* ---- short --------------------------------------------------------------- */

test('short is a stable 12-hex label', () => {
  assert.match(short('anything'), /^[0-9a-f]{12}$/);
  assert.equal(short('anything'), short('anything'));
  assert.notEqual(short('anything'), short('anything else'));
});

/* ---- prompt and policy versions ------------------------------------------ */

test('a changed prompt changes promptVersion and nothing else', () => {
  const base = fingerprint({ prompts: ['sys A'], policies: ['len'], models: ['x/y'], toolSchemas: [] });
  const moved = fingerprint({ prompts: ['sys B'], policies: ['len'], models: ['x/y'], toolSchemas: [] });
  assert.notEqual(base.promptVersion, moved.promptVersion);
  assert.equal(base.policyVersion, moved.policyVersion);
  assert.equal(base.modelFamily, moved.modelFamily);
});

test('a changed policy changes policyVersion', () => {
  const a = fingerprint({ policies: ['detail=short'] });
  const b = fingerprint({ policies: ['detail=long'] });
  assert.notEqual(a.policyVersion, b.policyVersion);
});

/* ORDER MATTERS FOR PROMPTS. Two system prompts in the other order are a
 * different prompt — the later one wins on any rule they both state. */
test('reordered prompts are a different promptVersion', () => {
  assert.notEqual(
    fingerprint({ prompts: ['a', 'b'] }).promptVersion,
    fingerprint({ prompts: ['b', 'a'] }).promptVersion,
  );
});

/* A separator is the whole reason a joined key is safe: without it, ["ab","c"]
 * and ["a","bc"] are one string and two different prompt sets share a cache. */
test('adjacent prompts cannot be confused with a different split of the same text', () => {
  assert.notEqual(
    fingerprint({ prompts: ['ab', 'c'] }).promptVersion,
    fingerprint({ prompts: ['a', 'bc'] }).promptVersion,
  );
});

test('empty and non-string entries are dropped rather than keyed on', () => {
  assert.equal(
    fingerprint({ prompts: ['a', '', null, undefined, 7] }).promptVersion,
    fingerprint({ prompts: ['a'] }).promptVersion,
  );
});

/* ---- model family -------------------------------------------------------- */

test('a routing suffix does not change the model family', () => {
  assert.equal(
    fingerprint({ models: ['openai/gpt-5.6-luna'] }).modelFamily,
    fingerprint({ models: ['openai/gpt-5.6-luna:beta'] }).modelFamily,
  );
});

test('a dated snapshot of one model is the same family as the model', () => {
  assert.equal(
    fingerprint({ models: ['anthropic/claude-x-2026-01-31'] }).modelFamily,
    fingerprint({ models: ['anthropic/claude-x'] }).modelFamily,
  );
});

test('the vendor prefix is part of the family, because vendors differ', () => {
  assert.notEqual(
    fingerprint({ models: ['a/model'] }).modelFamily,
    fingerprint({ models: ['b/model'] }).modelFamily,
  );
});

test('roster ORDER is not part of the family, but roster MEMBERSHIP is', () => {
  assert.equal(
    fingerprint({ models: ['a/one', 'b/two'] }).modelFamily,
    fingerprint({ models: ['b/two', 'a/one'] }).modelFamily,
  );
  assert.notEqual(
    fingerprint({ models: ['a/one', 'b/two'] }).modelFamily,
    fingerprint({ models: ['a/one'] }).modelFamily,
  );
});

/* ---- tool schema --------------------------------------------------------- */

test('a reworded tool description does not drop the cache', () => {
  const before = fingerprint({
    toolSchemas: [{ function: { name: 'web_search', description: 'Search the web.', parameters: { properties: { query: {} } } } }],
  });
  const after = fingerprint({
    toolSchemas: [{ function: { name: 'web_search', description: 'Searches the public web for pages.', parameters: { properties: { query: {} } } } }],
  });
  assert.equal(before.toolSchema, after.toolSchema);
});

test('a new parameter, a renamed tool, or a removed tool DOES change the schema key', () => {
  const one = fingerprint({ toolSchemas: [{ function: { name: 'web_search', parameters: { properties: { query: {} } } } }] });
  const extraParam = fingerprint({ toolSchemas: [{ function: { name: 'web_search', parameters: { properties: { query: {}, region: {} } } } }] });
  const renamed = fingerprint({ toolSchemas: [{ function: { name: 'search_web', parameters: { properties: { query: {} } } } }] });
  const removed = fingerprint({ toolSchemas: [] });

  assert.notEqual(one.toolSchema, extraParam.toolSchema);
  assert.notEqual(one.toolSchema, renamed.toolSchema);
  assert.notEqual(one.toolSchema, removed.toolSchema);
});

test('tool order does not matter, and plain-string schemas are accepted', () => {
  const a = fingerprint({ toolSchemas: ['read_url(id)', 'web_search(query)'] });
  const b = fingerprint({ toolSchemas: ['web_search(query)', 'read_url(id)'] });
  assert.equal(a.toolSchema, b.toolSchema);
});

test('a bare function object without the openai wrapper is read the same way', () => {
  assert.equal(
    fingerprint({ toolSchemas: [{ name: 'read_url', parameters: { properties: { id: {} } } }] }).toolSchema,
    fingerprint({ toolSchemas: ['read_url(id)'] }).toolSchema,
  );
});

test('every part is present with no arguments at all', () => {
  const fp = fingerprint();
  for (const key of ['promptVersion', 'policyVersion', 'modelFamily', 'toolSchema']) {
    assert.match(fp[key], /^[0-9a-f]{12}$/, `${key} must still be a label`);
  }
});

/* ---- retrieval mode ------------------------------------------------------ */

test('retrieval mode names every source that contributed, in a stable order', () => {
  assert.equal(retrievalMode(), 'none');
  assert.equal(retrievalMode({ searched: true }), 'web');
  assert.equal(retrievalMode({ tools: true, searched: true }), 'tools+web');
  assert.equal(retrievalMode({ searched: true, tools: true }), 'tools+web');
  assert.equal(retrievalMode({ tools: true, searched: true, wiki: true, files: true }), 'tools+web+wiki+files');
});

/* The point of the key: an answer read off the open web and one written from
 * the model's own weights are not interchangeable, whatever the words were. */
test('a searched answer and an unsearched one are different cache identities', () => {
  assert.notEqual(retrievalMode({ searched: true }), retrievalMode());
});

/* ---- source freshness ---------------------------------------------------- */

test('no freshness window means evergreen', () => {
  assert.equal(sourceFreshness(null), 'evergreen');
  assert.equal(sourceFreshness(undefined), 'evergreen');
  assert.equal(sourceFreshness(false), 'evergreen');
});

test('a window is carried by its label, from a string or an object', () => {
  assert.equal(sourceFreshness('day'), 'day');
  assert.equal(sourceFreshness({ label: 'week' }), 'week');
});

test('a window with no usable label is still marked as time-sensitive', () => {
  assert.equal(sourceFreshness({}), 'recent');
  assert.equal(sourceFreshness({ label: '' }), 'recent');
  assert.equal(sourceFreshness(true), 'recent');
});

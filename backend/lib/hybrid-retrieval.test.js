'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fuse, lexicalQuery } = require('./hybrid-retrieval');

const rows = (...ids) => ids.map((id) => ({ id, fact: `fact ${id}` }));

/* ---- fusion -------------------------------------------------------------- */

test('a row found by BOTH retrievers outranks one found by either', () => {
  const out = fuse({ vector: rows('a', 'b'), lexical: rows('c', 'b') });
  assert.equal(out[0].row.id, 'b');
  assert.deepEqual(out[0].via, ['vector', 'lexical']);
});

test('order is preserved when only one retriever ran', () => {
  assert.deepEqual(fuse({ vector: rows('a', 'b', 'c') }).map((r) => r.row.id), ['a', 'b', 'c']);
  assert.deepEqual(fuse({ lexical: rows('x', 'y') }).map((r) => r.row.id), ['x', 'y']);
});

/* The hole the second read exists to cover: a row with no vector is invisible
 * to the vector search, and lexical retrieval is how it comes back. */
test('a row only the lexical side can find is still returned', () => {
  const out = fuse({ vector: rows('a'), lexical: rows('unembedded') });
  assert.ok(out.map((r) => r.row.id).includes('unembedded'));
});

test('a duplicate row is one result, not two', () => {
  const out = fuse({ vector: rows('a'), lexical: rows('a') });
  assert.equal(out.length, 1);
});

test('the limit is respected', () => {
  assert.equal(fuse({ vector: rows('a', 'b', 'c', 'd'), limit: 2 }).length, 2);
});

test('weights can favour one retriever without silencing the other', () => {
  const out = fuse({ vector: rows('v'), lexical: rows('l'), weights: { lexical: 5 } });
  assert.equal(out[0].row.id, 'l');
  assert.equal(out.length, 2);
});

/* A small k lets one retriever's top hit win every time, which is what fusion
 * exists to avoid. The default has to keep agreement dominant. */
test('with the default k, agreement beats being first on one side', () => {
  const out = fuse({ vector: rows('first', 'shared'), lexical: rows('other', 'shared') });
  assert.equal(out[0].row.id, 'shared');
});

test('null and malformed entries are skipped rather than ranked', () => {
  const out = fuse({ vector: [null, undefined, ...rows('a')] });
  assert.equal(out.length, 1);
});

test('plain strings work with the default key', () => {
  const out = fuse({ vector: ['one', 'two'], lexical: ['two'] });
  assert.equal(out[0].row, 'two');
});

test('the caller can say what makes two rows the same row', () => {
  const out = fuse({
    vector: [{ pk: 1, text: 'x' }],
    lexical: [{ pk: 1, text: 'x' }],
    keyOf: (r) => String(r.pk),
  });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].via, ['vector', 'lexical']);
});

test('nothing in, nothing out', () => {
  assert.deepEqual(fuse(), []);
  assert.deepEqual(fuse({ vector: [], lexical: [] }), []);
});

/* ---- the lexical query --------------------------------------------------- */

/* The question is not a query: sent whole it ANDs every word and matches
 * nothing on a table of one-sentence facts. */
test('only the rare literal tokens are looked up', () => {
  assert.equal(lexicalQuery('what did I say about AC-4471 last week'), '"AC-4471"');
  assert.match(lexicalQuery('does server.js still call planWork'), /"server\.js"/);
  assert.match(lexicalQuery('are we on v2.14.0 or later'), /"v2\.14\.0"/);
});

test('an ordinary question has no lexical side at all', () => {
  assert.equal(lexicalQuery('what do you remember about me'), '');
  assert.equal(lexicalQuery(''), '');
  assert.equal(lexicalQuery(null), '');
});

/* Requiring every token reproduces the "matches nothing" failure. */
test('several tokens are ORed, not ANDed', () => {
  const q = lexicalQuery('compare AC-4471 with AC-4477');
  assert.match(q, / or /);
  assert.match(q, /"AC-4471"/);
  assert.match(q, /"AC-4477"/);
});

test('a token cannot inject tsquery syntax', () => {
  const q = lexicalQuery('look up AB-1 & CD-2');
  assert.equal(q.includes('&'), false);
});

test('the token count is capped', () => {
  const q = lexicalQuery('AA-1 BB-2 CC-3 DD-4 EE-5 FF-6 GG-7 HH-8', { max: 3 });
  assert.equal(q.split(' or ').length, 3);
});

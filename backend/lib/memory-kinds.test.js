'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyFact, ttlFor, conflictsWith, recallPlan } = require('./memory-kinds');

/* ---- classification ------------------------------------------------------ */

test('an instruction about the ANSWER is a preference', () => {
  for (const fact of [
    'She prefers short answers with no preamble.',
    'They want responses formatted as bullet points.',
    'Never include emoji in a reply to this user.',
    'They always want a code example in the explanation.',
  ]) assert.equal(classifyFact(fact), 'preference', fact);
});

/* "prefers TypeScript" is a fact about the person; "prefers short answers" is
 * an instruction to this system. Without the object test every stated liking
 * became an instruction. */
test('a stated liking about the WORLD is semantic, not a preference', () => {
  assert.equal(classifyFact('They prefer TypeScript over Java.'), 'semantic');
  assert.equal(classifyFact('They like working in the evening.'), 'semantic');
});

test('a command or a workflow is a procedure', () => {
  assert.equal(classifyFact('They deploy with `npm run ship` from the main branch.'), 'procedure');
  assert.equal(classifyFact('Their release process is a tagged commit followed by a manual approval.'), 'procedure');
});

test('something bound to a moment is episodic', () => {
  assert.equal(classifyFact('They asked about the pricing page.'), 'episodic');
  assert.equal(classifyFact('They mentioned a deadline earlier.'), 'episodic');
});

test('an ordinary durable fact is semantic', () => {
  assert.equal(classifyFact('They are a backend engineer at a logistics company in Rotterdam.'), 'semantic');
});

/* A chat-scoped write cannot produce a cross-chat memory, whatever the words
 * look like — migration 001 moved the per-chat summary off `users` for this. */
test('a chat-scoped write is episodic regardless of the text', () => {
  assert.equal(classifyFact('They prefer short answers.', { chatScoped: true }), 'episodic');
  assert.equal(classifyFact('They work in Rust.', { chatScoped: true }), 'episodic');
});

test('empty input classifies without throwing', () => {
  assert.equal(classifyFact(''), 'semantic');
  assert.equal(classifyFact(null), 'semantic');
});

/* ---- expiry -------------------------------------------------------------- */

/* Inventing an expiry for durable facts quietly empties the memory, which is
 * worse than a stale fact: a user can correct a stale fact and cannot notice a
 * missing one. */
test('a durable fact never expires on its own', () => {
  assert.equal(ttlFor('semantic', 'They are a backend engineer.'), null);
  assert.equal(ttlFor('preference', 'They want short answers.'), null);
  assert.equal(ttlFor('procedure', 'They deploy with npm run ship.'), null);
});

test('an episodic memory expires', () => {
  assert.ok(ttlFor('episodic', 'They asked about pricing.') > 0);
});

test('a fact whose own words bound it expires', () => {
  assert.ok(ttlFor('semantic', 'They are on call this week.') > 0);
  assert.ok(ttlFor('semantic', 'They are temporarily working from Berlin.') > 0);
  assert.equal(ttlFor('semantic', 'They work from Berlin.'), null);
});

/* ---- conflicts ----------------------------------------------------------- */

test('two values for the same attribute conflict', () => {
  const found = conflictsWith('They work at Globex as a data engineer.', [
    { fact: 'They work at Acme as a data engineer.' },
  ]);
  assert.equal(found.length, 1);
  assert.equal(found[0].reason, 'value');
});

test('opposite instructions conflict', () => {
  const found = conflictsWith('They do not want code examples in answers.', [
    { fact: 'They want code examples in answers.' },
  ]);
  assert.equal(found.length, 1);
  assert.equal(found[0].reason, 'polarity');
});

test('two different figures for the same thing conflict', () => {
  const found = conflictsWith('Their team has 12 engineers working on the platform.', [
    { fact: 'Their team has 40 engineers working on the platform.' },
  ]);
  assert.equal(found[0].reason, 'value');
});

/* A memory that reports every unrelated pair as conflicting is a memory nobody
 * will let write. */
test('facts about different things do not conflict', () => {
  assert.deepEqual(
    conflictsWith('They work at Globex.', [{ fact: 'They are learning to sail on weekends.' }]),
    [],
  );
});

/* Blocking every restatement of something already known would make the memory
 * unwritable — dedupe is the writer's job, not this one's. */
test('a restatement is a duplicate, not a conflict', () => {
  assert.deepEqual(
    conflictsWith('They work at Acme as a data engineer.', [{ fact: 'They work at Acme as a data engineer.' }]),
    [],
  );
  assert.deepEqual(
    conflictsWith('They want short answers.', [{ fact: 'They want short answers please.' }]),
    [],
  );
});

test('plain strings are accepted alongside rows', () => {
  const found = conflictsWith('They work at Globex as a data engineer.', ['They work at Acme as a data engineer.']);
  assert.equal(found.length, 1);
});

test('empty and malformed inputs produce no conflicts', () => {
  assert.deepEqual(conflictsWith('', [{ fact: 'anything' }]), []);
  assert.deepEqual(conflictsWith('something', [null, undefined, { fact: '  ' }]), []);
  assert.deepEqual(conflictsWith('something'), []);
});

/* ---- the recall plan ----------------------------------------------------- */

/* An instruction that only arrives when it happens to be semantically near the
 * question is an instruction that applies at random. */
test('preferences are recalled in full, never by similarity', () => {
  const preference = recallPlan().find((p) => p.kind === 'preference');
  assert.equal(preference.mode, 'all');
  assert.ok(preference.limit <= 4, 'and capped, because every turn pays for them');
});

test('everything else is recalled by what the turn is about', () => {
  for (const kind of ['semantic', 'procedure']) {
    assert.equal(recallPlan().find((p) => p.kind === kind).mode, 'relevance');
  }
});

test('episodic memory is only asked for inside a chat, and only for that chat', () => {
  assert.equal(recallPlan().some((p) => p.kind === 'episodic'), false);
  const scoped = recallPlan({ chatId: 'chat-1' }).find((p) => p.kind === 'episodic');
  assert.equal(scoped.chatId, 'chat-1');
});

test('no cross-chat plan entry ever carries a chat id', () => {
  for (const entry of recallPlan({ chatId: 'chat-1' })) {
    if (entry.kind !== 'episodic') assert.equal(entry.chatId, null, entry.kind);
  }
});

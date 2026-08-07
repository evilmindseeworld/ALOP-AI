const test = require('node:test');
const assert = require('node:assert');
const { createTtlCache } = require('./ttl-cache');

test('returns a stored value before the ttl elapses', () => {
  const c = createTtlCache({ ttlMs: 1000 });
  c.set('a', { plan: 'pro' });
  assert.deepStrictEqual(c.get('a'), { plan: 'pro' });
});

test('returns undefined once the ttl has elapsed', async () => {
  const c = createTtlCache({ ttlMs: 10 });
  c.set('a', 1);
  await new Promise((r) => setTimeout(r, 25));
  assert.strictEqual(c.get('a'), undefined);
});

test('an expired read drops the entry rather than leaving it to accumulate', async () => {
  const c = createTtlCache({ ttlMs: 10 });
  c.set('a', 1);
  await new Promise((r) => setTimeout(r, 25));
  c.get('a');
  assert.strictEqual(c.size, 0);
});

test('a stored falsy value is still a hit', () => {
  // The suspension check stores a whole row, but the throttle stores nothing
  // meaningful. If a falsy value read as a miss, the throttle would never
  // throttle. undefined is the ONLY miss.
  const c = createTtlCache({ ttlMs: 1000 });
  c.set('a', false);
  assert.strictEqual(c.get('a'), false);
  c.set('b', 0);
  assert.strictEqual(c.get('b'), 0);
});

test('delete removes one key and clear removes all of them', () => {
  const c = createTtlCache({ ttlMs: 1000 });
  c.set('a', 1); c.set('b', 2);
  c.delete('a');
  assert.strictEqual(c.get('a'), undefined);
  assert.strictEqual(c.get('b'), 2);
  c.clear();
  assert.strictEqual(c.get('b'), undefined);
  assert.strictEqual(c.size, 0);
});

test('evicts the oldest entry once maxEntries is exceeded', () => {
  const c = createTtlCache({ ttlMs: 1000, maxEntries: 2 });
  c.set('a', 1); c.set('b', 2); c.set('c', 3);
  assert.strictEqual(c.size, 2);
  assert.strictEqual(c.get('a'), undefined);
  assert.strictEqual(c.get('c'), 3);
});

test('re-setting a key makes it the newest, so eviction does not take the hot one', () => {
  // This is the bug the `store.delete(key)` in `set` exists to prevent: without
  // it, `a` keeps its original position and is evicted while it is the key
  // being written on every request.
  const c = createTtlCache({ ttlMs: 1000, maxEntries: 2 });
  c.set('a', 1); c.set('b', 2);
  c.set('a', 3);
  c.set('c', 4);
  assert.strictEqual(c.get('a'), 3);
  assert.strictEqual(c.get('b'), undefined);
});

test('setIfCurrent stores when no clear has happened since the generation was read', () => {
  const c = createTtlCache({ ttlMs: 1000 });
  const gen = c.generation;
  assert.strictEqual(c.setIfCurrent('a', 1, gen), true);
  assert.strictEqual(c.get('a'), 1);
});

test('setIfCurrent REFUSES a write from a read that a clear overtook', async () => {
  // The security case, written as the sequence it actually occurs in:
  // a request reads the row, an admin suspends the user and clears the cache
  // mid-await, and the older read then tries to cache the pre-suspension row.
  const c = createTtlCache({ ttlMs: 60000 });
  const gen = c.generation;                    // request observes the generation
  const staleRow = { suspended: false };
  await Promise.resolve();                     // ... its select is in flight ...
  c.clear();                                   // admin suspends, invalidates
  assert.strictEqual(c.setIfCurrent('u', staleRow, gen), false);
  assert.strictEqual(c.get('u'), undefined);
});

test('clear bumps the generation and delete does not', () => {
  // delete is used by refreshProfile for its own key and must not invalidate
  // every other request's in-flight read.
  const c = createTtlCache({ ttlMs: 1000 });
  const start = c.generation;
  c.delete('nothing');
  assert.strictEqual(c.generation, start);
  c.clear();
  assert.strictEqual(c.generation, start + 1);
});

test('refuses a ttl that is not a positive number', () => {
  for (const bad of [0, -1, NaN, undefined, 'x']) {
    assert.throws(() => createTtlCache({ ttlMs: bad }), /positive number/);
  }
});

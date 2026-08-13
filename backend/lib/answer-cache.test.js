const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { createAnswerCache, keyFor, normalise, TTL_MS } = require('./answer-cache');

const ANSWER = 'x'.repeat(200); // comfortably over minAnswerChars

/** A clock the test drives, so a seven-day TTL can be tested in a millisecond. */
function fakeClock(start = 1_700_000_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('the basic contract', async (t) => {
  await t.test('a miss is null, not a throw', async () => {
    const c = createAnswerCache();
    assert.equal(await c.get(keyFor({ question: 'anything' })), null);
  });

  await t.test('what goes in comes out', async () => {
    const c = createAnswerCache();
    const k = keyFor({ question: 'what is photosynthesis' });
    c.set(k, ANSWER, TTL_MS.council);
    assert.equal((await c.get(k)).answer, ANSWER);
  });

  await t.test('an expired entry is a miss', async () => {
    const clock = fakeClock();
    const c = createAnswerCache({ now: clock.now });
    const k = keyFor({ question: 'what is photosynthesis' });
    c.set(k, ANSWER, 1000);
    clock.advance(1001);
    assert.equal(await c.get(k), null);
  });

  await t.test('a null key reads and writes nothing', async () => {
    const c = createAnswerCache();
    c.set(null, ANSWER, TTL_MS.council);
    assert.equal(await c.get(null), null);
    assert.equal(c.stats().writes, 0);
  });
});

test('a cold process serves a durable Postgres hit without a model call', async () => {
  const key = keyFor({ question: 'what is photosynthesis' });
  const db = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: () => Promise.resolve({
                  data: {
                    answer: ANSWER,
                    stored_at: new Date(1_700_000_000_000).toISOString(),
                    expires_at: new Date(Date.now() + 60_000).toISOString(),
                  },
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  };

  // No in-process seed exists: this instance was created after a deploy.
  const cold = createAnswerCache({ supabase: db, reportEvery: 0 });
  const hit = await cold.get(key);

  assert.equal(hit.answer, ANSWER);
  assert.equal(cold.stats().hitsL2, 1);
  assert.equal(cold.stats().hitsL1, 0);
});

/**
 * THE FAILURE THIS CACHE COULD CAUSE, and the only one worth writing a lot of
 * tests about: two different questions sharing a key, so one person's answer is
 * served to somebody who asked something else. It has no error and no log line.
 *
 * Every field in `keyFor`'s signature is there because it can change the
 * answer, so every field gets a test that changing it changes the key. If a
 * field is ever added and this file is not, the new input is silently not part
 * of the key — which is the same failure with more steps.
 */
test('every input that changes an answer changes the key', async (t) => {
  const base = { question: 'how much does it cost', lang: 'English', country: 'AE', plan: 'free', detailed: false, branch: 'turn' };
  const variants = {
    question: { question: 'how much does that cost' },
    lang: { lang: 'German' },
    // Shipped as a real bug in search-cache.js: without the country, whoever
    // asked first decided what everyone else was told a thing costs.
    country: { country: 'US' },
    plan: { plan: 'pro' },
    detailed: { detailed: true },
    branch: { branch: 'search' },
  };

  for (const [name, patch] of Object.entries(variants)) {
    await t.test(name, () =>
      assert.notEqual(keyFor(base), keyFor({ ...base, ...patch }), `${name} is not in the key`));
  }
});

test('the key normalises only what makes a question the same question', async (t) => {
  const same = [
    ['case', 'What Is Photosynthesis', 'what is photosynthesis'],
    ['trailing punctuation', 'what is photosynthesis?', 'what is photosynthesis'],
    ['unicode trailing punctuation', 'what is photosynthesis？', 'what is photosynthesis'],
    ['surrounding space', '  what is photosynthesis  ', 'what is photosynthesis'],
    ['runs of space', 'what  is   photosynthesis', 'what is photosynthesis'],
    ['unicode composition', 'Who is Jose\u0301?', 'who is Jos\u00e9'],
  ];
  for (const [name, a, b] of same) {
    await t.test(name, () => assert.equal(keyFor({ question: a }), keyFor({ question: b })));
  }

  /* AND NOTHING ELSE. No stemming, no stopword removal, no synonym folding.
   * Each of those makes two DIFFERENT questions collide, and a collision here
   * does not degrade an answer — it serves the wrong one, confidently. The
   * price of being conservative is a miss, which costs what having no cache
   * costs. */
  const different = [
    ['a negation', 'is it safe', 'is it not safe'],
    ['a different subject', 'what is a cat', 'what is a bat'],
    ['plural', 'what is a monitor', 'what are monitors'],
    ['accents are not stripped', 'qui est Zoe', 'qui est Zoé'],
  ];
  for (const [name, a, b] of different) {
    await t.test(name, () => assert.notEqual(keyFor({ question: a }), keyFor({ question: b })));
  }
});

test('field boundaries cannot be forged from the question text', () => {
  // A plain concatenation would make ("ab","c") and ("a","bc") the same key,
  // and the question is user-controlled text — so the collision would be
  // reachable on purpose, not just by accident.
  assert.notEqual(
    keyFor({ question: 'a b', lang: 'c' }),
    keyFor({ question: 'a', lang: 'b c' }),
  );
});

test('an empty question has no key', () => {
  for (const q of ['', '   ', null, undefined, '???']) {
    assert.equal(keyFor({ question: q }), null, JSON.stringify(q));
  }
});

/**
 * A cached refusal is worse than no cache: a transient failure becomes a
 * permanent one, served instantly, to everybody, for the length of the TTL.
 * The floor lives in the module rather than at each call site, where it would
 * eventually be forgotten by one of them.
 */
test('a short answer is not stored', async () => {
  const c = createAnswerCache();
  const k = keyFor({ question: 'what is photosynthesis' });
  c.set(k, "I searched but couldn't find results. Could you rephrase?", TTL_MS.search);
  assert.equal(await c.get(k), null);
});

test('a non-string answer is not stored', async () => {
  const c = createAnswerCache();
  const k = keyFor({ question: 'what is photosynthesis' });
  for (const bad of [null, undefined, 42, {}, ['a']]) c.set(k, bad, TTL_MS.council);
  assert.equal(await c.get(k), null);
});

test('the memory tier evicts least-recently-used', async () => {
  const c = createAnswerCache({ memoryMax: 2 });
  const [a, b, d] = ['a', 'b', 'c'].map((q) => keyFor({ question: `question ${q}` }));
  c.set(a, ANSWER, TTL_MS.council);
  c.set(b, ANSWER, TTL_MS.council);
  await c.get(a);          // a is now the most recently used
  c.set(d, ANSWER, TTL_MS.council);  // evicts b, not a
  assert.ok(await c.get(a), 'the recently read entry was evicted');
  assert.equal(await c.get(b), null);
});

/**
 * IT NEVER THROWS. This is a cache in front of the whole product: a database
 * that is slow, unreachable, or missing the table entirely must degrade to a
 * miss, which costs exactly what not having the cache costs. Failing a user's
 * question because an optimisation was unavailable would be worse than never
 * having built it.
 */
test('a broken database degrades to a miss', async (t) => {
  const exploding = {
    from() { throw new Error('relation "answer_cache" does not exist'); },
    rpc() { throw new Error('nope'); },
  };
  const quiet = { warn() {} };

  await t.test('a read', async () => {
    const c = createAnswerCache({ supabase: exploding, log: quiet });
    assert.equal(await c.get(keyFor({ question: 'anything at all' })), null);
  });

  await t.test('a write still lands in memory', async () => {
    const c = createAnswerCache({ supabase: exploding, log: quiet });
    const k = keyFor({ question: 'what is photosynthesis' });
    c.set(k, ANSWER, TTL_MS.council);
    assert.equal((await c.get(k)).answer, ANSWER);
  });

  await t.test('and it complains exactly once', async () => {
    const lines = [];
    const c = createAnswerCache({ supabase: exploding, log: { warn: (m) => lines.push(m) } });
    for (let i = 0; i < 5; i++) c.set(keyFor({ question: `question number ${i}` }), ANSWER, TTL_MS.council);
    assert.equal(lines.length, 1);
    // Naming the likely fix is the difference between a useful log line at 3am
    // and one that says only that something is wrong.
    assert.match(lines[0], /015_answer_cache\.sql/);
  });
});

test('the shelf lives are ranked by how fast the facts go stale', () => {
  // Not tuning. An encyclopedia answer is good next week; a search-backed
  // answer carries "as of" dates that age from the moment it is written; an
  // answer to a question that said "right now" ages fastest of all.
  assert.ok(TTL_MS.recent < TTL_MS.search, 'a freshness-window answer must not outlive an ordinary search answer');
  assert.ok(TTL_MS.search < TTL_MS.council, 'a dated search answer must not outlive a council answer');
  assert.equal(TTL_MS.wiki, TTL_MS.council);
});

/**
 * ═════════════════════════════════════════════════════════════════════════
 * THE CROSS-USER GUARANTEE, asserted against server.js AS TEXT.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * This cache is shared across users, which is the whole feature and the whole
 * danger. It is safe only because server.js declines to build a key for a
 * personalised turn — and that decision lives in a file no test can `require`,
 * because server.js calls process.exit(1) at import time when env vars are
 * missing. So it is asserted on the source, the same way the arithmetic fast
 * path's position is. See AGENTS.md.
 *
 * Asserted on PROXIMITY rather than on an exact escaped string, because this
 * fails the next time somebody reflows the line — and a test that fails for
 * formatting gets deleted, taking the guarantee with it.
 */
test('server.js builds no cache key for a personalised turn', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  const gate = src.indexOf('const personalised =');
  assert.ok(gate > 0, 'the personalisation gate is gone; the answer cache is now a cross-user leak');

  const window = src.slice(gate, gate + 400);
  /* Every source of another person's data that reaches a prompt on this route.
   * If a new one is added — a stored preference, a shared document, anything
   * derived from a different turn — it belongs in this list AND in that gate. */
  for (const input of ['histArr', 'convSummary', 'userFacts', 'feedbackGuidance', 'imageContext']) {
    assert.match(window, new RegExp(input), `${input} is not in the personalisation gate`);
  }

  /* And the gate must actually decide the key, not merely be computed.
   * Searched from the gate onwards: `cacheKey` is also the name of the search
   * cache's key 1500 lines above, and indexOf from the top of the file finds
   * that one — a green test measuring an unrelated line. */
  const key = src.indexOf('const cacheKey =', gate);
  assert.ok(key > gate, 'the cache key is built before the gate that is meant to suppress it');
  assert.match(src.slice(key, key + 120), /personalised/);
});

test('the answer cache read runs before the router spends anything', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  const read = src.indexOf('answerCache.get(cacheKey)');
  assert.ok(read > 0, 'nothing reads the answer cache');

  /* A cache consulted after the model calls it exists to avoid still returns
   * the right answer and saves nothing — and no other test in the suite would
   * notice. This is the same guard the arithmetic fast path has, for the same
   * reason. */
  const firstModelCall = Math.min(
    ...['streamModel(res', 'runCouncilWithWhip(', 'runAgentLoop(', 'searchQueryP']
      .map((needle) => { const at = src.indexOf(needle); return at === -1 ? Infinity : at; }),
  );
  assert.ok(read < firstModelCall, 'the answer cache must be read before the first model call');
});

test('a truncated stream cannot become a cached answer', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  /* `streamOnce` since the orchestrator fallback landed: the protocol loop
   * moved there and `streamModel` is now the wrapper that decides whether a
   * failure may be retried. The completion check is still what guards the
   * return, and that is what this test is about. */
  const stream = src.indexOf('const streamOnce');
  const body = src.slice(stream, src.indexOf('const streamModel', stream));

  const throws = body.indexOf('Stream ended before provider completion');
  const returns = body.indexOf('return emitted.join');
  assert.ok(throws > 0 && returns > 0, 'streamModel no longer returns its text; this test needs updating');
  /* The throw has to come FIRST. A stream that ended without the provider's
   * completion signal is a truncated answer, and returning it would let the
   * cache store the half that arrived and serve it for hours. */
  assert.ok(throws < returns, 'streamModel returns its text before checking the stream completed');
});

test('normalise is exported and does only what it says', () => {
  assert.equal(normalise('  What IS  This?? '), 'what is this');
  assert.equal(normalise(null), '');
});

test('a deterministic short constant can be persisted without weakening the answer floor', async () => {
  const c = createAnswerCache();
  const k = keyFor({ question: 'hi', branch: 'greeting' });

  c.set(k, 'Hi!', TTL_MS.council);
  assert.equal(await c.get(k), null, 'ordinary short model output must stay uncached');

  c.setConstant(k, 'Hi!', TTL_MS.greeting);
  assert.equal((await c.get(k)).answer, 'Hi!');
});

test('answer cache emits a periodic hit-rate signal', async () => {
  const lines = [];
  const c = createAnswerCache({ log: { info: (line) => lines.push(line) }, reportEvery: 2 });
  const k = keyFor({ question: 'what is photosynthesis' });
  c.set(k, ANSWER, TTL_MS.council);

  await c.get(k);
  await c.get(keyFor({ question: 'a miss' }));

  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[ANSWERS\] cache stats/);
  assert.match(lines[0], /hitRate=50%/);
});

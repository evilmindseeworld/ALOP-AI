const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { createAnswerCache, keyFor, normalise, ttlFor, TTL_MS } = require('./answer-cache');

const ANSWER = 'x'.repeat(200); // comfortably over minAnswerChars

/** A clock the test drives, so a seven-day TTL can be tested in a millisecond. */
function fakeClock(start = 1_700_000_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

const REPLAY_INPUTS = {
  question: 'what is photosynthesis',
  lang: 'en',
  country: 'AE',
  plan: 'free',
  detailed: false,
  branch: 'council',
  usedLiveWeb: false,
};

const cacheOptions = (ttlMs, patch = {}) => ({
  ttlMs,
  inputs: { ...REPLAY_INPUTS, ...patch },
});

test('the basic contract', async (t) => {
  await t.test('a miss is null, not a throw', async () => {
    const c = createAnswerCache();
    assert.equal(await c.get(keyFor({ question: 'anything' })), null);
  });

  await t.test('what goes in comes out', async () => {
    const c = createAnswerCache();
    const k = keyFor({ question: 'what is photosynthesis' });
    c.set(k, ANSWER, cacheOptions(TTL_MS.council));
    assert.equal((await c.get(k)).answer, ANSWER);
  });

  await t.test('an expired entry is a miss', async () => {
    const clock = fakeClock();
    const c = createAnswerCache({ now: clock.now });
    const k = keyFor({ question: 'what is photosynthesis' });
    c.set(k, ANSWER, cacheOptions(1000));
    clock.advance(1001);
    assert.equal(await c.get(k), null);
  });

  await t.test('a null key reads and writes nothing', async () => {
    const c = createAnswerCache();
    c.set(null, ANSWER, cacheOptions(TTL_MS.council));
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

test('semantic cache matches paraphrases and rejects a genuinely different question', async () => {
  const paraphrase = Array(768).fill(0); paraphrase[0] = 1;
  const different = Array(768).fill(0); different[1] = 1;
  const calls = [];
  const db = {
    rpc(name, args) {
      calls.push({ name, args });
      const sameIntent = args.p_query_embedding.startsWith('[1,');
      return Promise.resolve({
        data: [{
          answer: ANSWER,
          stored_at: new Date(Date.now() - 1000).toISOString(),
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          similarity: sameIntent ? 0.97 : 0.2,
        }],
        error: null,
      });
    },
  };
  const cache = createAnswerCache({ supabase: db, reportEvery: 0 });
  const dimensions = { lang: 'English', country: 'AE', plan: 'free', detailed: false, branch: 'turn:tools-live', threshold: 0.95 };

  const hit = await cache.getSemantic({ embedding: paraphrase, ...dimensions });
  const miss = await cache.getSemantic({ embedding: different, ...dimensions });

  assert.equal(hit.answer, ANSWER);
  assert.equal(hit.similarity, 0.97);
  assert.equal(miss.answer, null);
  assert.equal(miss.similarity, 0.2);
  assert.equal(calls[0].name, 'match_answer_cache');
  assert.deepEqual({ ...calls[0].args, p_query_embedding: '(vector)' }, {
    p_query_embedding: '(vector)', p_lang: 'English', p_country: 'AE', p_plan: 'free',
    p_detailed: false, p_branch: 'turn:tools-live', p_threshold: 0.95,
  });
});

test('semantic cache fails open on invalid vectors and database errors', async () => {
  let calls = 0;
  const cache = createAnswerCache({
    supabase: { rpc: () => { calls++; return Promise.resolve({ data: null, error: { message: 'unavailable' } }); } },
    log: { warn() {} }, reportEvery: 0,
  });
  assert.equal(await cache.getSemantic({ embedding: [1], branch: 'turn' }), null);
  assert.equal(calls, 0);
  assert.equal(await cache.getSemantic({ embedding: Array(768).fill(0), branch: 'turn' }), null);
  assert.equal(calls, 1);
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
  c.set(k, "I searched but couldn't find results. Could you rephrase?", cacheOptions(TTL_MS.search));
  assert.equal(await c.get(k), null);
});

test('a router-confirmed brief answer can be stored without weakening ordinary writes', async () => {
  const c = createAnswerCache();
  const k = keyFor({ question: 'can you use canva' });
  const options = cacheOptions(TTL_MS.stable, { question: 'can you use canva' });
  c.setBrief(k, 'Yes — I can help you create and edit Canva designs.', options);
  assert.match((await c.get(k)).answer, /Canva/);
});

test('a brief refusal is never stored even through the simple-answer path', async () => {
  const c = createAnswerCache();
  const k = keyFor({ question: 'can you use canva' });
  c.setBrief(k, "Sorry, I can't do that. Try again.", cacheOptions(TTL_MS.stable, { question: 'can you use canva' }));
  assert.equal(await c.get(k), null);
});

test('an exact-hit row can be enriched without rewriting its answer or expiry', async () => {
  let update;
  const db = { from: () => ({ update: (value) => ({ eq: (field, key) => { update = { value, field, key }; return Promise.resolve({ error: null }); } }) }) };
  const c = createAnswerCache({ supabase: db, reportEvery: 0 });
  c.enrichEmbedding('cache-key', Array(768).fill(0.01));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(update.field, 'key');
  assert.equal(update.key, 'cache-key');
  assert.match(update.value.embedding, /^\[0\.01,/);
  assert.deepEqual(Object.keys(update.value), ['embedding']);
});

test('a non-string answer is not stored', async () => {
  const c = createAnswerCache();
  const k = keyFor({ question: 'what is photosynthesis' });
  for (const bad of [null, undefined, 42, {}, ['a']]) c.set(k, bad, cacheOptions(TTL_MS.council));
  assert.equal(await c.get(k), null);
});

test('the memory tier evicts least-recently-used', async () => {
  const c = createAnswerCache({ memoryMax: 2 });
  const [a, b, d] = ['a', 'b', 'c'].map((q) => keyFor({ question: `question ${q}` }));
  c.set(a, ANSWER, cacheOptions(TTL_MS.council));
  c.set(b, ANSWER, cacheOptions(TTL_MS.council));
  await c.get(a);          // a is now the most recently used
  c.set(d, ANSWER, cacheOptions(TTL_MS.council));  // evicts b, not a
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
    c.set(k, ANSWER, cacheOptions(TTL_MS.council));
    assert.equal((await c.get(k)).answer, ANSWER);
  });

  await t.test('and it complains exactly once', async () => {
    const lines = [];
    const c = createAnswerCache({ supabase: exploding, log: { warn: (m) => lines.push(m) } });
    for (let i = 0; i < 5; i++) c.set(keyFor({ question: `question number ${i}` }), ANSWER, cacheOptions(TTL_MS.council));
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
test('server.js bypasses shared cache for conversation history, not stored profile facts', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  const gate = src.indexOf('const personalised =');
  assert.ok(gate > 0, 'the personalisation gate is gone; the answer cache is now a cross-user leak');

  const window = src.slice(gate, gate + 400);
  assert.match(window, /hasConversationHistory/);
  assert.doesNotMatch(window, /userFacts|feedbackGuidance/,
    'stored profile facts must not disable caching for standalone factual questions');

  /* And the gate must actually decide the key, not merely be computed.
   * Searched from the gate onwards: `cacheKey` is also the name of the search
   * cache's key 1500 lines above, and indexOf from the top of the file finds
   * that one — a green test measuring an unrelated line. */
  const key = src.indexOf('const cacheKey =', gate);
  assert.ok(key > gate, 'the cache key is built before the gate that is meant to suppress it');
  assert.match(src.slice(key, key + 120), /personalised/);
});

test('cacheable standalone prompts do not inject profile context into shared answers', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const context = src.indexOf('const contextMsgs =');
  assert.ok(context > 0, 'context message construction is gone');
  const window = src.slice(context - 700, context + 700);
  assert.match(window, /profileContextAllowed\s*=\s*hasConversationHistory/);
  assert.match(window, /profileContextAllowed\s*&&\s*userFacts\.length/);
  assert.match(window, /profileContextAllowed\s*&&\s*feedbackGuidance/);
});

test('server.js logs cache hit, miss, and personalised bypass distinctly', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /\[ANSWERS\] HIT ageMin=/);
  assert.match(src, /\[ANSWERS\] MISS/);
  assert.match(src, /\[ANSWERS\] BYPASS personalised-context/);
  assert.match(src, /\[ANSWERS\] SEMANTIC HIT similarity=.*models=0/);
  assert.match(src, /\[ANSWERS\] SEMANTIC MISS similarity=/);
  assert.match(src, /\[ANSWERS\] EMBEDDING/);
  assert.match(src, /COUNCIL_SEMANTIC_CACHE/);
  assert.match(src, /selection\.complexity === 'simple'.*setBrief/s);
  assert.match(src, /persist\(null\).*durableQuestionEmbeddingP\.then/s);
  assert.match(src, /durableQuestionEmbeddingP = SEMANTIC_CACHE_ENABLED[\s\S]*embedAnswerText\(normaliseAnswerQuestion\(pv\.value\)\)/);
  assert.doesNotMatch(src, /durableQuestionEmbeddingP[\s\S]{0,200}turnSignal/);
  assert.match(src, /durableQuestionEmbeddingP\.then\(\(embedding\) => answerCache\.enrichEmbedding\(cacheKey, embedding\)\)/);
});

test('018 returns the nearest eligible row so misses have a diagnostic similarity', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '018_answer_cache_similarity_diagnostics.sql'), 'utf8');
  assert.match(sql, /ORDER BY ac\.embedding OPERATOR\(public\.<=>\) p_query_embedding/i);
  assert.doesNotMatch(sql, /similarity\s*>?=\s*p_threshold/i);
  for (const field of ['lang', 'country', 'plan', 'detailed', 'branch']) {
    assert.match(sql, new RegExp(`ac\\.${field} IS NOT DISTINCT FROM p_${field}`, 'i'));
  }
});

test('017 matches vectors only inside every answer-changing dimension', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '017_answer_cache_embeddings.sql'), 'utf8');
  assert.match(sql, /embedding public\.vector\(768\)/i);
  assert.match(sql, /embedding OPERATOR\(public\.<=>\) p_query_embedding/);
  assert.match(sql, /expires_at > NOW\(\)/i);
  for (const field of ['lang', 'country', 'plan', 'detailed', 'branch']) {
    assert.match(sql, new RegExp(`ac\\.${field} IS NOT DISTINCT FROM p_${field}`, 'i'), field);
  }
  assert.match(sql, />= p_threshold/);
  assert.match(sql, /SECURITY INVOKER/i);
  assert.match(sql, /REVOKE ALL[\s\S]*FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /GRANT EXECUTE[\s\S]*TO service_role/i);
});

test('the answer cache read runs before the router spends anything', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  const read = src.indexOf('answerCache.get(cacheKey,');
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

test('server.js separates durable answers produced by different tool modes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const mode = src.indexOf('const ANSWER_EXECUTION_MODE =');
  const branch = src.indexOf('const ANSWER_CACHE_BRANCH = `turn:${ANSWER_EXECUTION_MODE}`');
  const key = src.indexOf('branch: ANSWER_CACHE_BRANCH');
  assert.ok(mode > 0, 'tool execution mode is absent from answer-cache identity');
  assert.ok(branch > mode, 'the tool mode does not produce one shared cache branch');
  assert.ok(key > mode, 'the computed tool mode does not reach the answer-cache key');
  for (const flag of ['SEEDED_SEARCH', 'TOOLS_ENABLED', 'TOOLS_SHADOW']) {
    assert.match(src.slice(mode, branch), new RegExp(flag), `${flag} does not affect cache identity`);
  }
});

test('a deterministic short constant can be persisted without weakening the answer floor', async () => {
  const c = createAnswerCache();
  const k = keyFor({ question: 'hi', branch: 'greeting' });

  c.set(k, 'Hi!', cacheOptions(TTL_MS.council, { question: 'hi', branch: 'greeting' }));
  assert.equal(await c.get(k), null, 'ordinary short model output must stay uncached');

  c.setConstant(k, 'Hi!', cacheOptions(TTL_MS.greeting, { question: 'hi', branch: 'greeting' }));
  assert.equal((await c.get(k)).answer, 'Hi!');
});

test('answer cache emits a periodic hit-rate signal', async () => {
  const lines = [];
  const c = createAnswerCache({ log: { info: (line) => lines.push(line) }, reportEvery: 2 });
  const k = keyFor({ question: 'what is photosynthesis' });
  c.set(k, ANSWER, cacheOptions(TTL_MS.council));

  await c.get(k);
  await c.get(keyFor({ question: 'a miss' }));

  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[ANSWERS\] cache stats/);
  assert.match(lines[0], /hitRate=50%/);
});


// ===== shelf life by provenance =====
//
// An answer that never touched the live web does not go stale, and re-earning
// it every week spent model requests out of an account-wide daily budget for
// nothing. The rule lives in one function so the four write sites in server.js
// cannot drift apart from each other.

test('an answer that did not search does not expire on a weekly clock', () => {
  const DAY = 24 * 60 * 60 * 1000;
  assert.strictEqual(ttlFor({ searched: false }), TTL_MS.stable);
  assert.ok(ttlFor({ searched: false }) >= 100 * 365 * DAY, 'the stable tier must have no routine expiry');
  // `fresh` is meaningless without a search and must not shorten a stable answer.
  assert.strictEqual(ttlFor({ searched: false, fresh: true }), TTL_MS.stable);
  // The default is the SAFE direction only because the caller always passes the
  // router's decision; assert it anyway so a missing argument is visible.
  assert.strictEqual(ttlFor({}), TTL_MS.stable);
});

test('a search-backed answer gets a day, and a freshness window gets an hour', () => {
  const DAY = 24 * 60 * 60 * 1000;
  assert.strictEqual(ttlFor({ searched: true }), DAY);
  assert.strictEqual(ttlFor({ searched: true, fresh: true }), 60 * 60 * 1000);
  assert.ok(ttlFor({ searched: true, fresh: true }) < ttlFor({ searched: true }),
    'a question that said the present matters must not outlive an ordinary search answer');
  assert.ok(ttlFor({ searched: true }) < ttlFor({ searched: false }),
    'a dated answer must never outlive an undated one');
});

test('a stable answer survives long past the old weekly ceiling', () => {
  const clock = fakeClock();
  const cache = createAnswerCache({ now: clock.now, reportEvery: 0 });
  const key = keyFor({ question: 'what is a monad' });
  cache.set(key, ANSWER, cacheOptions(ttlFor({ searched: false })));

  clock.advance(30 * 24 * 60 * 60 * 1000);
  return cache.get(key).then((hit) => {
    assert.ok(hit, 'a month-old answer to a question with no live facts in it was thrown away');
    assert.strictEqual(hit.answer, ANSWER);
  });
});

test('a search-backed answer is gone a day later', () => {
  const clock = fakeClock();
  const cache = createAnswerCache({ now: clock.now, reportEvery: 0 });
  const key = keyFor({ question: 'what does a canva pro seat cost', branch: 'search' });
  cache.set(key, ANSWER, cacheOptions(ttlFor({ searched: true }), { branch: 'search', usedLiveWeb: true }));

  clock.advance(24 * 60 * 60 * 1000 + 1);
  return cache.get(key).then((hit) => {
    assert.strictEqual(hit, null, 'a dated answer outlived its day');
  });
});

test('new writes persist the exact replay inputs', async () => {
  const writes = [];
  const db = {
    from() {
      return {
        upsert(payload) { writes.push(payload); return Promise.resolve({ error: null }); },
      };
    },
  };
  const inputs = {
    question: 'What is the weather?',
    lang: 'en',
    country: 'AE',
    plan: 'free',
    detailed: true,
    branch: 'search',
    usedLiveWeb: true,
  };
  const embedding = Array(768).fill(0); embedding[0] = 1;
  const c = createAnswerCache({ supabase: db, reportEvery: 0 });
  c.set(keyFor(inputs), ANSWER, { ttlMs: TTL_MS.search, inputs, embedding });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(writes.length, 1);
  assert.match(writes[0].embedding, /^\[1,0,0,/);
  assert.deepEqual(
    Object.fromEntries(Object.entries(writes[0]).filter(([key]) => key.endsWith('_text') ||
      ['lang', 'country', 'plan', 'detailed', 'branch', 'used_live_web'].includes(key))),
    {
      question_text: inputs.question,
      lang: inputs.lang,
      country: inputs.country,
      plan: inputs.plan,
      detailed: inputs.detailed,
      branch: inputs.branch,
      used_live_web: inputs.usedLiveWeb,
    },
  );
});

test('a write without complete replay inputs changes neither tier', async () => {
  const writes = [];
  const db = {
    from() {
      return {
        upsert(payload) { writes.push(payload); return Promise.resolve({ error: null }); },
      };
    },
  };
  const c = createAnswerCache({ supabase: db, reportEvery: 0 });
  const key = keyFor({ question: 'what is photosynthesis' });
  c.set(key, ANSWER, { ttlMs: TTL_MS.search });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(await c.get(key), null);
  assert.equal(writes.length, 0);
  assert.equal(c.stats().writes, 0);
});

test('dueForRefresh returns only future search-backed rows with replay inputs', async () => {
  const calls = [];
  const due = {
    key: 'due-key',
    answer: ANSWER,
    stored_at: '2026-08-14T00:00:00.000Z',
    expires_at: '2026-08-14T01:00:00.000Z',
    question_text: 'what is the weather?',
    lang: 'en',
    country: 'AE',
    plan: 'free',
    detailed: false,
    branch: 'search',
    used_live_web: true,
  };
  const legacy = { ...due, key: 'legacy-key', question_text: null };
  const db = {
    from(table) {
      calls.push(table);
      return {
        select(fields) {
          calls.push(fields);
          return {
            eq(field, value) {
              calls.push(['eq', field, value]);
              return this;
            },
            gt(field, value) {
              calls.push(['gt', field, value]);
              return this;
            },
            lte(field, value) {
              calls.push(['lte', field, value]);
              return this;
            },
            order(field, options) {
              calls.push(['order', field, options]);
              return {
                limit(value) {
                  calls.push(['limit', value]);
                  return Promise.resolve({ data: [due, legacy], error: null });
                },
              };
            },
          };
        },
      };
    },
  };
  const c = createAnswerCache({ supabase: db, now: () => Date.parse('2026-08-14T00:00:00.000Z'), reportEvery: 0 });
  const rows = await c.dueForRefresh({
    before: Date.parse('2026-08-14T02:00:00.000Z'),
    limit: 4,
  });

  assert.deepEqual(rows, [{
    key: due.key,
    answer: due.answer,
    question: due.question_text,
    lang: due.lang,
    country: due.country,
    plan: due.plan,
    detailed: due.detailed,
    branch: due.branch,
    searched: due.used_live_web,
    storedAt: Date.parse(due.stored_at),
    expiresAt: Date.parse(due.expires_at),
  }]);
  assert.ok(calls.includes('answer_cache'));
  assert.ok(calls.some((call) => call[0] === 'eq' && call[1] === 'used_live_web' && call[2] === true));
});

test('016 documents the user-derived question-text and search-expiry index boundary', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '016_answer_cache_inputs.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS question_text TEXT/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS used_live_web BOOLEAN/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS answer_cache_search_expiry/);
  assert.match(sql, /WHERE used_live_web IS TRUE/);
  assert.match(sql, /user-derived QUESTION TEXT/i);
  assert.match(sql, /non-personalised|non-personalized/i);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
});

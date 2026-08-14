const crypto = require('node:crypto');
const { settleByDeadline } = require('./deadline');

/**
 * A cache of finished ANSWERS, not of search results.
 *
 * WHY IT EXISTS. The owner asked the same monitor question twice — "is the
 * PG27UCWM's tandem RGB OLED actually brighter than a QD-OLED" — and paid for
 * it twice: two router calls, a five-provider search fan-out, three page reads
 * and a streamed extraction, for an answer this system had already written. At
 * fifty OpenRouter requests per UTC DAY shared across every user, a repeated
 * question is not a latency problem, it is a rationing problem.
 *
 * `search-cache.js` already stores the search half and this deliberately does
 * not replace it: that one saves a fan-out and still spends every model
 * request, which is the resource that actually binds. The two stack — a miss
 * here can still hit there.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ONE RULE: A CACHED ANSWER MUST BE A PURE FUNCTION OF ITS KEY.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This cache is SHARED ACROSS USERS, because the owner asked for exactly that
 * ("the moment I ask it again or any user"), and cross-user sharing is the
 * whole value — the second person to ask a popular question pays nothing. It is
 * also the whole danger. An answer built from one person's conversation
 * summary, stored facts, uploaded file or attached image is ABOUT THAT PERSON,
 * and replaying it to a stranger is a data leak dressed as a cache hit. There
 * would be no error, no log line and no way for either user to tell.
 *
 * So the caller must decide cacheability and this module cannot check it. What
 * this module does instead is refuse to make the decision implicitly: `keyFor`
 * takes every input that can change an answer as a named argument, and anything
 * not in that list must have been excluded by the caller. The named arguments
 * are the contract, and the reason each one is there:
 *
 *   question  — obviously.
 *   lang      — the same question answered in German is a different answer.
 *   country   — "what does it cost" is region-scoped, and a cache that ignored
 *               this would let whoever asked first decide what everyone else is
 *               told a thing costs. `search-cache.js` shipped that exact bug
 *               and was fixed the same way.
 *   plan      — free and pro get different rosters and different lengths.
 *   detailed  — "explain in detail" and the bare question are different asks.
 *   branch    — a search-backed answer and a council answer to the same words
 *               have different provenance and different shelf lives.
 *
 * WHAT THE CALLER MUST EXCLUDE, and it is not optional: conversation history,
 * the chat summary, stored user facts, learned feedback preferences, attached
 * images and attached files. If any of those reached the prompt, the turn is
 * not cacheable and no key should be built for it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Everything else is `search-cache.js`'s shape, for the reasons written there:
 * two tiers (a Map that dies with the process, Postgres that survives a
 * deploy), it NEVER throws, reads are on a short leash, and writes are never
 * awaited. A cache that can fail a question is worse than no cache.
 */

const DEFAULTS = {
  memoryMax: 300,
  /* Shorter than the search cache's 400ms. That leash is set against a 3500ms
   * fan-out; this read sits in front of a whole turn but runs BEFORE the user
   * has seen anything at all, so every millisecond of it is dead air on the
   * miss path — which is most turns, and will stay most turns. */
  readDeadlineMs: 250,
  sweepEveryWrites: 50,
  /* An answer shorter than this is a refusal, an error sentence or a stub
   * ("I couldn't find results. Could you rephrase?"). Caching one turns a
   * transient failure into a permanent one, served instantly, to everybody.
   * That is the single worst thing this file could do, so the floor is here
   * rather than at each call site where it would eventually be forgotten. */
  minAnswerChars: 120,
  /* One line per hundred lookups gives a tuning signal without turning a
   * popular question into a log flood. Set to 0 in tests or a quiet deploy. */
  reportEvery: 100,
  semanticReadDeadlineMs: 500,
};

const EMBEDDING_DIMS = 768;
const validEmbedding = (value) => Array.isArray(value) && value.length === EMBEDDING_DIMS &&
  value.every((n) => typeof n === 'number' && Number.isFinite(n));
const vectorLiteral = (value) => validEmbedding(value) ? `[${value.join(',')}]` : null;

/**
 * HOW LONG AN ANSWER STAYS TRUE, by where it came from.
 *
 * These are shelf lives, not performance tuning, and the ranking is the
 * argument: an encyclopedia answer about the Ottoman Empire is good next week;
 * a search-backed answer about a monitor's brightness carries "as of" dates
 * that start ageing the moment it is written. A single TTL would have to be the
 * shortest of these for safety, which would throw away most of the value.
 *
 * `search` is six hours rather than a day because the search branch is the one
 * that reports prices, versions and rankings. `recent` is what a question with
 * an explicit freshness window ("right now", "this week") gets: an hour, which
 * is short enough to be honest and long enough to absorb a burst of people
 * asking the same thing about the same news.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_MS = {
  /* AN ANSWER THAT DID NOT COME FROM THE LIVE WEB DOES NOT GO STALE, so this is
   * a safety net rather than a shelf life. It was seven days, which threw away
   * most of the cache's value for nothing: "what is a monad" and "can you access
   * Canva" are the same answer next month, and re-earning them every week costs
   * model requests out of an account-wide daily budget.
   *
   * Ninety days rather than never, because the answer is not a pure function of
   * the question alone in practice — the prompts, the roster and the product all
   * change, and a row with no expiry would outlive the system that wrote it with
   * nothing to notice. `clear()` remains the lever for an intentional
   * invalidation; this is the one for the unintentional kind. */
  /* Postgres requires expires_at, so "no routine expiry" is represented by a
   * century-long safety sentinel rather than nullable timestamp semantics. */
  stable: 100 * 365 * DAY_MS,
  /* A DAY, up from six hours, at the owner's instruction and on the strength of
   * the refresh job: a search answer that is about to expire is rewritten before
   * anyone asks for it, so the TTL bounds how stale a row can get when the job
   * is NOT running rather than how often the answer is re-earned. */
  search: DAY_MS,
  /* A question with an explicit freshness window — "right now", "this week" —
   * is deliberately NOT given the search tier. An hour-old answer to "what
   * happened today" is defensible; a day-old one presented as current is not,
   * and no refresh job can make it true in between. */
  recent: 60 * 60 * 1000,
  /* Greetings are constants, so their durable seed can live for a year. */
  greeting: 365 * DAY_MS,
};
TTL_MS.council = TTL_MS.stable;
TTL_MS.wiki = TTL_MS.stable;

/* These are stored beside the answer so a service job can ask the same
 * question again. They are deliberately a named object rather than more
 * positional arguments: omitting one must reject the write, not create a row
 * that looks refreshable until the brain tries to use it. */
const REPLAY_INPUTS = Object.freeze([
  'question', 'lang', 'country', 'plan', 'detailed', 'branch', 'usedLiveWeb',
]);

/**
 * THE SHELF LIFE, DECIDED BY WHERE THE FACTS CAME FROM.
 *
 * One function so the four call sites in server.js cannot drift apart, and so
 * the rule is testable without a server: no live web, no expiry worth the name.
 *
 * @param {boolean} searched  whether the answer used the live web. This is the
 *   router's own search decision, not a guess made at the write site.
 * @param {boolean} fresh  whether the question named a freshness window.
 */
function ttlFor({ searched = false, fresh = false } = {}) {
  if (!searched) return TTL_MS.stable;
  return fresh ? TTL_MS.recent : TTL_MS.search;
}

/**
 * The question, reduced to what makes it the same question.
 *
 * Case, surrounding whitespace, runs of spaces and trailing Unicode
 * punctuation only.
 * NOTHING ELSE — no stemming, no stopword removal, no synonym folding. Every
 * one of those makes two DIFFERENT questions collide, and a collision here does
 * not degrade an answer, it serves the wrong one with total confidence. The
 * cost of being conservative is a miss, which costs exactly what not having a
 * cache costs.
 *
 * Unicode NFC so that two encodings of the same accented string agree; not
 * NFKD, which would strip the accents and merge words that differ by them.
 */
const normalise = (q) =>
  String(q || '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[\p{P}\s]+$/u, '');

/**
 * @param {object} parts every input that can change the answer. See the header:
 *   the argument list IS the cacheability contract.
 * @returns {string|null} null when there is nothing worth keying on.
 */
function keyFor({ question, lang = '', country = '', plan = '', detailed = false, branch = '' } = {}) {
  const text = normalise(question);
  if (!text) return null;
  /* Joined with a character no field can contain, so ("ab", "c") and ("a",
   * "bc") cannot produce one key. A plain concatenation would make that
   * collision reachable from user-controlled text. */
  const material = [text, lang, country, plan, detailed ? 'd' : '', branch].join('\u0000');
  return crypto.createHash('sha256').update(material).digest('hex');
}

function replayInputs(inputs) {
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return null;
  if (!REPLAY_INPUTS.every((field) => Object.prototype.hasOwnProperty.call(inputs, field))) return null;
  if (typeof inputs.question !== 'string' || !inputs.question.trim()) return null;
  if (typeof inputs.lang !== 'string' || typeof inputs.country !== 'string' ||
      typeof inputs.plan !== 'string' || typeof inputs.branch !== 'string' ||
      !inputs.branch.trim() || typeof inputs.detailed !== 'boolean' ||
      typeof inputs.usedLiveWeb !== 'boolean') return null;

  return {
    question: inputs.question,
    lang: inputs.lang,
    country: inputs.country,
    plan: inputs.plan,
    detailed: inputs.detailed,
    branch: inputs.branch,
    usedLiveWeb: inputs.usedLiveWeb,
  };
}

const rowInputs = (row) => replayInputs({
  question: row.question_text,
  lang: row.lang,
  country: row.country,
  plan: row.plan,
  detailed: row.detailed,
  branch: row.branch,
  usedLiveWeb: row.used_live_web,
});

function createAnswerCache({ supabase, log = console, ...opts } = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const now = opts.now || (() => Date.now());
  const memory = new Map();
  let writesSinceSweep = 0;
  const stats = { lookups: 0, hitsL1: 0, hitsL2: 0, semanticLookups: 0, semanticHits: 0, misses: 0, errors: 0, writes: 0 };

  const report = () => {
    const every = Number(cfg.reportEvery);
    if (!(every > 0) || stats.lookups % every !== 0) return;
    const hits = stats.hitsL1 + stats.hitsL2 + stats.semanticHits;
    const hitRate = Math.round((hits / stats.lookups) * 100);
    try {
      log.info?.(
        '[ANSWERS] cache stats lookups=' + stats.lookups +
        ' hits=' + hits + ' misses=' + stats.misses +
        ' hitRate=' + hitRate + '% l1=' + stats.hitsL1 +
        ' l2=' + stats.hitsL2 + ' semanticHits=' + stats.semanticHits + ' writes=' + stats.writes,
      );
    } catch {
      // Telemetry must never turn a cache optimisation into a failed question.
    }
  };

  /* Reported ONCE, naming the fix. The overwhelmingly likely cause is
   * migration 015 not being applied, which fails identically on every single
   * turn — one line per request would drown the log, and no line at all makes a
   * cache that has silently stopped persisting look exactly like one that is
   * working. See the same argument in search-cache.js. */
  let warned = false;
  const warnOnce = (what, message) => {
    stats.errors++;
    if (warned) return;
    warned = true;
    log.warn?.(
      `[ANSWERS] ${what}: ${message}. Falling back to the in-process cache only ` +
      `(this is not fatal, and answers are still correct — they are just recomputed ` +
      `after a redeploy). If this is "relation ... does not exist", apply ` +
      `migrations/015_answer_cache.sql. Further errors are not logged.`,
    );
  };

  const readMemory = (key) => {
    const entry = memory.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now()) { memory.delete(key); return null; }
    // Re-insert to move the key to the end of the Map's iteration order, which
    // is what makes the eviction below LRU rather than insertion-order.
    memory.delete(key);
    memory.set(key, entry);
    return entry;
  };

  const writeMemory = (key, entry) => {
    if (memory.has(key)) memory.delete(key);
    memory.set(key, entry);
    while (memory.size > cfg.memoryMax) memory.delete(memory.keys().next().value);
  };

  const sweep = () => {
    if (!supabase) return;
    if (++writesSinceSweep < cfg.sweepEveryWrites) return;
    writesSinceSweep = 0;
    try {
      Promise.resolve(supabase.rpc('sweep_answer_cache')).catch(() => {});
    } catch (e) {
      warnOnce('sweep threw', e.message);
    }
  };

  /**
   * @returns {Promise<{answer: string, storedAt: number}|null>}
   */
  async function get(key, { deferMiss = false } = {}) {
    stats.lookups++;
    try {
      if (!key) return null;

      const local = readMemory(key);
      if (local) { stats.hitsL1++; return { answer: local.answer, storedAt: local.storedAt }; }

      if (!supabase) { if (!deferMiss) stats.misses++; return null; }

    /* On the leash, and a slow database is a MISS rather than a delay. The read
     * sits in front of the whole turn, so waiting on it costs the user directly
     * — and the fallback, recomputing the answer, is what would have happened
     * without this cache at all. */
      const row = await settleByDeadline(
        [{
          promise: (async () => {
            const { data, error } = await supabase
              .from('answer_cache')
              .select('answer, stored_at, expires_at')
              .eq('key', key)
              .maybeSingle();
            if (error) { warnOnce('read failed', error.message); return null; }
            return data || null;
          })(),
          fallback: null,
        }],
        { deadlineMs: cfg.readDeadlineMs },
      ).then((r) => r.results[0]).catch((e) => { warnOnce('read threw', e.message); return null; });

      if (!row) { if (!deferMiss) stats.misses++; return null; }

      const expiresAt = new Date(row.expires_at).getTime();
      if (!Number.isFinite(expiresAt) || expiresAt <= now()) { if (!deferMiss) stats.misses++; return null; }

      const storedAt = new Date(row.stored_at).getTime();
      stats.hitsL2++;
      // Promote, so the next asker on this instance does not pay the round trip.
      writeMemory(key, { answer: row.answer, storedAt, expiresAt });
      return { answer: row.answer, storedAt };
    } finally {
      if (!deferMiss) report();
    }
  }

  /** Best unexpired semantic match within the exact answer-changing dimensions. */
  async function getSemantic({ embedding, lang = '', country = '', plan = '', detailed = false,
    branch = '', threshold = 0.84 } = {}) {
    const literal = vectorLiteral(embedding);
    const cutoff = Number(threshold);
    stats.semanticLookups++;
    let hit = false;
    try {
      if (!supabase || !literal || !branch || !Number.isFinite(cutoff) || cutoff < 0 || cutoff > 1) return null;
      const result = await settleByDeadline([{
        promise: Promise.resolve(supabase.rpc('match_answer_cache', {
          p_query_embedding: literal,
          p_lang: String(lang),
          p_country: String(country),
          p_plan: String(plan),
          p_detailed: Boolean(detailed),
          p_branch: String(branch),
          p_threshold: cutoff,
        })),
        fallback: { data: [], error: null },
      }], { deadlineMs: cfg.semanticReadDeadlineMs }).then((r) => r.results[0]);
      if (!result || result.error) {
        if (result?.error) warnOnce('semantic read failed', result.error.message);
        return null;
      }
      const row = Array.isArray(result.data) ? result.data[0] : null;
      const similarity = Number(row?.similarity);
      const expiresAt = new Date(row?.expires_at).getTime();
      const storedAt = new Date(row?.stored_at).getTime();
      if (!row || !Number.isFinite(similarity)) return null;
      if (similarity < cutoff) return { answer: null, storedAt: null, similarity };
      if (typeof row.answer !== 'string' || !Number.isFinite(expiresAt) || expiresAt <= now() ||
          !Number.isFinite(storedAt)) return null;
      stats.semanticHits++;
      hit = true;
      return { answer: row.answer, storedAt, similarity };
    } catch (e) {
      warnOnce('semantic read threw', e.message);
      return null;
    } finally {
      if (!hit) stats.misses++;
      report();
    }
  }

  /**
   * Never awaited by the caller and never throws. The answer has already been
   * streamed to the user by the time this runs; nothing about their turn
   * depends on it landing.
   */
  function store(key, answer, options, allowShort) {
    if (!key || typeof answer !== 'string') return;
    if (!options || typeof options !== 'object' || Array.isArray(options)) return;
    const inputs = replayInputs(options.inputs);
    if (!inputs) {
      /* A missing replay contract is not safe to put in either tier. In
       * particular, do not put it in memory and then leave Postgres without a
       * corresponding row: the two tiers must represent the same cacheable
       * answer. The caller still gets its answer; only the optimisation is
       * declined. */
      return;
    }
    const text = answer.trim();
    if (!text || (!allowShort && text.length < cfg.minAnswerChars)) return;
    const ttl = Number(options.ttlMs) > 0 ? Number(options.ttlMs) : TTL_MS.council;

    const storedAt = now();
    const expiresAt = storedAt + ttl;
    writeMemory(key, { answer: text, storedAt, expiresAt });
    stats.writes++;

    if (!supabase) return;
    try {
      Promise.resolve(
        supabase.from('answer_cache').upsert(
          {
            key,
            answer: text,
            stored_at: new Date(storedAt).toISOString(),
            expires_at: new Date(expiresAt).toISOString(),
            question_text: inputs.question,
            lang: inputs.lang,
            country: inputs.country,
            plan: inputs.plan,
            detailed: inputs.detailed,
            branch: inputs.branch,
            used_live_web: inputs.usedLiveWeb,
            ...(vectorLiteral(options.embedding) ? { embedding: vectorLiteral(options.embedding) } : {}),
          },
          { onConflict: 'key' },
        ),
      ).then((r) => { if (r?.error) warnOnce('write failed', r.error.message); })
        .catch((e) => warnOnce('write threw', e.message));
    } catch (e) {
      warnOnce('write threw', e.message);
    }
    sweep();
  }

  function set(key, answer, options) {
    store(key, answer, options, false);
  }

  /** A router-confirmed simple answer may be useful while still being brief. */
  function setBrief(key, answer, options) {
    const text = typeof answer === 'string' ? answer.trim() : '';
    if (text.length < 20 || /\b(?:error|failed|try again|rephrase)\b/i.test(text) ||
        /\b(?:sorry|couldn't)\b[^.]{0,50}\b(?:find|complete|answer|help)\b/i.test(text)) return;
    store(key, answer, options, true);
  }

  /** Backfill a vector on an exact-hit row without changing its answer or TTL. */
  function enrichEmbedding(key, embedding) {
    const literal = vectorLiteral(embedding);
    if (!supabase || !key || !literal) return;
    try {
      Promise.resolve(supabase.from('answer_cache').update({ embedding: literal }).eq('key', key))
        .then((r) => { if (r?.error) warnOnce('embedding backfill failed', r.error.message); })
        .catch((e) => warnOnce('embedding backfill threw', e.message));
    } catch (e) { warnOnce('embedding backfill threw', e.message); }
  }

  /**
   * Persist a known constant such as a greeting. This is separate from set()
   * so a short model refusal can never bypass the minimum-answer safeguard.
   */
  function setConstant(key, answer, options) {
    store(key, answer, {
      ...(options && typeof options === 'object' ? options : {}),
      ttlMs: options?.ttlMs ?? TTL_MS.greeting,
    }, true);
  }

  /**
   * Return future search-backed rows that are safe for the brain to replay.
   * `before` is the end of the caller's refresh window; rows already expired
   * are excluded here. Rows from before migration 016 have null inputs and
   * are intentionally skipped rather than guessed at.
   *
   * This is a backend/service-role API by construction: the only database
   * handle accepted by this module is the server's Supabase service-role
   * client, and no user-controlled filter is accepted.
   *
   * @returns {Promise<Array<{key: string, answer: string, question: string,
   *   lang: string, country: string, plan: string, detailed: boolean,
   *   branch: string, searched: boolean, storedAt: number,
   *   expiresAt: number}>>}
   */
  async function dueForRefresh({ before, limit = 50, branch } = {}) {
    const endMs = Number(before);
    const rowLimit = Number.isInteger(Number(limit)) ? Number(limit) : 50;
    if (!supabase || !Number.isFinite(endMs) || endMs <= now() || rowLimit <= 0) return [];

    const startMs = now();
    try {
      const result = await settleByDeadline(
        [{
          promise: (async () => {
            let query = supabase
              .from('answer_cache')
              .select('key, answer, stored_at, expires_at, question_text, lang, country, plan, detailed, branch, used_live_web')
              .eq('used_live_web', true)
              .gt('expires_at', new Date(startMs).toISOString())
              .lte('expires_at', new Date(endMs).toISOString());
            if (typeof branch === 'string' && branch) query = query.eq('branch', branch);
            query = query.order('expires_at', { ascending: true });
            query = query.limit(rowLimit);
            return query;
          })(),
          fallback: { data: [], error: null },
        }],
        { deadlineMs: cfg.readDeadlineMs },
      ).then((r) => r.results[0]);

      if (!result || result.error) {
        if (result?.error) warnOnce('due read failed', result.error.message);
        return [];
      }

      return (Array.isArray(result.data) ? result.data : []).flatMap((row) => {
        const inputs = rowInputs(row);
        const storedAt = new Date(row.stored_at).getTime();
        const expiresAt = new Date(row.expires_at).getTime();
        if (!inputs || !Number.isFinite(storedAt) || !Number.isFinite(expiresAt) ||
            expiresAt <= startMs || expiresAt > endMs) return [];
        return [{
          key: row.key,
          answer: row.answer,
          question: inputs.question,
          lang: inputs.lang,
          country: inputs.country,
          plan: inputs.plan,
          detailed: inputs.detailed,
          branch: inputs.branch,
          searched: inputs.usedLiveWeb,
          storedAt,
          expiresAt,
        }];
      });
    } catch (e) {
      warnOnce('due read threw', e.message);
      return [];
    }
  }

  /** Convenience form for callers that naturally have a duration. */
  async function getDue({ withinMs, limit = 50 } = {}) {
    const windowMs = Number(withinMs);
    if (!(windowMs > 0)) return [];
    return dueForRefresh({ before: now() + windowMs, limit });
  }

  /** Drop everything. The user-facing lever behind "this answer is wrong" and
   * the thing a deploy that changes a prompt should call. */
  function clear() {
    memory.clear();
    if (!supabase) return;
    try {
      Promise.resolve(supabase.from('answer_cache').delete().neq('key', ''))
        .catch((e) => warnOnce('clear failed', e.message));
    } catch (e) {
      warnOnce('clear threw', e.message);
    }
  }

  return { get, getSemantic, getDue, dueForRefresh, set, setBrief, setConstant, enrichEmbedding, clear, keyFor, stats: () => ({ ...stats, size: memory.size }) };
}

module.exports = { createAnswerCache, keyFor, normalise, replayInputs, ttlFor, TTL_MS, validEmbedding };

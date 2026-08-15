'use strict';

const crypto = require('node:crypto');
const { coverage, numbers } = require('./text-similarity');
const { EVIDENCE_RECORD, validate } = require('./schemas');

/**
 * WHICH SOURCE SAID WHAT, AND WHICH SENTENCES OF THE ANSWER NOTHING SAID.
 *
 * `EVIDENCE_RECORD` has existed since the schema pass and nothing has ever
 * produced one. The answer path renders search results into a prompt, the model
 * writes prose, and the link between the two is a citation list appended at the
 * end — which says the turn READ five pages, not that any of them support the
 * sentence with the number in it. The two questions a wrong answer raises,
 * "where did this come from" and "was anything unsupported", both die there.
 *
 * WHAT THIS IS. A per-turn ledger: sources go in as evidence records, the
 * answer's checkable claims come out matched to them, and everything unmatched
 * is named. It runs on text, with no model call and no network, because a
 * verifier that costs a model call is a verifier that gets disabled the first
 * time a turn is slow.
 *
 * WHAT IT IS NOT. Not a fact-checker. It cannot tell you a source is WRONG —
 * only that the answer said something no source it was given says. That is the
 * cheap half of the problem and it is the half that catches a model inventing a
 * figure, which is the failure this system actually has.
 *
 * A CHECKABLE CLAIM IS NOT EVERY SENTENCE. "Let me explain the trade-offs" is
 * not a claim; "it costs $40 a month" is. Scoring prose as if every sentence
 * needed a citation produces an unsupported list nobody reads, so only
 * sentences carrying a NUMBER, a DATE or a PROPER NOUN are checked — the ones
 * where being wrong is a fact rather than a phrasing.
 */

/** Sentence-ish split that does not break on "$4.99" or "Dr. Smith". */
const SENTENCES = /[^.!?\n]+(?:[.!?]+|\n|$)/g;

const HAS_NUMBER = /\d/;
/* A capitalised word that is not sentence-initial: a name, a product, a place.
 * The initial one is excluded because every sentence has one. */
const HAS_PROPER_NOUN = /(?!^)\b[A-Z][a-zA-Z]{2,}/;
const HAS_DATE = /\b(19|20)\d{2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;

/* Sentences that carry a figure but assert nothing about the world. A question
 * to the user and a numbered list header are the two that show up most. */
const NOT_A_CLAIM = /^\s*(?:\d+[.)]\s*)?$|\?\s*$/;

const idFor = (material) => `ev_${crypto.createHash('sha256').update(material).digest('hex').slice(0, 16)}`;

/**
 * @param {string} text
 * @returns {string[]} the sentences worth checking against a source
 */
function checkableClaims(text) {
  const raw = String(text || '').match(SENTENCES) || [];
  return raw
    .map((s) => s.trim())
    .filter((s) => s.length >= 20 && !NOT_A_CLAIM.test(s))
    .filter((s) => HAS_NUMBER.test(s) || HAS_DATE.test(s) || HAS_PROPER_NOUN.test(s));
}

/**
 * How time-sensitive a source is against the question's window.
 *
 * `sourceDate` is the date the SOURCE carries, never the date it was fetched —
 * conflating them is how a five-year-old page reads as today's news. A source
 * with no date is `unknown`, which is deliberately not `stale`: most of the web
 * publishes no machine-readable date and treating that as rot would discard
 * almost everything.
 *
 * @param {string|number|Date|null} sourceDate
 * @param {number} [windowMs]  how old is still 'fresh' for THIS question
 * @param {number} [now]
 */
function freshnessOf(sourceDate, windowMs = null, now = Date.now()) {
  if (!sourceDate) return 'unknown';
  const at = new Date(sourceDate).getTime();
  if (!Number.isFinite(at)) return 'unknown';
  const age = now - at;
  if (age < 0) return 'unknown';
  const window = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 30 * 24 * 3600 * 1000;
  if (age <= window) return 'fresh';
  if (age <= window * 12) return 'dated';
  return 'stale';
}

/**
 * A ledger for ONE turn.
 *
 * @param {{now?: () => number, freshnessWindowMs?: number|null,
 *          supportAt?: number, maxRecords?: number}} [opts]
 */
function createEvidenceLedger({
  now = Date.now,
  freshnessWindowMs = null,
  /* How much of a claim's content words a source has to carry before it counts
   * as supporting it. Reasoned, not measured, and stated as such: 0.5 is where
   * a snippet stops being "about the same topic" and starts being "says this".
   * One constant, so it can be tuned against real turns rather than hunted for
   * across the file. */
  supportAt = 0.5,
  /* A turn that fetched two hundred pages is a bug somewhere else; the cap
   * keeps this from turning that into an O(claims x sources) scan. */
  maxRecords = 100,
} = {}) {
  const records = new Map();

  /**
   * @param {object} source
   * @param {string} source.text         the snippet or extract that was actually read
   * @param {string} [source.url]
   * @param {string} [source.title]
   * @param {string|number|Date} [source.date]   the date the SOURCE carries
   * @param {string} [source.via]        which retrieval produced it
   * @param {number} [source.confidence]
   * @returns {object|null} the stored record, or null if there was nothing to store
   */
  const record = ({ text, url = null, title = '', date = null, via = 'unknown', confidence = 0.5 } = {}) => {
    const claim = String(text || '').trim().slice(0, 2000);
    if (!claim) return null;
    if (records.size >= maxRecords) return null;

    /* Keyed on the CONTENT plus the URL. The same page fetched twice in one
     * turn is one piece of evidence; the same sentence from two independent
     * sources is two, and that distinction is the whole point of counting
     * sources when a contradiction has to be resolved. */
    const id = idFor(`${url || ''}\u0000${claim}`);
    if (records.has(id)) return records.get(id);

    const row = {
      claim,
      sourceUrl: url ? String(url).slice(0, 2048) : null,
      sourceId: (title && String(title).slice(0, 200)) || (url ? String(url).slice(0, 200) : id),
      sourceDate: date ? String(date).slice(0, 40) : null,
      fetchedAt: now(),
      freshness: freshnessOf(date, freshnessWindowMs, now()),
      confidence: Math.min(1, Math.max(0, Number(confidence) || 0)),
      via: String(via || 'unknown').slice(0, 60) || 'unknown',
    };

    /* Validated against the schema that has existed all along, so a record that
     * could never be persisted is refused HERE rather than at the write. */
    const check = validate(EVIDENCE_RECORD, row);
    if (!check.ok) return null;

    const stored = { id, ...row };
    records.set(id, stored);
    return stored;
  };

  /**
   * Match an answer's checkable claims to the evidence, and name what is left.
   *
   * NUMBERS ARE CHECKED SEPARATELY AND MORE STRICTLY. A sentence can share
   * every word with a source and state a different figure — which is the single
   * most consequential way an answer goes wrong here, and the one a word-
   * overlap score is worst at seeing. A claim whose figures appear in NO source
   * is unsupported however well its prose matches.
   *
   * @param {string} answer
   * @returns {{claims: object[], supported: number, unsupported: object[], coverage: number}}
   */
  const audit = (answer) => {
    const all = [...records.values()];
    const claims = checkableClaims(answer).map((text) => {
      const figures = new Set(numbers(text));
      const matches = all
        .map((row) => {
          const wordCover = coverage(text, row.claim);
          const rowFigures = new Set(numbers(row.claim));
          const figuresFound = figures.size === 0
            ? true
            : [...figures].some((f) => rowFigures.has(f));
          return { id: row.id, sourceUrl: row.sourceUrl, wordCover, figuresFound };
        })
        .filter((m) => m.wordCover >= supportAt && m.figuresFound)
        .sort((a, b) => b.wordCover - a.wordCover);

      return {
        text,
        evidenceIds: matches.map((m) => m.id),
        supported: matches.length > 0,
        /* The best single match, which is what a reader wants to see beside the
         * sentence — not the whole list. */
        bestSource: matches[0]?.sourceUrl || null,
      };
    });

    const supported = claims.filter((c) => c.supported).length;
    return {
      claims,
      supported,
      unsupported: claims.filter((c) => !c.supported),
      /* 1 when there was nothing to check. An answer with no checkable claim is
       * not an unsupported answer — it is prose, and reporting 0 there would
       * make the number useless on the turns it is meant to protect. */
      coverage: claims.length ? supported / claims.length : 1,
    };
  };

  return {
    record,
    audit,
    all: () => [...records.values()],
    ids: () => [...records.keys()],
    get size() { return records.size; },
  };
}

module.exports = { createEvidenceLedger, checkableClaims, freshnessOf };

'use strict';

/**
 * FINDING THE PART OF A DOCUMENT THAT ANSWERS THE QUESTION.
 *
 * WHAT WAS WRONG. `read_file` returned the first 20,000 characters of a file
 * and a note saying it was truncated. For a note or a CSV export that is the
 * whole thing; for the documents this product accepts — a 512KB PDF is eight
 * megabytes of container and can be two hundred pages — it is the first few
 * pages and nothing else, forever. A question about page 90 was answered from
 * page 1 with no way for the model to reach further, and the failure is
 * invisible: the answer is fluent, sourced from a real document, and wrong.
 *
 * Worse, the rest was not merely unread — `prepareUpload` sliced to 20,000
 * characters before STORING, so page 90 had never been kept at all. Retrieval
 * over it was not possible, only unimplemented.
 *
 * WHAT THIS DOES. Splits the text into overlapping passages on paragraph
 * boundaries, scores them against the question, and returns the best few with
 * the character offsets and the nearest heading, so the model can quote a
 * location rather than "the document".
 *
 * WHY LEXICAL AND NOT EMBEDDINGS. There is no embedding call on this path
 * today and adding one would put a network round trip inside a tool call the
 * council makes while the user waits, on a turn that has already spent its
 * budget. Lexical scoring with IDF-style rarity weighting is a worse ranker in
 * general and a perfectly good one for the case that matters here — a question
 * naming terms that appear literally in the document. The interface returns
 * scored passages, so a vector re-rank can be added over it later without
 * changing a caller; `lib/hybrid-retrieval.js` already does exactly that for
 * memory and is the model to follow.
 *
 * ponytail: rarity-weighted term overlap with a proximity bonus. Not BM25 —
 * the tuning constants of BM25 want a corpus to tune against, and this ranks a
 * few dozen passages of one document.
 */

/** Characters per passage. About a page of prose, which is what a citation should point at. */
const PASSAGE_CHARS = 1800;

/**
 * How much each passage repeats of the one before it.
 *
 * WITHOUT OVERLAP A SENTENCE THAT STRADDLES A BOUNDARY IS IN NEITHER PASSAGE'S
 * SCORE — it is split across two, each holding half the terms, so a passage
 * that answers the question exactly can rank below one that mentions it in
 * passing. 15% is the usual cheap insurance.
 */
const OVERLAP_CHARS = Math.round(PASSAGE_CHARS * 0.15);

/** Words that appear in every question and rank nothing. */
const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with',
  'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did', 'have',
  'has', 'had', 'it', 'its', 'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom',
  'when', 'where', 'why', 'how', 'about', 'into', 'over', 'than', 'then', 'so', 'not', 'no',
  'can', 'could', 'should', 'would', 'will', 'may', 'might', 'i', 'you', 'we', 'they', 'he', 'she',
]);

const terms = (text) => String(text || '')
  .toLowerCase()
  .split(/[^\p{L}\p{N}]+/u)
  .filter((w) => w.length > 1 && !STOP.has(w));

/** A markdown heading, or a short line that reads like one (ALL CAPS, "3. Title"). */
const HEADING_RE = /^\s{0,3}(#{1,6}\s+\S.*|[A-Z][A-Z0-9 ,'&()/-]{3,60}|\d+(?:\.\d+)*\.?\s+\S.{2,60})$/;

/**
 * Split text into overlapping passages, preferring paragraph boundaries.
 *
 * The offsets are into the ORIGINAL string and are what a citation quotes, so
 * they must survive the splitting exactly — no trimming that loses count, and
 * no normalisation that changes lengths.
 *
 * @param {string} text
 * @param {{size?: number, overlap?: number}} [opts]
 * @returns {Array<{index: number, start: number, end: number, text: string, heading: string|null}>}
 */
function splitPassages(text, { size = PASSAGE_CHARS, overlap = OVERLAP_CHARS } = {}) {
  const source = typeof text === 'string' ? text : '';
  if (!source) return [];
  /* A degenerate size would loop forever below; clamped rather than trusted
   * because this takes numbers from a caller. */
  const width = Math.max(200, Math.floor(size) || PASSAGE_CHARS);
  const back = Math.max(0, Math.min(Math.floor(overlap) || 0, width - 100));

  const passages = [];
  let cursor = 0;
  while (cursor < source.length) {
    let end = Math.min(source.length, cursor + width);
    if (end < source.length) {
      /* Prefer to cut at a blank line, then at a sentence end, then anywhere.
       * Only in the last quarter of the window, so a document with no
       * paragraph breaks still advances at close to full width. */
      const window = source.slice(cursor + Math.floor(width * 0.75), end);
      const para = window.lastIndexOf('\n\n');
      const stop = para === -1 ? window.search(/\.[\s"')\]]*$/) : para;
      if (stop > 0) end = cursor + Math.floor(width * 0.75) + stop + (para === -1 ? 1 : 2);
    }
    const slice = source.slice(cursor, end);
    passages.push({
      index: passages.length,
      start: cursor,
      end,
      text: slice,
      heading: nearestHeading(source, cursor),
    });
    if (end >= source.length) break;
    cursor = Math.max(end - back, cursor + 1);
  }
  return passages;
}

/** The last heading at or above this offset, for a citation a human can follow. */
function nearestHeading(source, offset) {
  const before = source.slice(0, Math.min(offset + 200, source.length));
  const lines = before.split('\n');
  for (let i = lines.length - 1; i >= 0 && i > lines.length - 400; i--) {
    const line = lines[i].trim();
    if (line.length < 3 || line.length > 80) continue;
    if (HEADING_RE.test(line)) return line.replace(/^#+\s*/, '').trim();
  }
  return null;
}

/**
 * Score passages against a question, best first.
 *
 * RARITY, NOT COUNT. A term appearing in every passage separates nothing, so
 * each term is weighted by how few passages contain it — the idea behind IDF,
 * without pretending to be a tuned BM25. Without this, a document about
 * invoices ranks every passage equally for the word "invoice".
 *
 * @returns {Array<{passage: object, score: number, matched: string[]}>}
 */
function scorePassages(passages, query) {
  const wanted = [...new Set(terms(query))];
  if (!wanted.length || !passages.length) return [];

  const documentFrequency = new Map();
  const passageTerms = passages.map((p) => {
    const set = new Set(terms(p.text));
    for (const term of wanted) if (set.has(term)) documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    return set;
  });

  return passages.map((passage, i) => {
    const set = passageTerms[i];
    const matched = wanted.filter((t) => set.has(t));
    let score = 0;
    for (const term of matched) {
      const df = documentFrequency.get(term) || 1;
      score += Math.log(1 + passages.length / df);
    }
    /* A passage carrying MOST of the question beats one carrying one rare word
     * twice: the question is a whole thought, not a bag of keywords. */
    score *= 0.5 + 0.5 * (matched.length / wanted.length);
    return { passage, score, matched };
  })
    .filter((r) => r.score > 0)
    /* Ties break by position, so a document that says the same thing twice
     * cites the first occurrence rather than an arbitrary one. */
    .sort((a, b) => b.score - a.score || a.passage.index - b.passage.index);
}

/**
 * The passages of `text` that best answer `query`, ready to put in a prompt.
 *
 * NO QUERY MEANS THE BEGINNING, unchanged from what read_file always did. A
 * model asking to see a file without saying what it is looking for wants the
 * document, and guessing at relevance from nothing would be worse than the
 * honest first pages.
 *
 * @param {string} text
 * @param {string} query
 * @param {{limit?: number, budget?: number}} [opts] budget = characters of text
 * @returns {{passages: Array, covered: number, total: number, matched: boolean}}
 */
function findPassages(text, query, { limit = 3, budget = 6000 } = {}) {
  const source = typeof text === 'string' ? text : '';
  const total = source.length;
  const all = splitPassages(source);

  const take = (chosen) => {
    const kept = [];
    let used = 0;
    for (const passage of chosen) {
      if (kept.length >= limit) break;
      if (used + passage.text.length > budget && kept.length) break;
      kept.push(passage);
      used += passage.text.length;
    }
    /* Returned in DOCUMENT order however they were ranked: a model reading
     * three passages out of order is reading a different document. */
    return { kept: kept.sort((a, b) => a.index - b.index), used };
  };

  if (!String(query || '').trim()) {
    const { kept, used } = take(all);
    return { passages: kept, covered: used, total, matched: false };
  }

  const ranked = scorePassages(all, query);
  if (!ranked.length) {
    const { kept, used } = take(all);
    return { passages: kept, covered: used, total, matched: false };
  }
  const { kept, used } = take(ranked.map((r) => r.passage));
  return { passages: kept, covered: used, total, matched: true };
}

/**
 * Render passages for a model, with the offsets that make a citation checkable.
 *
 * The gaps are stated. A model handed three passages with no marker between
 * them reads one continuous text and will happily join a sentence from page 4
 * to a clause from page 90.
 */
function renderPassages({ passages, total, matched, name }) {
  if (!passages.length) return '';
  const parts = passages.map((p) => {
    const where = p.heading ? `${p.heading} — ` : '';
    return `[${where}characters ${p.start}–${p.end} of ${total}]\n${p.text}`;
  });
  const head = matched
    ? `Showing the ${passages.length} passage${passages.length === 1 ? '' : 's'} of ${name} that match your query, out of ${total} characters. Other parts of the document were not shown.`
    : `Showing the first ${passages.length} passage${passages.length === 1 ? '' : 's'} of ${name}, out of ${total} characters.`;
  return `${head}\n\n${parts.join('\n\n[…]\n\n')}`;
}

module.exports = {
  splitPassages,
  scorePassages,
  findPassages,
  renderPassages,
  nearestHeading,
  PASSAGE_CHARS,
  OVERLAP_CHARS,
};

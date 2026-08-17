'use strict';

const { fuse } = require('./hybrid-retrieval');

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
 * LEXICAL IS THE FLOOR, NOT THE CEILING. Lexical scoring with IDF-style rarity
 * weighting is a perfectly good ranker for the case that matters most here — a
 * question naming terms that appear literally in the document — and it needs no
 * network at all. Its failure is not bad ranking, it is TOTAL: `scorePassages`
 * keeps only passages scoring above zero, so a question that paraphrases its
 * document rather than quoting it returns nothing, and `search_files` reports
 * "the terms do not appear" about a document that answers the question.
 *
 * `fuseDocumentHits` closes that hole with an optional vector side, fused by
 * reciprocal rank through `lib/hybrid-retrieval.js` — the same fusion memory
 * uses, for the same reason. Everything in THIS file stays pure: the caller
 * supplies the vectors, because the embedding call is a network round trip and
 * `server.js` owns those. When no vectors arrive — no key, a timeout, a
 * malformed batch — the fused result is the lexical result, unchanged.
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

/**
 * How much attached text one search may read into memory.
 *
 * Twenty files at MAX_CHARS each is twenty megabytes, and this runs inside a
 * tool call the user is waiting on. The cap is a bound on that, not a quality
 * decision: the files that do not fit are NAMED in the result rather than
 * silently absent, because "the answer is not in your documents" and "I did not
 * open three of them" are different answers and only one of them is honest.
 *
 * ponytail: first-N-characters, in the order the files were attached. A
 * per-file share would be fairer and needs a reason to exist first.
 */
const SCAN_CHARS = 2_000_000;

/**
 * The passages of MANY documents that best answer one query.
 *
 * WHAT WAS WRONG. `read_file` takes one id, so a question whose answer is in
 * one of five attached documents cost one round per guess — and `agent-loop`
 * bounds the rounds, so past a few files the model runs out of turns before it
 * runs out of documents. The guess is made from the FILENAME, which is the one
 * part of a document that is not its contents.
 *
 * ONE SCORING PASS OVER THE MERGED CORPUS, not a ranking per file merged
 * afterwards. Rarity is the whole point of the ranker (see `scorePassages`) and
 * it only means anything across the corpus being searched: a term in every
 * passage of every document separates nothing, while a term in one passage of
 * one document is the hit. Ranking each file alone and taking the best of each
 * would hand back the least-bad passage of four irrelevant documents.
 *
 * @param {Array<{id: string, name: string, content: string}>} files
 * @param {string} query
 * @returns {{hits: Array, matched: boolean, scanned: number, skipped: string[]}}
 */
function documentCandidates(files, { scanChars = SCAN_CHARS } = {}) {
  const skipped = [];
  const passages = [];
  let spent = 0;
  let scanned = 0;

  for (const file of Array.isArray(files) ? files : []) {
    const text = String((file && file.content) || '');
    if (!text) continue;
    if (spent + text.length > scanChars) {
      skipped.push(String((file && file.name) || 'a file'));
      continue;
    }
    spent += text.length;
    scanned += 1;
    for (const passage of splitPassages(text)) {
      /* Re-indexed across the corpus: `index` is what breaks a score tie and
       * what puts the output in reading order, and a per-file index collides
       * on both. `total` is carried per passage because a citation's offsets
       * are into ITS file, not into the concatenation. */
      passages.push({ ...passage, index: passages.length, total: text.length, file: { id: file.id, name: file.name } });
    }
  }

  return { passages, scanned, skipped };
}

function searchDocuments(files, query, { limit = 3, budget = 3000, scanChars = SCAN_CHARS } = {}) {
  const { passages, scanned, skipped } = documentCandidates(files, { scanChars });

  if (!passages.length) return { hits: [], matched: false, scanned, skipped };

  const ranked = scorePassages(passages, query);
  /* NO FALLBACK TO THE BEGINNING. `findPassages` opens one named file at page
   * one when nothing matches, which is what a reader would do. Here the
   * beginning of an arbitrary one of five documents answers nothing, and
   * returning it would read as a hit. Empty is the true answer. */
  if (!ranked.length) return { hits: [], matched: false, scanned, skipped };

  return { hits: takeWithinBudget(ranked, { limit, budget }), matched: true, scanned, skipped };
}

/**
 * The prefix of `ranked` that fits, put back into reading order.
 *
 * ALWAYS AT LEAST ONE. `hits.length` guards the budget test so a single passage
 * larger than the whole budget is still returned; the alternative is answering
 * "nothing matches" about the passage that does.
 *
 * @param {Array<{passage: object, score: number}>} ranked best first
 */
function takeWithinBudget(ranked, { limit = 3, budget = 3000 } = {}) {
  const hits = [];
  let used = 0;
  for (const { passage, score } of ranked) {
    if (hits.length >= limit) break;
    if (used + passage.text.length > budget && hits.length) break;
    hits.push({ passage, score });
    used += passage.text.length;
  }
  /* Reading order, not score order: two passages of one document read as the
   * document, and the model quotes offsets that go forwards. */
  hits.sort((a, b) => a.passage.index - b.passage.index);
  return hits;
}

/** Render cross-document hits, each labelled with the file it came from. */
function renderDocuments({ hits, skipped = [], query, lexicalOnly = '' }) {
  if (!hits.length) return '';
  const parts = hits.map(({ passage }) => {
    const where = passage.heading ? `${passage.heading} — ` : '';
    return `[${passage.file.name} — ${where}characters ${passage.start}–${passage.end} of ${passage.total}]\n${passage.text}`;
  });
  const names = [...new Set(hits.map((h) => h.passage.file.name))];
  const missed = skipped.length ? ` Not searched (too large to open together): ${skipped.join(', ')}.` : '';
  /* A LEXICAL-ONLY SEARCH HAS A FAILURE THE MODEL CANNOT SEE. With the vector
   * side off, a passage that answers the question in different words scored
   * zero and was never a candidate, so "these are the matches" means "these
   * are the WORD matches". Said plainly, because the alternative is the model
   * concluding the documents are silent on something they discuss. */
  const partial = lexicalOnly ? ` Matched on words only (${lexicalOnly}), so a passage answering this in different words would not appear; try the document's own wording.` : '';
  const head = `Showing the ${hits.length} passage${hits.length === 1 ? '' : 's'} matching "${query}" across ${names.length} document${names.length === 1 ? '' : 's'} (${names.join(', ')}). Other parts of these documents, and any other attached file, were not shown.${missed}${partial}`;
  return `${head}\n\n${parts.join('\n\n[…]\n\n')}`;
}

/**
 * Cosine similarity, or null when the pair cannot be compared.
 *
 * NULL, NOT ZERO, for a missing or mismatched vector. Zero is a real
 * similarity — it means orthogonal, which is a measurement — and letting an
 * absent vector enter the ranking as one puts an unembedded passage ahead of
 * every passage the query actively disagrees with. The vector side must be
 * silent about what it does not know.
 *
 * pgvector does this in SQL for `user_facts`; these passages are in memory and
 * were never written to a table, so it is done here.
 */
function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return null;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (!na || !nb) return null;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * The lexical ranking and an optional vector ranking, fused.
 *
 * WHY BOTH, IN THIS FILE'S TERMS. `scorePassages` cannot see a paraphrase and
 * returns nothing for one. A vector ranking cannot see a rare literal token —
 * `AC-4471` and `AC-4477` embed to nearly the same point — and it always
 * returns something, including for a question the corpus does not answer at
 * all, because every vector has a nearest neighbour. Run alone, each one's
 * failure is the other one's job.
 *
 * FUSED BY RECIPROCAL RANK through `hybrid-retrieval.fuse`, not by score: an
 * IDF-ish sum and a cosine are not on one scale and no weight between them is
 * calibratable here. Only the ORDER each side produced is used.
 *
 * THE VECTOR SIDE IS CUT, NOT JUST RANKED. Because it ranks everything, the
 * whole corpus arrives fused and a passage about nothing relevant reaches the
 * output whenever the lexical side is short. `vectorFloor` and `vectorTop`
 * bound it: below the floor a passage is not offered at all, and past the top
 * the tail is dropped. A question with no answer in these documents must still
 * be able to come back empty — that is what makes a hit mean something.
 *
 * @param {object} params
 * @param {Array<{passage: object, score: number}>} params.lexical best first, from scorePassages
 * @param {Array<{passage: object, vector: number[]|null}>} [params.embedded] candidates with their vectors
 * @param {number[]|null} [params.queryVector] the question's vector, or null
 * @returns {{hits: Array, matched: boolean, via: string[]}}
 */
function fuseDocumentHits({
  lexical = [],
  embedded = [],
  queryVector = null,
  limit = 3,
  budget = 3000,
  /* A cosine this low is not a weak match, it is an unrelated passage. Chosen
   * as a floor rather than tuned: this is the value that keeps a question the
   * documents do not answer returning empty, which is the property being
   * protected. ponytail: one constant, no per-corpus calibration; revisit only
   * with a labelled set to calibrate against. */
  vectorFloor = 0.5,
  /* The vector side ranks the ENTIRE corpus, so it needs a length. Four is the
   * shortlist a limit of three can actually use. */
  vectorTop = 4,
} = {}) {
  const scored = Array.isArray(queryVector) && queryVector.length
    ? embedded
      .map((row) => ({ passage: row && row.passage, score: cosine(queryVector, row && row.vector) }))
      .filter((row) => row.passage && row.score !== null && row.score >= vectorFloor)
      .sort((a, b) => b.score - a.score || a.passage.index - b.passage.index)
      .slice(0, vectorTop)
    : [];

  /* NOTHING TO FUSE IS NOT A FAILURE. With no vectors this is the lexical
   * result byte for byte, which is what every degraded path here falls back
   * to and why the caller needs no branch of its own. */
  if (!scored.length) {
    return { hits: takeWithinBudget(lexical, { limit, budget }), matched: lexical.length > 0, via: lexical.length ? ['lexical'] : [] };
  }

  const fused = fuse({
    vector: scored,
    lexical,
    /* Two rankings of the SAME passage object must collide on one key, and
     * `index` is the only identifier a passage has — it is assigned once, per
     * corpus, in `documentCandidates`. Scoring on the object itself would make
     * every passage look unique to both sides and fuse nothing. */
    keyOf: (row) => (row && row.passage ? `p${row.passage.index}` : ''),
    limit: Math.max(limit, vectorTop),
  });

  const ranked = fused.map(({ row, score }) => ({ passage: row.passage, score }));
  return {
    hits: takeWithinBudget(ranked, { limit, budget }),
    matched: ranked.length > 0,
    via: [...new Set(fused.flatMap((r) => r.via))],
  };
}

module.exports = {
  splitPassages,
  scorePassages,
  documentCandidates,
  takeWithinBudget,
  cosine,
  fuseDocumentHits,
  findPassages,
  renderPassages,
  searchDocuments,
  renderDocuments,
  nearestHeading,
  PASSAGE_CHARS,
  OVERLAP_CHARS,
  SCAN_CHARS,
};

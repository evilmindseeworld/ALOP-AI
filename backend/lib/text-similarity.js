'use strict';

/**
 * How much two pieces of text say the same thing, and the pieces that decide it.
 *
 * EXTRACTED FROM `progressive-council.js`, which needed it to decide whether a
 * council had agreed. The contradiction resolver needs the same three signals
 * to decide whether two SOURCES disagree, and a second copy of a scoring
 * function is a second copy of its thresholds — they drift, and the two
 * features then disagree about what "the same answer" means while both looking
 * correct in their own tests.
 *
 * NOT A SEMANTIC MODEL. No embedding, no network, no model call. It compares
 * content words, numeric claims and negation balance, which is enough to tell a
 * paraphrase from a contradiction and cheap enough to run on every draft pair.
 * Where an embedding is warranted the caller already has one — see
 * `answer-embeddings.js`.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'is', 'are', 'was', 'were', 'be', 'been',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'as', 'by', 'from', 'that', 'this', 'it', 'its',
  'you', 'your', 'i', 'we', 'they', 'he', 'she', 'can', 'will', 'would', 'should', 'may', 'might',
]);

/* Words that flip a claim. Two texts can share every content word and mean the
 * opposite; a bag-of-words score cannot see that and would report perfect
 * agreement on "it is safe" against "it is not safe". */
const NEGATIONS = /\b(not|no|never|cannot|can't|isn't|aren't|won't|doesn't|don't|without|unsafe|incorrect|false)\b/gi;

const words = (text) => String(text || '')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}\s.%-]/gu, ' ')
  .split(/\s+/)
  /* TRAILING PUNCTUATION IS NOT PART OF A WORD, and leaving it attached made
   * "answers." and "answers" two different tokens — so the same sentence with
   * and without a full stop scored 0.58 against itself. `.` and `-` survive
   * INSIDE a token because "3.5" and "load-bearing" need them; they are only
   * stripped from the ends. */
  .map((w) => w.replace(/^[.-]+/, '').replace(/[.-]+$/, ''))
  .filter((w) => w.length > 2 && !STOPWORDS.has(w));

/** Numbers, kept with their unit-ish suffix so "8gb" and "8" are not the same. */
const numbers = (text) => (String(text || '').match(/\d[\d,.]*\s*(?:%|[a-z]{1,4})?/gi) || [])
  .map((n) => n.replace(/[\s,]/g, '').toLowerCase());

const jaccard = (a, b) => {
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
};

const negationCount = (text) => (String(text || '').match(NEGATIONS) || []).length;

/**
 * How much two texts agree, 0..1.
 *
 * Three signals, weighted by how badly each one being wrong hurts:
 * the numeric claims (a price, a version, a dose — the thing a user acts on),
 * the negation balance (whether the two point the same way at all),
 * and the content words (everything else).
 */
function agreementScore(a, b) {
  const wa = new Set(words(a));
  const wb = new Set(words(b));
  const na = new Set(numbers(a));
  const nb = new Set(numbers(b));

  const wordScore = jaccard(wa, wb);
  /* No numbers on either side is not a disagreement about numbers. Numbers on
   * one side only IS one — a text that commits to a figure and one that does
   * not are not saying the same thing. */
  const numberScore = (!na.size && !nb.size) ? null : jaccard(na, nb);

  const negA = negationCount(a);
  const negB = negationCount(b);
  const negationScore = negA === negB ? 1 : 1 - Math.min(1, Math.abs(negA - negB) / Math.max(3, negA + negB));

  if (numberScore === null) return wordScore * 0.7 + negationScore * 0.3;
  return numberScore * 0.45 + wordScore * 0.3 + negationScore * 0.25;
}

/** How much of `claim` is covered by `text` — asymmetric, unlike jaccard. */
function coverage(claim, text) {
  const need = new Set(words(claim));
  if (!need.size) return 1;
  const have = new Set(words(text));
  let found = 0;
  for (const w of need) if (have.has(w)) found += 1;
  return found / need.size;
}

module.exports = { words, numbers, jaccard, agreementScore, coverage, negationCount, NEGATIONS, STOPWORDS };

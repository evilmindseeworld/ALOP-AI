/**
 * TYPO TOLERANCE FOR THE WORDS THE ROUTER READS.
 *
 * Asked for on 2026-08-17: "it should account for every misspelling on every
 * word just like when i say dis you understan me right". The models do already —
 * a council reads "tienco s7" and answers about Tineco without help. The parts
 * that do NOT are the deterministic ones, and they are the parts that decide
 * whether a turn searches the web, how many seats it gets and whether it is
 * arithmetic. Those read words with regexes, and a regex reads `latst` as prose.
 *
 * So the correction is applied to a COPY used for DECISIONS ONLY. The text sent
 * to any model is the user's own, unedited — that is the line this module must
 * not cross. Rewriting a person's question before answering it means answering a
 * question they did not ask, and the failure would be invisible: the answer
 * would look fine and be about something else.
 *
 * WHAT IS AND IS NOT A SPELL CHECKER. This is not one, and it must not become
 * one. There is no dictionary here and no attempt to fix prose. It corrects
 * towards ONE closed vocabulary — the words the router's own regexes look for —
 * and leaves every other word exactly as typed. A general spell checker would
 * need a dictionary, a language model, or both, and would then be able to
 * "correct" a product name into an English word, which is the one failure this
 * whole area cannot afford.
 *
 * THE SAFETY RULES, all three load-bearing:
 *
 *   1. **Nothing shorter than five characters is corrected.** `and` is one edit
 *      from `add`, `is` from `it`, `no` from `now`. Short words carry the least
 *      information per character and the most collisions.
 *   2. **A tie refuses.** A word equally close to two vocabulary entries is left
 *      alone. Guessing between `recent` and `recept` is not tolerance, it is
 *      invention.
 *   3. **A word already in the vocabulary is never touched**, checked before any
 *      distance is computed, so a correctly spelled word can never be "fixed"
 *      into a neighbour.
 */

/** Damerau-Levenshtein, bounded — the only question asked is "within k?". */
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let twoBack = null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      // A transposition is ONE edit. `laetst`/`latset` are swaps, and they are
      // the commonest typo there is; charging two puts them out of budget.
      if (i > 1 && j > 1 && twoBack && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, twoBack[j - 2] + 1);
      }
      row.push(v);
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
    twoBack = prev;
    prev = row;
  }
  return prev[b.length];
}

/**
 * THE VOCABULARY IS THE ROUTER'S OWN WORD LIST, and it is written out here
 * rather than derived from the regexes in `router.js`.
 *
 * Deriving it was tried in the head and rejected: those regexes contain
 * multi-word phrases, alternations and lookarounds, and a scraper over them
 * would either miss words or invent them, silently, with the failure showing up
 * as a routing decision nobody can explain. A list that is explicit can be
 * audited by reading it. The cost is that adding a keyword to `router.js`
 * without adding it here loses only the typo tolerance for that one word, which
 * is a degradation and not a defect — `spelling-vocab.test.js` catches the
 * common case.
 */
const ROUTER_VOCABULARY = [
  // Volatility: the words that mean "the answer can have changed".
  'latest', 'current', 'currently', 'today', 'tonight', 'newest', 'recent',
  'upcoming', 'price', 'prices', 'pricing', 'cost', 'costs', 'stock',
  'available', 'availability', 'version', 'versions', 'release', 'released',
  'maintained', 'president', 'minister', 'regulation', 'policy', 'news',
  'weather', 'score', 'scores', 'schedule', 'market', 'funding', 'ownership',
  'recommend', 'recommendation', 'review', 'reviews', 'specs',
  'specification', 'specifications', 'compare', 'comparison', 'better',
  'worth', 'buying', 'bought',
  // Memory: "what did we discuss".
  'discuss', 'discussed', 'earlier', 'conversation', 'previous', 'summarise',
  'summarize', 'summary', 'recap', 'remember',
  // Explicit search, and the wiki shortcut.
  'search', 'browse', 'online', 'wikipedia', 'encyclopedia', 'biography',
  'history', 'origins',
  // Detail, which flips the council from concise to thorough.
  'detailed', 'comprehensive', 'thorough', 'elaborate', 'explanation',
  'explain', 'essay',
  // The arithmetic openers, so a mistyped opener still reaches the fast path.
  'calculate', 'compute', 'solve', 'evaluate',
];

const VOCAB_SET = new Set(ROUTER_VOCABULARY);

/** Preserve the shape the user typed: `Latst` corrects to `Latest`, not `latest`. */
const matchCase = (original, corrected) =>
  /^[A-Z]/.test(original)
    ? corrected[0].toUpperCase() + corrected.slice(1)
    : corrected;

/**
 * The one vocabulary word a token unambiguously meant, or null.
 * @param {string} token a bare word, no punctuation
 * @param {Set<string>} vocab
 * @param {string[]} list the same vocabulary as an array, for iteration
 */
function correctionFor(token, vocab, list) {
  const lower = token.toLowerCase();
  if (lower.length < 5) return null;
  if (vocab.has(lower)) return null; // rule 3: never "fix" a correct word
  const budget = lower.length >= 7 ? 2 : 1;
  let best = null;
  let bestDistance = budget + 1;
  let tied = false;
  for (const candidate of list) {
    const d = editDistance(lower, candidate, budget);
    if (d > budget) continue;
    if (d < bestDistance) { best = candidate; bestDistance = d; tied = false; }
    else if (d === bestDistance && candidate !== best) tied = true;
  }
  return tied ? null : best;
}

/**
 * A copy of the text with router keywords corrected, plus what was changed.
 *
 * Word boundaries are the only thing split on, and punctuation and spacing are
 * preserved exactly, because `hasNamedEntity` in the router reads CAPITALISATION
 * and `classifyRequest` counts words — a normaliser that collapsed whitespace or
 * lowercased the sentence would change two other decisions while fixing one.
 *
 * @param {string} text
 * @param {{vocabulary?: string[]}} [options]
 * @returns {{text: string, corrections: Array<{from: string, to: string}>}}
 */
function normaliseForRouting(text, { vocabulary = ROUTER_VOCABULARY } = {}) {
  const input = typeof text === 'string' ? text : '';
  if (!input) return { text: '', corrections: [] };

  const vocab = vocabulary === ROUTER_VOCABULARY ? VOCAB_SET : new Set(vocabulary);
  const corrections = [];
  const out = input.replace(/[A-Za-z]+/g, (word) => {
    const corrected = correctionFor(word, vocab, vocabulary);
    if (!corrected) return word;
    corrections.push({ from: word, to: corrected });
    return matchCase(word, corrected);
  });
  return { text: out, corrections };
}

module.exports = { normaliseForRouting, correctionFor, editDistance, ROUTER_VOCABULARY };

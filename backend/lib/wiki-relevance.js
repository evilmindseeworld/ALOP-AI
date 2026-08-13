/**
 * Two small decisions that stand between a Wikipedia lookup and a dead end.
 *
 * THE BUG THIS EXISTS FOR, reported 2026-08-13. Asked to "write an biography
 * about mohamed fateh the sultan of ottoman empire", the product answered
 * "I couldn't find this on Wikipedia." and stopped. Nothing threw, nothing was
 * logged, and the council — which knows perfectly well that Mehmed the
 * Conqueror is Fatih Sultan Mehmet — was never asked, because the Wikipedia
 * branch had already claimed the turn.
 *
 * Two independent causes, measured against the live API rather than reasoned
 * about:
 *
 *   1. THE WHOLE MESSAGE WAS THE SEARCH QUERY. "write an biography about" is
 *      four words of instruction searched as though they were four words of
 *      subject. Wikipedia's full-text search obliged and returned Rumi, Khatri,
 *      "Early Caliphate navy", and a list of people who survived assassination
 *      attempts.
 *
 *   2. A MISS WAS TERMINAL. Wikipedia always returns something for a query with
 *      any recognisable words in it, so "did the search find anything" was
 *      never the question — "is what it found about what was asked" was, and
 *      nothing asked it. The model was handed an article on Bektashism and an
 *      instruction to say it could not find the answer if the answer was not
 *      there, and it followed that instruction exactly.
 *
 * Stripping the instruction (1) does not fix this particular message even so:
 * "mohamed fateh the sultan of ottoman empire" still returns Bektashism,
 * because the user's transliteration is not the one Wikipedia indexes. That is
 * the reason (2) is the load-bearing half. A lookup that cannot recognise its
 * own miss will eventually answer a question it did not understand, and the
 * fix for a miss is not a better query — it is falling through to the council,
 * which is allowed to know things.
 */

/**
 * Words that carry no subject. Two groups, kept separate because they are
 * wrong in different ways: the first is what a person says when ASKING, the
 * second is ordinary English glue. Removing the first is what turns a request
 * into a subject; removing the second is what stops "the" and "of" from
 * counting as agreement between a question and an article title.
 */
const REQUEST_WORDS = [
  'write', 'writes', 'wrote', 'give', 'gives', 'make', 'makes', 'create',
  'tell', 'told', 'explain', 'explains', 'describe', 'describes', 'summarise',
  'summarize', 'summary', 'biography', 'bio', 'article', 'essay', 'report',
  'information', 'info', 'details', 'overview', 'me', 'us', 'please', 'about',
  'what', 'whats', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how',
  'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did', 'can', 'could',
  'would', 'should', 'tell', 'know', 'short', 'long', 'brief', 'full',
  // The indefinite article, which is instruction rather than glue in a request:
  // "write AN biography about" — it names the shape of the reply, not the
  // subject, and searching for it drags in "A (disambiguation)".
  'a', 'an',
];

const GLUE = [
  'a', 'an', 'the', 'of', 'on', 'in', 'at', 'to', 'for', 'from', 'by', 'with',
  'and', 'or', 'but', 'as', 'that', 'this', 'these', 'those', 'it', 'its',
  'his', 'her', 'their', 'my', 'your', 'our',
];

const REQUEST_SET = new Set(REQUEST_WORDS);
const GLUE_SET = new Set(GLUE);

/**
 * Words, lowercased, with punctuation and diacritics dropped.
 *
 * `\p{L}` rather than `\w`, because this product answers in Arabic, Japanese,
 * Chinese, Korean and Russian, and `\w` is ASCII — it would tokenise a Russian
 * question into nothing at all and then report that no article was relevant to
 * it, which is a worse failure than the one being fixed.
 */
const words = (text) =>
  String(text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * The subject of a question, for use as a search query.
 *
 * Conservative by construction: if stripping the instruction words leaves
 * nothing, the ORIGINAL text is returned rather than an empty query. A search
 * for "" returns nothing at all, which would turn "what is it" from a bad
 * lookup into no lookup — the same dead end this file exists to remove, moved
 * one step earlier.
 */
function wikiSubject(text) {
  const kept = words(text).filter((w) => !REQUEST_SET.has(w));
  return kept.length ? kept.join(' ') : String(text || '').trim();
}

/** Content words: not instruction, not glue, and long enough that agreeing on
 * one means something. Two letters agree by accident far too often. */
const contentWords = (text) =>
  new Set(words(text).filter((w) => w.length > 2 && !REQUEST_SET.has(w) && !GLUE_SET.has(w)));

/**
 * IS THIS ARTICLE ABOUT WHAT WAS ASKED?
 *
 * One shared content word. That is a low bar on purpose — the cost of a false
 * NO is one extra council turn, and the cost of a false YES is the failure at
 * the top of this file, where a confident answer is assembled from the wrong
 * article. The bar is set where it separates the measured cases: "Mehmed II"
 * against "who was mehmed ii" shares a word; "Bektashism" against "mohamed
 * fateh the sultan of ottoman empire" shares none.
 *
 * A question with NO content words of its own (a bare "what is it") can never
 * clear the bar, and that is correct: nothing is demonstrably about it.
 */
/**
 * Scripts that do not put spaces between words.
 *
 * Splitting on non-letters gives ONE token for a whole Japanese or Chinese
 * clause — "光合成とは" is a single token and never equals the title "光合成",
 * so word-set agreement is structurally unable to match, in either direction.
 * Without this clause the gate would reject every article for every CJK
 * question and silently switch the Wikipedia path off for those users.
 *
 * A substring test is the segmentation-free version of the same question, and
 * it is restricted to CJK precisely because it is unsafe elsewhere: "art" is
 * inside "started", so a substring rule over English would agree on words the
 * question does not contain.
 */
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;

function isRelevantTitle(question, title) {
  const asked = contentWords(question);
  if (!asked.size) return false;

  const askedText = [...asked].join(' ');
  for (const w of contentWords(title)) {
    if (asked.has(w)) return true;
    if (CJK.test(w) && w.length > 1 && askedText.includes(w)) return true;
  }
  return false;
}

module.exports = { wikiSubject, isRelevantTitle };

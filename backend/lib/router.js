/**
 * The router: what a message IS, decided before any model is asked.
 *
 * These five decisions used to live inline in server.js, where nothing could
 * reach them. That matters more than tidiness: every one of them shapes a
 * system prompt, and a wrong answer here is invisible in every log — the
 * council still runs, still streams, still looks healthy, and answers a German
 * question in French. There is no error to grep for. The only way to catch it
 * is to call the function with a sentence and look at what comes back, which is
 * what the tests beside this file do.
 *
 * A rule split between a pure function and its caller is untested at the seam.
 * Everything here is pure: text in, decision out, no I/O and no model call.
 */

/**
 * Scripts that cannot be confused with each other, in the order they are
 * checked. The order IS the fix.
 *
 * Japanese is checked before Chinese because Japanese is written with kana AND
 * Han characters, so a Han-first check claims every Japanese sentence that
 * contains a kanji — which is nearly all of them. Kana appear in no other
 * language, so their presence is decisive; the reverse is not true.
 *
 * CEILING: a string of Han characters with no kana is reported as Chinese. That
 * is genuinely ambiguous — 日本語 is valid in both — and no amount of character
 * inspection resolves it.
 */
const SCRIPTS = [
  [/[؀-ۿ]/, "Arabic"],
  [/[぀-ヿㇰ-ㇿ]/, "Japanese"], // kana first — see above
  [/[가-힯]/, "Korean"],
  [/[一-鿿]/, "Chinese"],
  [/[Ѐ-ӿ]/, "Russian"],
];

/**
 * Latin alphabets, which DO overlap, so they cannot be resolved by asking in
 * order — that is the bug this replaces. `ü` is French and German; `é` is
 * French and Spanish. Checking French first therefore claimed "Grüße aus
 * München" and "El café está más frío", both of which then got answered in
 * French because `lang` goes straight into the system prompt.
 *
 * Counted instead: every language scores one per matching character, and the
 * highest total wins. A shared character adds to both scores and so decides
 * nothing, which is correct — it carries no information. The distinctive ones
 * (ß, ñ, ç, ¿) do the deciding, without needing to be enumerated as special.
 *
 * A tie falls to declaration order, which is why French is first: French is the
 * only one of the three whose accents are largely shared, so a sentence with no
 * distinctive character at all ("J'ai réservé" — two é and nothing else) is
 * more often French than not.
 *
 * CEILING: a sentence carrying no diacritic at all is reported as English
 * ("Guten Tag, wie geht es Ihnen?"). That is the safe direction to be wrong in.
 * English adds no "Respond in X" line to the prompt, so the model follows the
 * user's own language unprompted; naming the WRONG language actively overrides
 * it. Detecting unaccented German needs word frequency, not characters.
 */
const LATIN = [
  ["French", /[àâçéèêëîïôûùüÿœæ]/gi],
  ["German", /[äöüß]/gi],
  ["Spanish", /[ñáéíóú¿¡]/gi],
];

/**
 * The language to answer in.
 * @param {string} text
 * @returns {string} a language name, or "English" when nothing is detected.
 */
function detectLanguage(text) {
  const s = typeof text === "string" ? text : "";
  for (const [re, name] of SCRIPTS) if (re.test(s)) return name;

  let best = "English";
  let bestScore = 0;
  for (const [name, re] of LATIN) {
    const score = (s.match(re) || []).length;
    if (score > bestScore) {
      bestScore = score;
      best = name;
    }
  }
  return best;
}

/**
 * Whether the user asked for length.
 *
 * This flips the council's instruction from "Be concise" to "Be thorough", so a
 * false positive does not produce a wrong answer — it produces a padded one,
 * which is the complaint the synthesiser's rule 7 already exists to prevent.
 *
 * `write a` was a trigger and is deliberately gone: it matched "write a haiku",
 * "write a tweet" and "write a commit message", all of which are requests to be
 * SHORT. Every phrase left names length explicitly, so the ones that remain
 * cannot mean the opposite of the flag they set.
 */
const DETAIL_PHRASES = [
  "explain in detail",
  "detailed",
  "in depth",
  "in-depth",
  "comprehensive",
  "thorough",
  "step by step",
  "step-by-step",
  "deep dive",
  "elaborate",
  "full explanation",
  "essay",
];

function wantsDetailedAnswer(text) {
  const t = (typeof text === "string" ? text : "").toLowerCase();
  return DETAIL_PHRASES.some((p) => t.includes(p));
}

/**
 * Whether a Wikipedia lookup should join the search fan-out.
 *
 * Word-bounded, which the original was not. Unbounded `history` matched
 * "browser history", `born` matched "airborne" and "reborn", and `origin`
 * matched "original" and "originally" — the single most common word in this
 * list. Each false positive is one more provider in the fan-out, so it costs
 * latency on the path the whip is already tuned for rather than correctness.
 */
const WIKI_RE =
  /\b(what is|what are|who is|who was|who were|history|explain|definition|meaning of|tell me about|biography|born|origins?)\b/i;

function needsWikiCheck(text) {
  return WIKI_RE.test(typeof text === "string" ? text : "");
}

/**
 * Anchored, and matching the WHOLE message. An unanchored alternation routed
 * any short message merely CONTAINING one of these to the greeting path:
 * "which one?" matched "hi", "you sure?" matched "yo", "summary?" matched
 * "sup". A greeting gets no council, so those questions were answered by one
 * model at 200 tokens.
 */
const GREETING_RE =
  /^(hi|hello|hey|yo|sup|howdy|gm|good (morning|afternoon|evening))\b[\s!.,?]*$/i;

/**
 * How many members have to answer before synthesis may begin.
 *
 * TWO, and the number is the single biggest lever on how long a user waits.
 *
 * It was three. On a free plan the roster IS three, so the whip could only
 * resolve on unanimity or on its 30-second timer — every message, without
 * exception, waited for the slowest of three models to finish writing an answer
 * the user never sees. On pro it waited for the third of seven, which is the
 * same tail with more chances to be unlucky. The council runs in parallel, so
 * the cost of a quorum is not the average member's latency, it is the k-th
 * slowest; going from the 3rd to the 2nd removes an entire order statistic from
 * the critical path and takes the whole free-plan tier off "wait for the worst
 * one" semantics.
 *
 * Two is the floor rather than one because the synthesiser's whole job is to
 * reconcile independent answers — rules 2 and 3 of its prompt are about
 * disagreement, and one response cannot disagree with anything. At two it still
 * has something to reconcile; at one it is an expensive passthrough.
 *
 * Late answers are not wasted so much as unused: runCouncilWithWhip resolves
 * with whatever has landed, and the stragglers' `.then` still runs and pushes
 * into an array nobody reads. That is the accepted cost of not waiting.
 *
 * CEILING: on a seven-seat pro roster this now synthesises the two FASTEST
 * responses rather than the three fastest, and fast correlates with small.
 * If pro answers start reading as thin, this is the number to raise — not the
 * token limit below.
 */
const QUORUM = 2;

/**
 * How much council a message gets.
 *
 * The roster is a PARAMETER rather than a module-level constant so this stays
 * pure and so the plan decision (`pro` sees seven, free sees three) stays in
 * one place in the caller instead of being made twice.
 *
 * `detailed` likewise comes in rather than being recomputed: the caller already
 * ran wantsDetailedAnswer to decide the council's "Be thorough"/"Be concise"
 * instruction, and a token ceiling that disagreed with that instruction would
 * be the worst of both — a member told to be thorough and then cut off
 * mid-sentence. One decision, used twice.
 *
 * @param {string} text
 * @param {Array<{model: string, temperature: number}>} members  the seats this
 *   user is entitled to.
 * @param {boolean} [detailed]  whether the user asked for length.
 */
function classifyRequest(text, members, detailed = false) {
  const roster = Array.isArray(members) ? members : [];
  if (GREETING_RE.test((typeof text === "string" ? text : "").trim())) {
    return { members: [], quorum: 0, whipMs: 5000, tokenLimit: 200, category: "greeting" };
  }
  return {
    members: roster,
    quorum: Math.min(QUORUM, roster.length),
    whipMs: 30000,
    /* 1000 unless length was actually asked for, down from a flat 2000.
     *
     * A council member's output is a DRAFT. Nobody reads it: the synthesiser
     * reads all of them and writes the answer the user sees. Generation time is
     * roughly linear in tokens produced, and this leg is the one the whole
     * request blocks on, so a ceiling nobody's answer reaches costs nothing and
     * one that every answer reaches costs the difference in full.
     *
     * 1000 is the same ceiling callModel already defaults to everywhere else in
     * this codebase, and it pairs with the "Be concise" the council is told in
     * the same breath. When the user did ask for depth the old 2000 stands,
     * because there the length IS the product.
     *
     * CEILING: a concise-mode member with genuinely more to say is truncated,
     * and truncation reaches the synthesiser as a confident-looking half
     * sentence. The synthesis prompt's rule 10 is what covers that. If cut-off
     * drafts start showing up in answers, raise this before touching the
     * quorum. */
    tokenLimit: detailed ? 2000 : 1000,
    category: "council",
  };
}

module.exports = {
  detectLanguage,
  wantsDetailedAnswer,
  needsWikiCheck,
  classifyRequest,
  GREETING_RE,
  DETAIL_PHRASES,
};

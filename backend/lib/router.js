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
/**
 * HOW HARD THE QUESTION IS, decided from the text alone.
 *
 * WHY NOT ASK A MODEL. The obvious implementation is a FAST_MODEL call that
 * rates the question, and it is self-defeating: the call costs one OpenRouter
 * request and its own latency, on the critical path, to save requests and
 * latency. On a 50-request daily cap the classifier would be a fifth of the
 * budget it exists to protect. So this is characters and words, like every
 * other decision in this file, and like them it is checkable with a sentence.
 *
 * WHICH WAY TO BE WRONG. Under-rating is the expensive mistake: a hard question
 * answered by one model is confidently thin, and the user cannot see that it
 * was decided in the router. Over-rating only costs requests. So a complexity
 * signal ESCALATES unconditionally, while simplicity has to be earned by a
 * short question that also looks like a lookup — a message with no signal
 * either way lands in the middle rather than at the bottom.
 *
 * THE DEFAULT MOVED, AND THAT IS THE POINT. Every message used to get the whole
 * roster. The middle tier is now three seats, which is what actually lowers
 * usage, because most messages carry no signal at all. Three is not a rounding
 * of seven: it is the smallest roster the synthesiser can still do its job on,
 * for the same reason QUORUM is 2 rather than 1 — its prompt is about
 * reconciling disagreement, and there has to be some.
 *
 * CEILING, and it is a real one: this reads words, not meaning. "Prove that the
 * square root of two is irrational" is short, starts like a lookup, and is not
 * simple. `prove` and `derive` are in the escalation list for exactly that
 * case, but the general defect stands — a short sentence can be hard, and no
 * amount of pattern matching finds out. What protects the user is that the
 * middle tier is the default and the simple tier needs a lookup SHAPE, not just
 * brevity.
 */
const COMPLEX_RE =
  /\b(compare|comparison|contrast|difference between|versus|vs\.?|trade[- ]?offs?|pros and cons|advantages? and disadvantages?|evaluate|analy[sz]e|critique|assess|design|architect(ure)?|strategy|recommend|justify|prove|derive|optimi[sz]e|refactor|debug|troubleshoot|implement|migrate|refute|synthesi[sz]e|ethical implications?|which (?:database|framework|architecture|strategy|approach).{0,40}\b(?:use|choose))\b/i;

/**
 * A question whose answer is looked up or computed rather than reasoned out.
 * Anchored at the start, because these words only signal a lookup when the
 * message OPENS with them: "what is a monad" is a lookup, "tell me what is
 * wrong with this design" is not, and an unanchored test cannot tell them
 * apart — the same defect the greeting regex was anchored to fix.
 */
const LOOKUP_RE =
  /^(what|who|when|where|which|how (many|much|do you spell|do you say)|define|translate|spell|convert|calculate|solve|name)\b/i;

/**
 * A request to produce a document, rather than answer a question.
 *
 * The verb must be tied to a document-shaped object within a small bounded
 * window. That keeps "write a tweet" and "make a shopping list" out of the
 * long-draft path, while still treating school and work artefacts as work.
 * The standalone forms cover verbs whose object is implicit ("summarise this
 * chapter", "outline the proposal", "make a lesson plan") and the explicit
 * homework/assignment phrases. Translation is special: "translate hello to
 * Spanish" is a one-line lookup, but a passage is a document-sized input.
 *
 * This is deliberately an escalation signal only. It is checked before the
 * simplicity test, so a production request can never be made simpler by this
 * feature; a lookup wins only when no production signal is present.
 */
const GENERATION_RE =
  /\b(?:write|compose|draft|produce|create|make)\b(?:\W+\w+){0,6}\W+\b(?:essay|report|letter|story|poem|script|summary|outline|plan|lesson|proposal|presentation|article|blog|review|project|homework|assignment)\b|\b(?:summari[sz]e|outline|plan)\b|\bmy\s+(?:homework|assignment)\b|\btranslate\s+(?:this|the|following|a)\s+(?:passage|text|paragraph|article|chapter)\b/i;

function isGenerationRequest(text) {
  return GENERATION_RE.test(typeof text === "string" ? text : "");
}

/**
 * A question about what THIS assistant can do — "can you access Canva?", "do
 * you support plugins?", "are you able to browse the web?".
 *
 * These were landing in the three-seat middle tier, which is the wrong price for
 * a one-sentence answer: LOOKUP_RE is anchored on what/who/when/where/which, and
 * a capability question opens with a modal instead. Nothing about a panel helps
 * here either — three models reconciling their guesses about one product's
 * integrations is three chances to invent one.
 *
 * The object is REQUIRED, and it is what keeps this narrow. "Can you fix it" and
 * "could you make a poster" open identically and are work, not questions about
 * the assistant; they match the modal and not the object, so they stay in the
 * middle tier. Escalation still runs first, so "can you compare X and Y" is
 * complex before this is ever consulted.
 *
 * `use` IS NOT IN THE LIST and that is Sol's finding, not an oversight. "Can you
 * use Bayes' theorem to calculate the probability that this diagnosis is
 * correct" is under 200 characters, opens with the capability grammar, and is a
 * hard question — the regex cannot tell invoking a capability from asking
 * whether one exists. Every word left names the capability itself.
 *
 * ONE CLAUSE, which is the second half of the same finding. "Can you access the
 * database and determine why these records disagree" still matches `access`, and
 * a real capability question does not have a second verb after it. Ten words is
 * the cut, and it is a chosen number, not a measured one: the longest genuine
 * example here ("Do you have access to Google Drive?") is seven.
 */
const CAPABILITY_RE =
  /^(?:can|could|do|does|are|is|will|would)\s+(?:you|alop[-\s]?ai)\b(?:\W+\w+){0,6}\W+\b(?:access|browse|connect|integrate|support|plugins?|integrations?|internet|api)\b/i;

const isCapabilityQuestion = (t) =>
  CAPABILITY_RE.test(t) && (t.match(/\S+/g) || []).length <= 10;

/** Bare arithmetic — "15% of 80", "2+2", "144/12" — with no prose around it. */
const ARITHMETIC_RE = /^[\s\d+\-*/^%().,=x×÷]+\??$/;

/** A fenced block or an obvious snippet: never a simple question. */
const CODE_RE = /```|\bfunction\b|\bclass\b|=>|;\s*$|\{\s*$/m;

/**
 * @param {string} text
 * @param {boolean} [detailed] the caller's existing wantsDetailedAnswer result,
 *   passed in rather than recomputed so the two cannot disagree — the same
 *   reason `detailed` already decides the token ceiling.
 * @returns {"simple"|"moderate"|"complex"}
 */
function assessComplexity(text, detailed = false) {
  const t = typeof text === "string" ? text.trim() : "";
  if (!t) return "moderate";

  /* Asking for depth IS the escalation, stated by the user rather than guessed
   * at. It already buys a doubled token ceiling; it should buy the council too,
   * or "explain in detail" gets a longer answer from fewer minds. */
  if (detailed) return "complex";
  if (COMPLEX_RE.test(t) || CODE_RE.test(t) || isGenerationRequest(t)) return "complex";

  /* Two or more questions in one message is a conversation, not a lookup, even
   * when each half is short. Counted rather than pattern-matched because the
   * shapes vary and the count does not. */
  if ((t.match(/\?/g) || []).length >= 2) return "complex";

  /* Length as a proxy for how much there is to reconcile. 600 characters is
   * roughly a full paragraph — someone who has written that much has given the
   * council something to disagree about. Not a measurement; a chosen threshold,
   * and the one number here most worth revisiting against real transcripts. */
  if (t.length > 600) return "complex";

  /* SIMPLICITY IS EARNED, not assumed from brevity alone. Both halves are
   * required: short AND shaped like a lookup or a sum. "Fix it" is short and is
   * not a lookup; it stays in the middle tier where it can still be argued
   * over. 200 characters is about two sentences. */
  if (t.length <= 200 && (LOOKUP_RE.test(t) || ARITHMETIC_RE.test(t) || isCapabilityQuestion(t))) return "simple";

  return "moderate";
}

/**
 * A route the text itself proves, or null when the search planner still has a
 * real decision to make.
 *
 * The rule is intentionally asymmetric. A missed stable question costs one
 * small model call; a false no-search answer can state stale facts with no
 * visible warning. Volatility, URLs, years and named entities therefore fall
 * through. The cases accepted here are shapes the planner's own prompt already
 * declares stable: transformations, creative work, pasted code and lowercase
 * definitions. This removes the model from the critical path of the measured
 * trivial case without turning a regex into a current-affairs oracle.
 */
const MEMORY_REFERENCE_RE =
  /\b(?:what did i (?:ask|say|tell you)|what (?:did|have) we discuss|earlier in (?:this|our) (?:chat|conversation)|previous (?:message|conversation)|summari[sz]e what we discussed|recap (?:this|our) conversation)\b/i;
const VOLATILE_RE =
  /\b(?:latest|current(?:ly)?|today|tonight|right now|this (?:week|month|year)|still|newest|recent|upcoming|price|cost|stock|available|availability|version|release|maintained|ceo|president|prime minister|law|regulation|policy|news|weather|score|schedule|market|funding|ownership|best|recommend|under\s+(?:\$|\d)|(?:19|20)\d{2})\b/i;
const URL_RE = /\b(?:https?:\/\/|www\.)/i;
const EXPLICIT_WEB_SEARCH_RE = /\b(?:search|browse)\s+(?:the\s+)?(?:live\s+)?web\b|\blook\s+(?:it|this|that)\s+up\s+online\b/i;
const DIRECT_TRANSFORM_RE = /^(?:define|spell|translate)\b/i;
const CREATIVE_RE = /^(?:write|compose|make|tell me)\b[\s\S]{0,160}\b(?:haiku|poem|story|joke|riddle|limerick|tweet|commit message)\b/i;
const STABLE_QUESTION_RE = /^(?:what is (?:a|an|the)|what are|explain how|name (?:one|a|an|the))\b/i;

const hasNamedEntity = (text) => {
  const afterFirstWord = text.replace(/^\s*[A-Z][A-Za-z'-]*\b/, "");
  return /\b(?:[A-Z][A-Za-z0-9]*|[a-z]+[A-Z][A-Za-z0-9]*)\b/.test(afterFirstWord);
};

function routeByRule(text, { hasConversationContext = false } = {}) {
  const t = typeof text === "string" ? text.trim() : "";
  if (!t) return null;
  if (MEMORY_REFERENCE_RE.test(t)) {
    return hasConversationContext ? { memory: true, queries: null } : null;
  }
  /* An explicit request to use the web is an instruction, not a classification
   * problem. Sending it to the model router allowed a false NO to fall through
   * to the Wikipedia shortcut, which produced an uncited encyclopedia extract
   * for a request that literally said "Search the web". Remove a separate
   * command sentence when possible; otherwise keep the bounded user text as
   * the query. Provider adapters serialize it safely and clamp again. */
  if (EXPLICIT_WEB_SEARCH_RE.test(t)) {
    const withoutCommand = t
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => !EXPLICIT_WEB_SEARCH_RE.test(sentence))
      .join(" ")
      .trim();
    const query = (withoutCommand || t)
      .replace(/^(?:please\s+)?(?:search|browse)\s+(?:the\s+)?(?:live\s+)?web\s+(?:for\s+)?/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    return { memory: false, queries: query ? [query] : null };
  }
  if (VOLATILE_RE.test(t) || URL_RE.test(t)) return null;

  if (CODE_RE.test(t) || DIRECT_TRANSFORM_RE.test(t) || CREATIVE_RE.test(t)) {
    return { memory: false, queries: null };
  }
  if (t.length <= 200 && STABLE_QUESTION_RE.test(t) && !hasNamedEntity(t)) {
    return { memory: false, queries: null };
  }
  return null;
}

/** Seats per tier. `complex` is the whole roster, whatever size that is. */
const TIER_SEATS = { simple: 1, moderate: 3 };

/**
 * An unmeasured seat's assumed latency, in ms. Deliberately pessimistic and
 * deliberately FINITE: Infinity would make a seat with no measurement
 * unpickable, which quietly drops it from every narrowed roster and turns a
 * missing number into a permanent demotion. Finite means it loses to any
 * measured seat but can still be picked when it is the only one in its band.
 */
const UNMEASURED_MS = 30000;
const seatMs = (seat) => {
  const n = Number(seat?.medianMs);
  return Number.isFinite(n) && n >= 0 ? n : UNMEASURED_MS;
};

/**
 * Narrow a roster to `n` seats, keeping the temperature spread and taking the
 * fastest seat available at each point on it.
 *
 * THE OBVIOUS IMPLEMENTATION IS SLOWER THAN NOT NARROWING AT ALL, which is the
 * whole reason this function is not three lines. Slicing evenly across the
 * temperature ladder picks seats 0, 3 and 6 of seven — and on the measured
 * roster seat 0 is the 23.9s model. With QUORUM at 2 the turn then waits for
 * the second-fastest of {23.9s, 8.9s, 2.1s}, about 8.9s, where the FULL council
 * resolves in about 2.1s because it has more fast seats to choose from. The
 * middle tier would have been slower than the top one, which is absurd on its
 * face and would have shipped invisibly: nothing errors, the answer is fine,
 * and only a stopwatch on two tiers side by side ever shows it.
 *
 * So: split the temperature-sorted roster into `n` contiguous BANDS and take
 * the fastest seat in each. The spread survives, because one seat comes from
 * each region of the ladder, and the latency comes from the best available
 * member of each region rather than from its edge.
 *
 * The single-seat case restricts to the literal half of the ladder first. A
 * simple factual question answered by the most lateral seat on the board is the
 * wrong trade even when that seat is quick, and at n=1 there is no synthesis
 * step left to temper it.
 */
function narrowRoster(roster, n) {
  if (n >= roster.length) return roster;
  if (n <= 0) return [];

  const sorted = [...roster].sort((a, b) => (Number(a?.temperature) || 0) - (Number(b?.temperature) || 0));
  const fastest = (list) => list.reduce((best, seat) => (seatMs(seat) < seatMs(best) ? seat : best));

  if (n === 1) {
    const median = Number(sorted[Math.floor((sorted.length - 1) / 2)]?.temperature) || 0;
    const literal = sorted.filter((s) => (Number(s?.temperature) || 0) <= median);
    return [fastest(literal.length ? literal : sorted)];
  }

  const picked = [];
  for (let i = 0; i < n; i++) {
    /* Contiguous bands over the sorted roster. The arithmetic gives every band
     * at least one seat whenever n <= roster.length, which the guard above
     * already assures. */
    const start = Math.floor((i * sorted.length) / n);
    const end = Math.max(start + 1, Math.floor(((i + 1) * sorted.length) / n));
    picked.push(fastest(sorted.slice(start, end)));
  }
  return picked;
}

function classifyRequest(text, members, detailed = false) {
  const roster = Array.isArray(members) ? members : [];
  if (GREETING_RE.test((typeof text === "string" ? text : "").trim())) {
    return { members: [], quorum: 0, whipMs: 5000, tokenLimit: 200, category: "greeting", complexity: "simple" };
  }

  /* THE TIER NARROWS THE ROSTER, IT NEVER EXTENDS IT. `narrowRoster` only ever
   * returns a subset of what it was handed, so a free-plan user cannot be given
   * a seat their plan does not include no matter what they type — the plan
   * decision stays where it was, in the caller, and this cannot reach past it.
   */
  const complexity = assessComplexity(text, detailed);
  const seats = TIER_SEATS[complexity] ?? roster.length;
  const selected = narrowRoster(roster, seats);

  return {
    members: selected,
    /* AGAINST THE SELECTED SEATS, NOT THE FULL ROSTER, and this is the bug the
     * tiering would otherwise have introduced. Reading `roster.length` here
     * leaves quorum at 2 while the simple tier dispatches ONE seat, so the whip
     * can never reach its count and every simple question waits out the full
     * 30-second timer — the exact failure the "a full free roster does not need
     * unanimity" test was written for, reintroduced one level down. The tier
     * that exists to be fast would have been the slowest path in the product. */
    quorum: Math.min(QUORUM, selected.length),
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
    /* 2000 when the user asked for depth, 400 when the question is a lookup,
     * 1000 otherwise.
     *
     * THE 400 IS THE ONE THAT IS NEW, and it is worth more than it looks. A
     * seat's output is a DRAFT that only the synthesiser reads, generation time
     * is roughly linear in tokens produced, and this leg is what the whole
     * request blocks on. Giving a one-seat "what is the capital of France" the
     * same 1000-token budget as a design question buys nothing: the answer is
     * one sentence either way, and the ceiling only ever costs the difference
     * when a model decides to fill it.
     *
     * It is a CEILING, not a target, and 400 tokens is still several paragraphs
     * — comfortably more than any question that reaches this tier should need.
     * The tier is only ever chosen for messages that are both short and shaped
     * like a lookup, which is the check that makes this safe. */
    /* Generation drafts need room for the artefact itself. This is the
     * per-seat draft ceiling; server.js has a separate synthesis ceiling. */
    tokenLimit: isGenerationRequest(text) ? 4000 : detailed ? 2000 : complexity === "simple" ? 400 : 1000,
    category: "council",
    /* Returned so the caller can log which tier a turn took. Without it the
     * single most consequential routing decision in the product is invisible
     * after the fact, and "why was that answer thin" has no answer. */
    complexity,
  };
}

/**
 * THE ROSTER THE TURN GETS ONCE THE ROUTER HAS SAID "THIS NEEDS LIVE RESEARCH".
 *
 * classifyRequest runs from the text alone, before anything knows whether the
 * turn will search — it has to, because the roster decides the spend
 * reservation. So a short lookup-shaped question that turns out to need current
 * information was dispatched to ONE seat and then handed the agent tool loop:
 * the most expensive path in the product, run by the smallest possible council,
 * with no second seat to disagree when that one seat reads a bad source. Live
 * research is the case where reconciling independent readings is worth the most,
 * and it was getting the least.
 *
 * Pure, and it only ever WIDENS to the roster it is handed — the plan decision
 * stays in the caller, exactly as it does for narrowRoster, so this cannot give
 * a free user a seat their plan does not include.
 *
 * The caller must have RESERVED for this roster already. Re-expanding a budget
 * below the layer that set it is the failure this codebase has hit three times;
 * server.js reserves the pessimistic seat count up front for any turn that could
 * reach here, and refunds the difference in its `finally`.
 *
 * @param {object} selection  a classifyRequest result.
 * @param {Array} roster  the full set of seats this user is entitled to.
 */
function escalateForResearch(selection, roster) {
  const full = Array.isArray(roster) ? roster : [];
  const current = Array.isArray(selection?.members) ? selection.members : [];
  if (full.length <= current.length) return selection;
  return {
    ...selection,
    members: full,
    quorum: Math.min(QUORUM, full.length),
    /* The token ceiling comes back up with the roster. A 400-token draft is the
     * simple tier's bargain — one seat, one sentence — and a seat that has just
     * read three pages has more to report than that. Never DOWN: a turn the user
     * asked for depth on keeps its 2000. */
    tokenLimit: Math.max(Number(selection?.tokenLimit) || 0, 1000),
    /* Reported, because the tier is what the logs and the audit row explain a
     * turn by, and "simple" beside a seven-seat tool loop is a lie in the one
     * place someone would go to find out what happened. */
    complexity: "complex",
  };
}

module.exports = {
  detectLanguage,
  wantsDetailedAnswer,
  needsWikiCheck,
  classifyRequest,
  assessComplexity,
  routeByRule,
  narrowRoster,
  escalateForResearch,
  GREETING_RE,
  DETAIL_PHRASES,
  GENERATION_RE,
  TIER_SEATS,
};

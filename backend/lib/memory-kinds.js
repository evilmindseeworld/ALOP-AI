'use strict';

const { agreementScore, numbers, coverage, negationCount } = require('./text-similarity');

/**
 * FOUR KINDS OF MEMORY, WHICH IS WHAT ONE TABLE CALLED `user_facts` HAS BEEN
 * HOLDING ALL ALONG.
 *
 * The extractor produces "durable facts about the person" and everything it
 * produces is stored, recalled and trusted identically. That is wrong in four
 * different directions at once, and each one is visible in an answer:
 *
 *   SEMANTIC    "works in TypeScript". Context. True until it isn't. Recalled
 *               when the turn is about something related.
 *   PREFERENCE  "wants short answers". An INSTRUCTION, not context — it should
 *               reach the model on every turn and outrank its own defaults,
 *               which is exactly what a nearest-neighbour recall will not do,
 *               because "answer briefly" is not semantically near "what is the
 *               capital of France".
 *   PROCEDURE   "deploys with npm run ship". Recalled when the turn is about
 *               doing that thing.
 *   EPISODIC    "asked about the pricing page". Chat-scoped, and the one kind
 *               that must never cross chats — migration 001 moved
 *               conversation_summary off `users` for precisely this reason.
 *
 * WORKING MEMORY IS DELIBERATELY NOT HERE. It is the current turn's own
 * context, it lives for one request, and giving it a row would mean writing and
 * deleting a database row inside the latency budget of every turn.
 *
 * THE CLASSIFIER IS A REGEX, AND THAT IS A CHOICE. The alternative is a model
 * call on the write path of every turn that produced a fact — a second request
 * against an account-wide daily cap to sort text the shape of which is already
 * distinctive. When it is wrong, the cost is a preference recalled semantically
 * instead of always, which is the behaviour that exists today for everything.
 */

/* An instruction about how to answer, not information about the world.
 * "prefers", "wants", "always", "never", "don't" plus an answer-shaped object. */
const PREFERENCE_RE = /\b(prefers?|wants?|likes?|dislikes?|hates?|always|never|avoid|don't|do not|should (?:not )?(?:use|write|include|mention)|asks? (?:for|that)|expects?)\b/i;
const PREFERENCE_OBJECT_RE = /\b(answer|answers|response|responses|reply|replies|explanation|tone|style|format|length|brief|short|long|detailed|concise|bullet|markdown|code|example|language|jargon|emoji)\b/i;

/* How this user does a thing: a command, a tool, a sequence. */
const PROCEDURE_RE = /\b(deploys?|builds?|runs?|tests?|ships?|releases?|installs?|configures?|uses? the .* (?:command|script|pipeline)|workflow|process is|steps? (?:are|is))\b/i;
const COMMAND_RE = /(?:^|\s)(?:npm|npx|yarn|pnpm|git|docker|make|cargo|pip|python|node|bun|deno)\s+[a-z][\w:-]*/i;

/* Bound to a moment rather than to the person. */
const EPISODIC_RE = /\b(asked|mentioned|said|reported|was (?:looking|working) (?:at|on)|this (?:chat|conversation|session)|earlier|just now|today|yesterday)\b/i;

/**
 * @param {string} fact
 * @param {{chatScoped?: boolean}} [opts] the caller knows whether it is writing
 *   inside one chat; a chat-scoped write can only be episodic.
 * @returns {'semantic'|'preference'|'procedure'|'episodic'}
 */
function classifyFact(fact, { chatScoped = false } = {}) {
  const text = String(fact || '');
  if (chatScoped) return 'episodic';

  /* PREFERENCE FIRST, and it needs BOTH halves. "prefers TypeScript" is a
   * semantic fact about the person; "prefers short answers" is an instruction
   * about this system's output. The object is what tells them apart, and
   * without that test every stated liking became an instruction. */
  if (PREFERENCE_RE.test(text) && PREFERENCE_OBJECT_RE.test(text)) return 'preference';
  if (COMMAND_RE.test(text) || PROCEDURE_RE.test(text)) return 'procedure';
  if (EPISODIC_RE.test(text)) return 'episodic';
  return 'semantic';
}

/**
 * WHEN A FACT STOPS BEING TRUE ON ITS OWN.
 *
 * Most do not, and inventing an expiry for them would quietly empty the memory
 * — which is worse than keeping a stale fact, because the user can correct a
 * stale fact and cannot notice a missing one. Only two things expire: an
 * episodic memory, which is about a moment, and a fact whose own words bound it
 * ("this week", "until March").
 *
 * @returns {number|null} ms from now, or null for "no expiry"
 */
const BOUNDED_RE = /\b(this (?:week|month|sprint|quarter)|until|by (?:the end of|next)|temporar\w*|for now|right now|currently|at the moment)\b/i;

function ttlFor(kind, fact) {
  if (kind === 'episodic') return 90 * 24 * 3600 * 1000;
  if (BOUNDED_RE.test(String(fact || ''))) return 30 * 24 * 3600 * 1000;
  return null;
}

/**
 * DOES THIS NEW FACT CONTRADICT ONE WE ALREADY HOLD?
 *
 * The write path today asks only whether a candidate is NEW — `newFacts`
 * compares normalised text and drops near-duplicates. What it cannot see is the
 * candidate that is not a duplicate and not compatible: "works at Acme" against
 * "works at Globex", "prefers short answers" against "prefers detailed
 * answers". Both get stored, both are injected at system position, and the
 * model is handed a contradiction about the user with no way to tell which is
 * current.
 *
 * WHAT HAPPENS ON A CONFLICT IS NOT DECIDED HERE. This reports; the caller
 * decides, because "the new one wins" is right for a changed job and wrong for
 * a misheard one, and only the caller knows how the fact arrived. The default
 * the writer uses — supersede on a same-subject conflict, because the user just
 * said it — is stated where it is applied.
 *
 * @param {string} candidate
 * @param {Array<{fact: string, kind?: string}>} existing
 * @returns {Array<{fact: string, reason: 'polarity'|'value'}>}
 */
function conflictsWith(candidate, existing = []) {
  const text = String(candidate || '');
  if (!text.trim()) return [];
  const candidateFigures = new Set(numbers(text));

  return existing
    .map((row) => {
      const other = typeof row === 'string' ? row : row?.fact;
      if (!other || !other.trim()) return null;

      /* SAME SUBJECT IS THE PRECONDITION. Two facts about different things are
       * two facts, not a contradiction — and a memory that reports every
       * unrelated pair as conflicting is a memory nobody will let write. */
      const sameSubject = coverage(text, other) >= 0.4 || coverage(other, text) >= 0.4;
      if (!sameSubject) return null;

      /* Already near-identical: that is a duplicate, which the writer's own
       * dedupe handles, and calling it a conflict would block every restatement
       * of something the user has said before. */
      if (agreementScore(text, other) >= 0.8) return null;

      const otherFigures = new Set(numbers(other));
      if (candidateFigures.size && otherFigures.size) {
        let shared = 0;
        for (const f of candidateFigures) if (otherFigures.has(f)) shared += 1;
        if (shared === 0) return { fact: other, reason: 'value' };
      }

      if (Math.abs(negationCount(text) - negationCount(other)) >= 1) {
        return { fact: other, reason: 'polarity' };
      }

      /* Same subject, no shared figures to compare, same polarity, and not a
       * paraphrase — two different values for one attribute ("works at Acme" /
       * "works at Globex"). */
      if (agreementScore(text, other) >= 0.45) return { fact: other, reason: 'value' };
      return null;
    })
    .filter(Boolean);
}

/**
 * What recall should ask for, given what the turn is.
 *
 * PREFERENCES ARE NOT RETRIEVED BY SIMILARITY. They are instructions, and an
 * instruction that only arrives when it happens to be semantically near the
 * question is an instruction that applies at random. Every turn gets all of
 * them, up to a small cap; everything else is retrieved by what the turn is
 * about.
 */
function recallPlan({ chatId = null, limit = 8, preferenceCap = 4 } = {}) {
  return [
    { kind: 'preference', mode: 'all', limit: preferenceCap, chatId: null },
    { kind: 'semantic', mode: 'relevance', limit, chatId: null },
    { kind: 'procedure', mode: 'relevance', limit: Math.max(2, Math.floor(limit / 2)), chatId: null },
    /* Chat-scoped, always, and null chatId means it is not asked for at all —
     * not "asked for across every chat". */
    ...(chatId ? [{ kind: 'episodic', mode: 'relevance', limit, chatId }] : []),
  ];
}

module.exports = { classifyFact, ttlFor, conflictsWith, recallPlan, KINDS: ['semantic', 'preference', 'procedure', 'episodic'] };

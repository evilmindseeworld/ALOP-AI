'use strict';

/**
 * Which optional pieces of a turn are worth doing, decided once, before any of
 * them start.
 *
 * WHY THIS IS A REAL SAVING AND NOT A TIDY-UP. The context fan-out is
 * unconditional: every non-greeting turn reads the conversation summary, the
 * feedback guidance and the user's facts from Supabase, and embeds the question
 * twice — once for the semantic fact search, once for the semantic answer
 * cache. Then the route decides whether to USE any of it:
 *
 *     const profileContextAllowed = hasConversationHistory;
 *     ...(profileContextAllowed && userFacts.length ? [factsBlock(userFacts)] : [])
 *     ...(profileContextAllowed && feedbackGuidance ? [...] : [])
 *
 * So on the FIRST message of every conversation — which is every conversation,
 * once — the turn pays for two Supabase round trips and an embedding call whose
 * results it has already decided to throw away. The gate existed; it was just
 * applied after the work instead of before it.
 *
 * The same shape appears twice more. The answer-cache embedding is computed even
 * when the turn is personalised and therefore has no cache key at all, and the
 * fact embedding is computed for a user who has no facts to search.
 *
 * PURE AND DECIDED UP FRONT, for the reason lib/router.js gives about
 * `classifyRequest`: a decision that is spread across the code as five separate
 * `if`s is a decision nobody can read, test, or change safely. This returns one
 * object; the route consults it and nothing else.
 *
 * EVERY SKIP IS A JUDGEMENT ABOUT WHAT THE ANSWER NEEDS, NEVER ABOUT COST
 * ALONE. Where the two disagree the answer wins — a skip that makes an answer
 * worse has bought latency with quality, which is not a trade this product
 * makes silently.
 */

/**
 * @param {object} input
 * @param {boolean} input.hasImage                 an attachment is present
 * @param {boolean} input.hasConversationHistory   a summary or prior turns exist
 * @param {boolean} input.cacheEligible            the turn can have a cache key
 * @param {boolean} input.semanticCacheEnabled     COUNCIL_SEMANTIC_CACHE
 * @param {boolean} input.userHasFacts             the user has stored facts
 * @param {string}  input.category                 the router's classification
 * @param {boolean} input.wikiCandidate            needsWikiCheck said yes
 * @returns {{
 *   summary: boolean, feedback: boolean, facts: boolean,
 *   factEmbedding: boolean, semanticEmbedding: boolean,
 *   vision: boolean, wiki: boolean, reasons: object
 * }}
 */
function planWork({
  hasImage = false,
  hasConversationHistory = false,
  cacheEligible = false,
  semanticCacheEnabled = false,
  userHasFacts = true,
  category = 'general',
  wikiCandidate = false,
} = {}) {
  const reasons = {};
  const skip = (key, why) => { reasons[key] = why; return false; };

  /* A greeting needs none of it. The fast path above the router already returns
   * before this is consulted on most greetings; this covers the ones that reach
   * the router — a greeting with an attachment, or one the cache missed. */
  const greeting = category === 'greeting';

  /* THE SUMMARY IS THE ONE THING KEPT UNCONDITIONALLY on a non-greeting turn.
   * It is what tells us whether a conversation HAS history, so skipping it on
   * the grounds that there is no history is circular. It is also one indexed
   * read of a single row. */
  const summary = greeting ? skip('summary', 'greeting') : true;

  /* PROFILE CONTEXT IS ONLY INJECTED WHEN A CONVERSATION EXISTS — that rule is
   * the route's, not this module's invention, and it is why reading these on a
   * first message was always waste. */
  const profileUsable = hasConversationHistory && !greeting;
  const feedback = profileUsable ? true : skip('feedback', greeting ? 'greeting' : 'first message in this conversation');
  const facts = !profileUsable
    ? skip('facts', greeting ? 'greeting' : 'first message in this conversation')
    : userHasFacts ? true : skip('facts', 'this user has no stored facts');

  /* An embedding for a search that will not happen. `readUserFacts` falls back
   * to recency when it has no embedding, so this degrades rather than breaks. */
  const factEmbedding = facts ? true : skip('factEmbedding', reasons.facts);

  /* And an embedding for a cache that has no key to write under. `cacheEligible`
   * is false for a personalised turn or one with an attachment, and on those
   * the semantic lookup and the semantic write are both impossible. */
  const semanticEmbedding = !semanticCacheEnabled
    ? skip('semanticEmbedding', 'semantic cache disabled')
    : cacheEligible ? true : skip('semanticEmbedding', 'turn has no cache key');

  const vision = hasImage;

  /* Wikipedia is a second network hop and a second synthesis. An image turn is
   * about the image, and a greeting is about nothing. */
  const wiki = !wikiCandidate
    ? skip('wiki', 'question has no encyclopaedic subject')
    : hasImage ? skip('wiki', 'the question is about the attachment')
      : greeting ? skip('wiki', 'greeting') : true;

  return { summary, feedback, facts, factEmbedding, semanticEmbedding, vision, wiki, reasons };
}

/** A one-line log of what was skipped and why. Empty string when nothing was. */
function describeSkips(plan) {
  const entries = Object.entries(plan?.reasons || {});
  if (!entries.length) return '';
  return entries.map(([what, why]) => `${what}(${why})`).join(' ');
}

module.exports = { planWork, describeSkips };

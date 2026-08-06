/**
 * Conversation history arrives from the client, so it is input, not state.
 *
 * Two routes accept it — `/api/council` and `/api/overlay` — and they trusted
 * it to different degrees, which is the tell that neither had decided how much
 * to trust it. `/api/council` sanitised roles and clipped each message.
 * `/api/overlay` did this:
 *
 *     const histArr = Array.isArray(history) ? history.slice(-4) : [];
 *     const overlayMsgs = [{ role: 'system', content: '...' }, ...histArr, ...]
 *
 * — spreading client-supplied objects straight into the message array with no
 * check on role, on content type, or on size.
 *
 * THREE THINGS THAT FIXES.
 *
 * 1. A CLIENT COULD SEND `role: "system"`. Both routes allowed it: overlay
 *    because it checked nothing, council because `system` was in its allowed
 *    list. A system message supplied by the caller lands AFTER the one the
 *    server wrote, and a later system message is how you override an earlier
 *    one. Everything the product promises in a prompt was reachable from the
 *    request body — the extraction path's "use ONLY the provided data", the
 *    synthesiser's rule against inventing a justification, the language
 *    instruction. Those rules are the product's groundedness claim, so a client
 *    that can switch them off can make the app confidently make things up.
 *
 *    The real client never sends one. `useChats.js` maps every entry to
 *    `{ role: m.role, content: ... }` from stored chat messages, which are only
 *    ever `user` or `assistant`. Nothing legitimate is lost by refusing it.
 *
 * 2. HISTORY HAD NO TOTAL SIZE. Each message was clipped to MAX_PROMPT
 *    (100,000 characters) and up to 20 were kept, so a request could carry two
 *    million characters of history — and the council fans that out to seven
 *    models. The real client sends at most eight turns of four thousand
 *    characters. The server accepted about sixty times what its own frontend
 *    can produce, which is the shape of a limit that was written per-item and
 *    never totalled.
 *
 * 3. NON-STRING CONTENT REACHED THE MODEL. `/api/overlay` never checked, so
 *    `{ role: 'user', content: { ... } }` was passed through to be serialised
 *    into the upstream request as whatever JSON.stringify made of it.
 *
 * The budgets below are set against what the real client actually sends, with
 * headroom, rather than against what felt large: per-message is double the
 * client's clip, the total is roughly one and a half times the most it can
 * send. Both are characters rather than tokens on purpose — a tokenizer is a
 * dependency and a cost, and the ratio only has to be good enough to bound the
 * request. Roughly four characters to a token.
 */

/** Roles a CLIENT may supply. `system` is deliberately absent — see above. */
const CLIENT_ROLES = new Set(["user", "assistant"]);

/** Turns kept. The client sends 8; this is the ceiling, not the target. */
const MAX_MESSAGES = 20;

/** Per message. The client clips to 4,000. */
const MAX_MESSAGE_CHARS = 8000;

/** Across all retained messages. The client's own maximum is about 32,000. */
const TOTAL_BUDGET_CHARS = 48000;

/**
 * Clean a client-supplied history into something safe to spread into a message
 * array.
 *
 * Newest-first when spending the budget, then restored to chronological order:
 * if something has to be dropped it must be the oldest turn, because the most
 * recent one is what the user's next sentence refers to. Dropping from the
 * front would silently answer a follow-up without its antecedent.
 *
 * @param {unknown} raw whatever arrived in the request body.
 * @param {object} [limits] overrides, for the routes that want less.
 * @returns {{role: string, content: string}[]} always an array — never null,
 *   never a validation envelope. A caller that has to ask "is this an error or
 *   a value" is a caller that will get it wrong on one of its branches, which
 *   is what the previous `if (!h) return []` shape produced.
 */
function sanitizeHistory(raw, limits = {}) {
  const maxMessages = limits.maxMessages ?? MAX_MESSAGES;
  const maxMessageChars = limits.maxMessageChars ?? MAX_MESSAGE_CHARS;
  const totalBudget = limits.totalBudget ?? TOTAL_BUDGET_CHARS;

  if (!Array.isArray(raw)) return [];

  const cleaned = [];
  for (const m of raw) {
    if (!m || typeof m !== "object" || Array.isArray(m)) continue;
    // A non-string content is dropped rather than coerced. String(obj) is
    // "[object Object]", which is worse than the message not being there: it
    // reads to the model as a turn that happened and said nothing.
    if (typeof m.content !== "string") continue;
    const content = m.content.slice(0, maxMessageChars);
    if (!content.trim()) continue;
    // Anything that is not a client role becomes `user`, rather than being
    // dropped. A refused `system` message still carries what the user typed,
    // and demoting it keeps the turn count honest while removing the
    // authority — dropping it would let a client silently delete turns from
    // its own transcript, which changes what the model thinks was said.
    const role = CLIENT_ROLES.has(m.role) ? m.role : "user";
    cleaned.push({ role, content });
  }

  // Newest-first, spend the budget, then put them back in order.
  const kept = [];
  let spent = 0;
  for (let i = cleaned.length - 1; i >= 0 && kept.length < maxMessages; i--) {
    const cost = cleaned[i].content.length;
    // `kept.length &&` so the newest turn is always kept, even if it alone
    // exceeds the budget. With the defaults it cannot — every message is
    // already clipped well below the total — but a caller passing its own
    // limits should get a short history, never an empty one, because an empty
    // history is indistinguishable from a new conversation.
    if (kept.length && spent + cost > totalBudget) break;
    spent += cost;
    kept.push(cleaned[i]);
  }
  return kept.reverse();
}

module.exports = {
  sanitizeHistory,
  CLIENT_ROLES,
  MAX_MESSAGES,
  MAX_MESSAGE_CHARS,
  TOTAL_BUDGET_CHARS,
};

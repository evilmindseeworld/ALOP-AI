'use strict';

/**
 * WHAT A TURN ANSWERS WITH WHEN THE SYNTHESISER NEVER WROTE A WORD.
 *
 * The council's drafts are the most expensive thing a turn owns: every seat was
 * dispatched, waited on under the whip, and charged against the user's daily
 * allowance before synthesis was asked for anything. When the synthesiser then
 * fails — its head stalled and every rung of its fallback chain started with a
 * turn budget the head had already spent — the route used to write an error
 * frame on top of all of that. Measured on production turns 2026-08-20: two of
 * the four turns carrying reliability telemetry ended exactly that way, with
 * `msToFirstByte: null`, `abortReason: "turn_deadline"`, and usable council
 * drafts sitting unread in memory.
 *
 * A raw seat draft is a worse answer than a synthesis. It is a very much better
 * answer than an error, it costs no provider call, and it adds no wall clock:
 * the text is already here.
 *
 * NOT A FALLBACK MODEL AND NOT A RETRY. Nothing here calls anything. This
 * decides only whether the bytes we already hold may be sent, which is why it
 * is a pure function and why the two refusals below can be tested at all.
 *
 * @param {object}  opts
 * @param {boolean} [opts.aborted]     the turn signal fired — the user left
 * @param {number}  [opts.wroteChars]  characters of THIS turn's answer already
 *                                     on the socket
 * @param {Array<{content?: string}|string>} [opts.drafts] council responses, in
 *                                     the order the route holds them
 * @returns {string|null} the draft to send, or null to leave the failure alone
 */
function degradeAnswer({ aborted = false, wroteChars = 0, drafts = [] } = {}) {
  /* A cancelled turn is not a failed one. Writing into a socket the user has
   * left reports a completed turn to the ledger and reaches nobody. */
  if (aborted) return null;
  /* Never after a partial answer — streamModel's own rule for its fallback
   * chain, and it holds harder here: the draft is a DIFFERENT answer, so
   * appending it produces one reply that changes its mind mid-sentence. */
  if (Number(wroteChars) > 0) return null;
  for (const draft of Array.isArray(drafts) ? drafts : []) {
    const text = String((typeof draft === 'string' ? draft : draft?.content) ?? '').trim();
    /* An empty draft streams as a blank answer, which is the one outcome worse
     * than the error frame this replaces. Skip it and keep looking. */
    if (text) return text;
  }
  return null;
}

module.exports = { degradeAnswer };

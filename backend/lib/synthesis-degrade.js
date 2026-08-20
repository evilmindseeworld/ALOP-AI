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
 * is a pure function and why the refusals below can be tested at all.
 *
 * WHICH ABORT. `aborted` is the TURN signal — and in `server.js` the only
 * `turnController.abort(...)` is the client-disconnect handler. The 75s turn
 * deadline aborts a COMPOSITE signal built by lib/stream-deadline.js and
 * leaves the turn signal untouched, on purpose ("the parent's reason travels
 * unchanged... relabelling one as the other is how a telemetry field starts
 * lying"). So a deadline-killed synthesis arrives here with `aborted: false`,
 * which is exactly the case this exists for. Passing a deadline-derived flag
 * as `aborted` would switch this whole path off and nothing would fail.
 *
 * @param {object}  opts
 * @param {boolean} [opts.aborted]     the turn signal fired — the user left
 * @param {number}  [opts.wroteChars]  characters of THIS turn's answer already
 *                                     on the socket
 * @param {Array<{content?: string}|string>} [opts.drafts] council responses, in
 *                                     the order the route holds them
 * @returns {string|null} the draft to send, or null to leave the failure alone
 */
/**
 * DRAFTS ARE WRITTEN FOR THE SYNTHESISER, NOT FOR THE READER, AND THAT IS THE
 * DIFFERENCE THIS GUARDS.
 *
 * Every seat is told "You are an elite AI expert in the ALOP-AI Council. If
 * outside your expertise, reply ONLY 'SKIP'." Its draft was only ever going to
 * be read by the Chief Synthesiser, whose own rule 6 is to never mention the
 * panel; sending a draft straight to the user removes that filter. The seat
 * text is already `sanitizeAnswerText`-clean at every producer — the tools path
 * through `parseToolRequests`, the plain council and the tool fallback through
 * explicit calls — so protocol blobs and tool fences are gone before this. What
 * survives that is the FRAMING.
 *
 * A DENY-LIST THAT REJECTS, NEVER REWRITES. Editing a model's prose with
 * regexes produces sentences nobody wrote; this only decides whether a draft is
 * fit to send, and the next draft (or the error frame) takes over when it is
 * not. Each pattern is self-referential on purpose — a bare "council" or
 * "experts disagree" is ordinary English about the Council of Trent or about
 * nutrition, and matching those would reject real answers.
 */
const INTERNAL_FRAMING = [
  /* Our own roster's name, which only the seat prompt supplies. */
  /alop[\s-]?ai council/i,
  /* The synthesiser's input format, if a seat ever echoes it back. */
  /^\s*(?:\*\*)?\[?expert\s*\d/im,
  /* A refusal WITH a reason. `isUsableAnswer` only rejects a bare "skip", so
   * "SKIP — outside my expertise" is long enough to count as an answer and
   * would read to the user as the product declining to help. */
  /^\s*skip\b/i,
  /* Belt and braces: every producer sanitises, and a fence here would mean one
   * stopped. Cheaper to refuse the draft than to stream a tool call. */
  /```[ \t]*tool[_-]?call/i,
];

/** @param {string} text @returns {boolean} */
const looksInternal = (text) => INTERNAL_FRAMING.some((re) => re.test(text));

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
    if (!text) continue;
    /* Same treatment for one that would show the user the machinery. Keep
     * looking: on a three-seat roster the next draft is usually clean, and
     * running out of drafts lands on the error frame, which is where this
     * turn was going anyway. */
    if (looksInternal(text)) continue;
    return text;
  }
  return null;
}

module.exports = { degradeAnswer, looksInternal };

'use strict';

const { assessAnswer } = require('./answer-contract');

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

/**
 * THE OTHER HALF OF SAFETY, AND IT IS PROVENANCE RATHER THAN PROSE.
 *
 * `lib/model-reply.js` falls back from `content` to `reasoning` when a model
 * writes its answer into the reasoning field — kept deliberately, because
 * removing it blanks every seat on such a model — and LABELS the result:
 * `textSource` is 'content' or 'reasoning'. Its header names this caller: "a
 * caller that must not show internal reasoning to a user... can now test
 * `textSource` instead of guessing."
 *
 * Reasoning is REFUSED, never sanitised. A scratchpad is not a badly formatted
 * answer; there is no deterministic edit that turns "wait, no, let me
 * reconsider" into something a reader should be shown.
 *
 * UNKNOWN COUNTS AS UNSAFE. A producer that does not record where its text
 * came from loses the recovery rather than getting a silent exemption from it
 * — which is the property that makes this a provenance check instead of a
 * naming convention, and it is what makes a missed plumbing site fail loudly
 * (no degradation) rather than quietly (a scratchpad on someone's screen).
 */
const SAFE_TEXT_SOURCES = new Set(['content']);

/**
 * A refusal is a complete answer to a disallowed request, but only when it is
 * still a refusal rather than a refusal followed by a substantive payload.
 * Keep this deliberately narrow: the lifecycle may skip synthesis only for a
 * short, refusal-only sentence that every completed seat independently gave.
 */
const REFUSAL_ONLY_RE = /^(?:(?:i am sorry|i'm sorry|sorry)[,;:]?\s+)?(?:but\s+)?i\s+(?:can't|cannot|can not|won't|will not|am unable to|am not able to)\s+(?:comply|assist|help|provide|share|reveal|fulfill|answer|do)(?:\s+(?:with|about))?\s+(?:that|this|the|your)(?:\s+request)?[.!]?$/i;

const normaliseRefusalText = (text) => String(text ?? '')
  .normalize('NFKC')
  .replace(/[’‘]/gu, "'")
  .replace(/\s+/gu, ' ')
  .trim();

/** @param {string} text @returns {boolean} */
const isSafeRefusalText = (text) => {
  const normalised = normaliseRefusalText(text);
  return normalised.length <= 180 && REFUSAL_ONLY_RE.test(normalised);
};

/**
 * Resolve a unanimous refusal before a synthesis request is made.
 *
 * The caller supplies the configured roster size so quorum is not mistaken for
 * completion. `blockedByEvidence` prevents a refusal from bypassing research
 * or a truncated tool round, and `isCandidate` lets the route retain its
 * stronger output-contract checks.
 *
 * @param {Array<object>} drafts
 * @param {object} opts
 * @param {number} [opts.expectedSeats]
 * @param {boolean} [opts.blockedByEvidence]
 * @param {(draft: object) => boolean} [opts.isCandidate]
 * @returns {string|null}
 */
function resolveSafeRefusal(drafts, {
  expectedSeats,
  blockedByEvidence = false,
  isCandidate = isSafeDraft,
} = {}) {
  if (!Array.isArray(drafts) || drafts.length === 0 || blockedByEvidence) return null;
  if (Number.isInteger(expectedSeats) && drafts.length !== expectedSeats) return null;

  const candidates = [];
  for (const draft of drafts) {
    let accepted = false;
    try { accepted = isCandidate(draft); } catch { accepted = false; }
    if (!accepted) return null;
    const original = String(draft.content ?? '').trim();
    const normalised = normaliseRefusalText(original);
    if (!isSafeRefusalText(normalised)) return null;
    candidates.push({ original, normalised });
  }

  if (new Set(candidates.map(({ normalised }) => normalised)).size !== 1) return null;
  return candidates[0].original;
}

/**
 * May this council draft be shown to a reader as it stands?
 *
 * Shared with the one-seat solo branch in `server.js`, which streams a draft
 * directly and writes it to the SHARED answer cache. Two copies of this rule
 * would drift, and the drift would be invisible until someone read a model's
 * inner monologue.
 *
 * @param {{content?: string, textSource?: string, finishReason?: string}} draft
 */
function isSafeDraft(draft) {
  if (!draft || typeof draft !== 'object') return false;
  const text = String(draft.content ?? '').trim();
  if (!text) return false;
  if (!SAFE_TEXT_SOURCES.has(draft.textSource)) return false;
  if (!assessAnswer({ answer: text, finishReason: draft.finishReason }).ok) return false;
  return !looksInternal(text);
}

function degradeAnswer({ aborted = false, wroteChars = 0, drafts = [], draftGuard = isSafeDraft } = {}) {
  /* A cancelled turn is not a failed one. Writing into a socket the user has
   * left reports a completed turn to the ledger and reaches nobody. */
  if (aborted) return null;
  /* Never after a partial answer — streamModel's own rule for its fallback
   * chain, and it holds harder here: the draft is a DIFFERENT answer, so
   * appending it produces one reply that changes its mind mid-sentence. */
  if (Number(wroteChars) > 0) return null;
  /* THE FIRST SAFE DRAFT IN THE ROUTE'S OWN ORDER. An empty one streams as a
   * blank answer, one carrying the council's framing shows the machinery, and
   * one sourced from reasoning is a scratchpad — each is skipped rather than
   * repaired, and running out of drafts lands on the error frame, which is
   * where this turn was going anyway. */
  const guard = typeof draftGuard === 'function' ? draftGuard : isSafeDraft;
  for (const draft of Array.isArray(drafts) ? drafts : []) {
    try {
      if (guard(draft)) return String(draft.content).trim();
    } catch {
      /* A guard is safety policy; a broken policy must refuse the draft. */
    }
  }
  return null;
}

module.exports = {
  degradeAnswer,
  looksInternal,
  isSafeDraft,
  isSafeRefusalText,
  resolveSafeRefusal,
};

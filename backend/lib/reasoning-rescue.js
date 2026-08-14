'use strict';

/**
 * Whether a stream's held internal reasoning may stand in as the answer.
 *
 * WHY IT IS A MODULE. The rule is three lines, but it is the rule that decides
 * whether chain-of-thought reaches a user, gets saved into their chat and is
 * written to the answer cache other users read. It lived inside `streamOnce` in
 * `server.js`, which cannot be required in a test (the file calls
 * `process.exit(1)` at import when env vars are missing), so the one decision
 * worth pinning was the one decision nothing could exercise.
 *
 * THE RULE, and it is the same one lib/model-reply.js applies off-stream:
 * reasoning becomes an answer only when the stream produced no answer content
 * at all. Interleaving is never allowed — a model that writes both is writing
 * its thinking beside its answer, not instead of it.
 *
 * @param {object} params
 * @param {number} params.emittedLength   answer chunks already written to the socket
 * @param {string[]} params.reasoningParts  reasoning deltas, in arrival order
 * @param {(text: string) => {text: string, rejected?: boolean}} params.sanitize
 *        the same protocol sanitiser every other answer passes through, so a
 *        model that "thinks" in tool-call JSON cannot smuggle it out this way.
 * @returns {{text: string}|null} null when nothing may be promoted.
 */
function rescueReasoning({ emittedLength = 0, reasoningParts = [], sanitize } = {}) {
  if (emittedLength > 0) return null;
  if (!Array.isArray(reasoningParts) || reasoningParts.length === 0) return null;
  const joined = reasoningParts.join('');
  if (!joined.trim()) return null;
  const sanitised = typeof sanitize === 'function' ? sanitize(joined) : { text: joined };
  if (!sanitised || sanitised.rejected) return null;
  const text = typeof sanitised.text === 'string' ? sanitised.text : '';
  return text.trim() ? { text } : null;
}

module.exports = { rescueReasoning };

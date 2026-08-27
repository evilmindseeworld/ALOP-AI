'use strict';

/* A provider health fallback is useful for an upstream failure, but the turn
 * deadline is already the final budget decision. Starting another stream after
 * it is what turns a bounded failure into a second ~75-second wait. */
function canRetryStream({ fallbackModel = null, error = null, signal = null, wroteChars = 0 } = {}) {
  if (!fallbackModel) return false;
  if (signal?.aborted || Number(wroteChars) > 0) return false;
  if (error?.code === 'OPENROUTER_DEADLINE') return false;
  return true;
}

module.exports = { canRetryStream };

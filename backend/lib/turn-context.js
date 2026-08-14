'use strict';

const crypto = require('node:crypto');

/**
 * The two ids every part of a turn is stamped with, in one object.
 *
 * WHY BOTH. They answer different questions and neither can answer the other's.
 *
 *   operationId  the CLIENT's handle, minted in the browser and sent as
 *                `X-Operation-Id`. It survives a retry, so "the user pressed
 *                send, it failed, they pressed it again" is one operation and
 *                three HTTP requests. It is the id a user can be shown.
 *   turnId       the SERVER's handle for one execution. A retried operation
 *                produces a SECOND turn, with its own seats, its own tokens,
 *                its own spend settlement and its own ledger row. Charging one
 *                operation twice and charging two turns once are both wrong,
 *                and with one id there is no way to say which happened.
 *
 * WHAT IT IS NOT. This is not a logger, a span or a tracing SDK. It carries
 * ids, a clock and a deadline; anything that wants to record something records
 * it where it already does — the audit row, the telemetry snapshot, the ledger.
 * A second logging system was the thing this project already decided not to
 * build (see lib/turn-telemetry.js).
 *
 * NO USER DATA. Prompts, answers, emails and facts never enter this object. It
 * is copied into log lines and audit rows, both of which are read by people who
 * are not the user whose turn it was.
 */

const SHORT = (id) => (typeof id === 'string' && id.length >= 8 ? id.slice(0, 8) : '');

/**
 * @param {object} params
 * @param {string} [params.operationId]  from `X-Operation-Id`; one is minted when absent
 * @param {string} [params.userId]       the `users.id` row, never the Clerk id
 * @param {string} [params.chatId]
 * @param {number} [params.startedAt]
 * @param {number} [params.deadlineAt]   wall-clock ceiling for the whole turn
 * @param {() => string} [params.newId]  injectable for deterministic tests
 */
function createTurnContext({
  operationId = null,
  userId = null,
  chatId = null,
  startedAt = Date.now(),
  deadlineAt = null,
  newId = () => crypto.randomUUID(),
} = {}) {
  const turnId = newId();
  const opId = typeof operationId === 'string' && operationId ? operationId : newId();
  /* Attempt counters, per component. `retries` on a turn is meaningless without
   * saying retries OF WHAT — a provider retry, a tool retry and a stream
   * reconnect have different costs and different fixes. */
  const attempts = new Map();

  const context = {
    turnId,
    operationId: opId,
    userId,
    chatId,
    startedAt,
    deadlineAt,

    /** ms left before the turn's ceiling; Infinity when it has none. */
    remainingMs(now = Date.now()) {
      return Number.isFinite(deadlineAt) ? Math.max(0, deadlineAt - now) : Infinity;
    },

    expired(now = Date.now()) {
      return Number.isFinite(deadlineAt) && now >= deadlineAt;
    },

    /**
     * Record one physical attempt against a named component and return its
     * 1-based attempt number.
     *
     * "Physical" is the load-bearing word. `countTurnRequests` prices a turn
     * from what the telemetry says it DID, and until now a provider call that
     * was retried twice counted once — the retries went to OpenRouter, spent
     * the account's daily allowance, and were invisible to the ceiling meant to
     * bound exactly that.
     */
    attempt(component) {
      const key = String(component || 'unknown');
      const n = (attempts.get(key) || 0) + 1;
      attempts.set(key, n);
      return n;
    },

    /** `{provider: 3, tool: 1}` — attempts, not successes. */
    attemptCounts() {
      return Object.fromEntries(attempts);
    },

    /** Retries are attempts beyond the first, summed across components. */
    retryCount() {
      let total = 0;
      for (const n of attempts.values()) total += Math.max(0, n - 1);
      return total;
    },

    /** The prefix every log line about this turn carries. */
    tag(component) {
      return `[${component}] op=${SHORT(opId)} turn=${SHORT(turnId)}`;
    },

    /** The ids alone, for embedding in a row that has its own other fields. */
    ids() {
      return { operationId: opId, turnId };
    },
  };

  return context;
}

module.exports = { createTurnContext, SHORT_ID: SHORT };

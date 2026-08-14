'use strict';

/**
 * The one council seat that speaks the tool protocol natively.
 *
 * WHAT THIS IS FOR. Every other seat is handed a rendered catalogue and asked
 * to emit a fenced ```tool_call block, which is a text protocol over a model
 * that was never trained on it. That path stays — it is the floor, and it is
 * the only thing that works on a model with no tool template, which is most of
 * this roster. This module is the ceiling: one seat, named by
 * `COUNCIL_TOOL_SEAT_MODEL`, that gets a real `tools` array, emits real
 * `tool_calls`, and receives real `role: "tool"` results against the ids it
 * asked with.
 *
 * WHY IT NEEDS TO BE A STATE MACHINE AT ALL, and this is the whole difficulty.
 * `runAgentLoop` is built on propose → dedupe → broadcast: every seat proposes,
 * the union is executed ONCE, and every seat is handed the same transcript as
 * text. That model is what makes seven seats affordable. A native round trip is
 * the opposite shape — it is a private conversation in which each result must
 * come back attached to the `tool_call_id` that requested it, and no other
 * seat's id is meaningful in it.
 *
 * So this seat keeps its OWN message list across the loop's rounds while still
 * drawing its results from the loop's shared transcript. The loop continues to
 * execute each unique call exactly once; this module only decides how those
 * results are spelled for one seat. The saving survives, and so does the
 * protocol.
 *
 * THE INVARIANT THAT IS EASY TO BREAK. An assistant message carrying N
 * `tool_calls` must be followed by N `role: "tool"` messages, one per id, or
 * the provider rejects the request. The loop can decline to execute a call —
 * it hits a call ceiling, a budget, a whip — so "the result exists" is NOT a
 * safe assumption. Every pending id therefore gets a message, and one whose
 * call never ran is told so in words the model can act on. Dropping the id
 * instead produces a 400 from the gateway on the NEXT round, which surfaces as
 * the seat failing rather than as the ceiling that actually caused it.
 *
 * NOTHING HERE RELAXES THE CONTENT BOUNDARY. `role: "tool"` is a different
 * postbox, not a trusted one: results are rendered through the same
 * `renderToolResult` envelope, with the same untrusted preamble, at the same
 * non-system position as the text path. See lib/council-tools.js.
 */

const { callKey } = require('./tool-dedupe');
const { nativeToolSchemas, nativeToolResultMessage } = require('./council-tools');

/**
 * @param {object} deps
 * @param {string} deps.model        the seat's model id
 * @param {Function} deps.callModel  (model, messages, temperature, timeoutMs, maxTokens, signal, options) => reply
 * @param {object} deps.registry     the tool registry, for schemas and normalisation
 * @param {string} [deps.effort]     OpenRouter reasoning effort: low|medium|high
 * @param {number} [deps.temperature]
 * @param {(event) => void} [deps.onUsage]  per-call token usage, best effort
 */
function createNativeToolSeat({ model, callModel, registry, effort = 'high', temperature = 0, onUsage = () => {} }) {
  if (!model) throw new TypeError('createNativeToolSeat needs a model');
  if (typeof callModel !== 'function') throw new TypeError('createNativeToolSeat needs callModel');

  const tools = nativeToolSchemas(registry);

  /* The seat's own half of the conversation: every assistant turn it has taken
   * and every tool message answering one. It is APPENDED to the base messages
   * rather than replacing them, because the base is rebuilt each round by
   * `toolMessages` and carries the round's own instruction. */
  const turns = [];
  /* The calls from the most recent assistant turn that have not yet been
   * answered. Cleared as soon as they are, so a round that produced no call
   * cannot re-answer the previous round's. */
  let pending = [];
  const stats = { calls: 0, rounds: 0, nativeRounds: 0, textFallbackRounds: 0, unmatched: 0 };

  /** The registry's canonical key for a call, tolerant of an un-normalisable one. */
  const keyFor = (call) => {
    const normalised = (registry && typeof registry.normalize === 'function' && registry.normalize(call)) || call;
    return callKey(normalised);
  };

  /**
   * Answer every pending id from the loop's shared transcript.
   *
   * Matching is by CANONICAL KEY, not by position and not by the id: the loop
   * deduped this seat's call against every other seat's, so the entry in the
   * transcript may have been requested by a different member entirely. That is
   * the dedupe working, and the key is the only thing the two sides agree on.
   */
  const answerPending = (toolResults, ctx) => {
    if (!pending.length) return [];
    const byKey = new Map();
    for (const entry of Array.isArray(toolResults) ? toolResults : []) {
      if (!entry || !entry.call) continue;
      // Loop-executed entries carry `.key`; a seeded one is a normalised call
      // with no key, so it is computed the same way this seat computes its own.
      const key = typeof entry.call.key === 'string' ? entry.call.key : keyFor(entry.call);
      if (!byKey.has(key)) byKey.set(key, entry);
    }

    const messages = pending.map((call) => {
      const entry = byKey.get(keyFor(call));
      if (entry) return nativeToolResultMessage({ id: call.id, call: entry.call, result: entry.result }, ctx);
      /* NOT EXECUTED, and said so rather than omitted. Omitting the message
       * makes the next request malformed; a silent empty result makes the model
       * believe the tool returned nothing, which is a different and worse claim
       * than "this did not run". */
      stats.unmatched += 1;
      return nativeToolResultMessage({
        id: call.id,
        call,
        result: {
          ok: false,
          summary: 'This call was not executed — the turn reached a research ceiling. Do not retry it; answer with what you already have.',
          content: '',
        },
      }, ctx);
    });

    pending = [];
    return messages;
  };

  return {
    model,
    /** The `tools` array this seat is sent. Exposed for assertions and logging. */
    tools,
    stats: () => ({ ...stats }),

    /**
     * One round for this seat.
     *
     * @param {Array} baseMessages  `toolMessages(..., { native: true })` output
     * @param {object} ctx          the loop's round context
     * @param {AbortSignal} signal
     * @param {{timeoutMs: number, maxTokens: number}} limits
     * @returns {Promise<object>} a model reply (see lib/model-reply.js)
     */
    async ask(baseMessages, ctx, signal, { timeoutMs, maxTokens } = {}) {
      const isFinalRound = Boolean(ctx && ctx.isFinalRound);
      const resultMessages = answerPending(ctx && ctx.toolResults, ctx);
      turns.push(...resultMessages);

      const messages = [...(Array.isArray(baseMessages) ? baseMessages : []), ...turns];

      const reply = await callModel(model, messages, temperature, timeoutMs, maxTokens, signal, {
        structured: true,
        tools,
        /* THE FINAL ROUND IS ANSWER-ONLY AND THE PROVIDER ENFORCES IT.
         * The text path can only ASK a model not to call a tool; here it can be
         * made impossible. Measured against the live gateway: with
         * `tool_choice: "none"` the same prompt that had been emitting calls
         * returned prose and `finish_reason: "stop"`. The tools array is still
         * sent so the model can read what it HAD available when explaining what
         * it could not check. */
        toolChoice: isFinalRound ? 'none' : 'auto',
        /* High effort is the reason this seat is on the council. `exclude`
         * keeps the reasoning out of the reply body — it is still paid for and
         * still done, it simply is not an answer. */
        reasoning: { effort, exclude: true },
      });

      try { onUsage(reply && reply.usage); } catch { /* telemetry must never fail a seat */ }

      stats.rounds += 1;
      const nativeCalls = Array.isArray(reply && reply.toolCalls) ? reply.toolCalls : [];
      if (nativeCalls.length) {
        stats.nativeRounds += 1;
        stats.calls += nativeCalls.length;
        /* The assistant turn is stored VERBATIM — `reply.tool_calls`, provider
         * ids intact — because it is what the next request must echo back. A
         * reconstructed one with our own ids would not match the tool messages
         * the provider is about to be shown. */
        turns.push({ role: 'assistant', content: reply.content || null, tool_calls: reply.tool_calls });
        pending = nativeCalls.map((c) => ({ id: c.id, name: c.name, args: parseArgs(c.rawArguments) }));
      } else {
        /* NO NATIVE CALL. Either the seat answered, or it wrote a fence in
         * prose — a tool-capable model still does that occasionally, and the
         * shared parser reads it. Counted separately so adoption is measurable
         * rather than assumed: a native seat quietly degrading to the text
         * protocol is invisible in every other signal. */
        if (looksLikeFence(reply && reply.content)) stats.textFallbackRounds += 1;
        turns.push({ role: 'assistant', content: reply.content || '' });
      }
      return reply;
    },
  };
}

/** Arguments arrive as a JSON string. A bad one is an empty bag, never a throw. */
function parseArgs(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const looksLikeFence = (text) => typeof text === 'string' && /```[ \t]*tool[_-]?call/i.test(text);

module.exports = { createNativeToolSeat };

'use strict';

/**
 * One shape for what a model actually said.
 *
 * WHY THIS EXISTS. `callModel` returned a STRING, produced by a helper that
 * collapsed four different fields into one: content, else reasoning, else the
 * reasoning_details parts, else `''`. Three things were lost at that boundary
 * and none of them left a trace:
 *
 *   1. **`message.tool_calls` became `''`.** A model that answers a tool-enabled
 *      round natively — `content: null` plus a populated `tool_calls` array —
 *      arrived at `parseToolRequests` as an empty string. `fromNative` in
 *      `tool-protocol.js` has always been able to read that array; it could
 *      never be reached, because the array was deleted one function earlier.
 *      The seat was then scored `empty` and dropped from the round. The failure
 *      has no error and no log line: it looks exactly like a model that
 *      declined to answer.
 *   2. **`message.refusal` became `''`.** A provider-level refusal and a
 *      timeout were the same value, so the loop could neither report one nor
 *      stop retrying it.
 *   3. **Reasoning was indistinguishable from the answer.** The fallback to
 *      `reasoning` is deliberate and is KEPT here — some models put the whole
 *      answer there when reasoning is excluded, and removing the fallback would
 *      blank those seats — but the caller could not tell which it had got, so
 *      internal chain-of-thought could be cached and shown as an answer.
 *
 * The reply below is MESSAGE-SHAPED on purpose: `role`, `content` and
 * `tool_calls` sit where an OpenAI-compatible message carries them, so
 * `parseToolRequests` reads it with no change — it already falls through to the
 * object it was handed. Everything added is extra fields beside them.
 *
 * TOOL IDS ARE PRESERVED VERBATIM. `tool_calls` keeps the provider's own
 * entries, ids included, because a tool result can only be returned against the
 * id that requested it. `toolCalls` is a flattened convenience view for
 * telemetry and ledgers; it is never what gets sent back to a provider.
 */

const asText = (value) => (typeof value === 'string' && value.trim() ? value : '');

/** Reasoning as one string, from either field OpenRouter uses for it. */
function reasoningText(message) {
  const direct = asText(message.reasoning);
  if (direct) return direct;
  if (Array.isArray(message.reasoning_details)) {
    return message.reasoning_details
      .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('');
  }
  return '';
}

/**
 * Flatten provider tool calls for telemetry. Arguments stay EXACTLY as sent —
 * OpenRouter emits them as a JSON string and `tool-protocol.js` is the one
 * place that decides how to parse that. Two parsers would drift.
 */
function flattenToolCalls(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((call, index) => {
      if (!call || typeof call !== 'object') return null;
      const fn = call.function && typeof call.function === 'object' ? call.function : call;
      const name = typeof fn.name === 'string' ? fn.name.trim() : '';
      if (!name) return null;
      return {
        // A provider that omits the id still needs a stable handle for the
        // ledger. Index-derived is fine: it is scoped to this one reply.
        id: typeof call.id === 'string' && call.id ? call.id : `call_${index}`,
        name,
        rawArguments: fn.arguments ?? fn.args ?? null,
      };
    })
    .filter(Boolean);
}

function normaliseUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const num = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const promptTokens = num(usage.prompt_tokens ?? usage.promptTokens);
  const completionTokens = num(usage.completion_tokens ?? usage.completionTokens);
  const totalTokens = num(usage.total_tokens ?? usage.totalTokens);
  const costUsd = num(usage.cost ?? usage.total_cost);
  if (promptTokens === null && completionTokens === null && totalTokens === null && costUsd === null) return null;
  return {
    promptTokens,
    completionTokens,
    totalTokens: totalTokens ?? (((promptTokens ?? 0) + (completionTokens ?? 0)) || null),
    costUsd,
  };
}

/**
 * A reply with nothing in it.
 *
 * Every early return in `callModel` — abort, timeout, exhausted deadline — used
 * to be the bare string `''`. In structured mode they must still be an object,
 * or every caller acquires a type check it will eventually forget.
 *
 * @param {string} finishReason  'aborted' | 'timeout' | 'deadline' | 'error'
 */
function emptyReply(finishReason = 'none') {
  return {
    role: 'assistant',
    content: '',
    textSource: 'none',
    reasoning: '',
    tool_calls: undefined,
    toolCalls: [],
    refusal: null,
    finishReason,
    usage: null,
    model: null,
    id: null,
  };
}

/**
 * @param {object} payload  a whole OpenRouter chat-completions response, or a
 *                          bare `choices[0].message`.
 * @returns {object} message-shaped reply; see the header.
 */
function normaliseCompletion(payload) {
  if (!payload || typeof payload !== 'object') return emptyReply('none');
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  const message = (choice && choice.message) || (payload.role ? payload : payload.message) || {};
  if (!message || typeof message !== 'object') return emptyReply('none');

  const content = asText(message.content);
  const reasoning = reasoningText(message);
  const tool_calls = Array.isArray(message.tool_calls) && message.tool_calls.length
    ? message.tool_calls
    : undefined;
  const refusal = asText(message.refusal) || null;

  /* THE FALLBACK IS KEPT, AND IT IS NOW LABELLED.
   *
   * Falling back to reasoning was already the behaviour and removing it would
   * blank every seat on a model that writes its answer there. What was missing
   * is the label: a caller that must not show internal reasoning to a user, or
   * must not write it into a shared answer cache, can now test `textSource`
   * instead of guessing. A reply carrying tool_calls never falls back — its
   * reasoning is the narration of a call, not an answer. */
  let text = content;
  let textSource = content ? 'content' : 'none';
  if (!text && !tool_calls && reasoning) {
    text = reasoning;
    textSource = 'reasoning';
  }

  return {
    role: 'assistant',
    content: text,
    textSource,
    reasoning,
    tool_calls,
    toolCalls: flattenToolCalls(tool_calls),
    refusal,
    finishReason: (choice && typeof choice.finish_reason === 'string' ? choice.finish_reason : null)
      || (typeof payload.finish_reason === 'string' ? payload.finish_reason : null),
    usage: normaliseUsage(payload.usage),
    model: typeof payload.model === 'string' ? payload.model : null,
    id: typeof payload.id === 'string' ? payload.id : null,
  };
}

/** True for anything `normaliseCompletion`/`emptyReply` produced. */
const isModelReply = (value) =>
  Boolean(value) && typeof value === 'object' && typeof value.textSource === 'string' && value.role === 'assistant';

/** The string the old contract returned, for callers that only want that. */
const replyText = (value) => (isModelReply(value) ? value.content : typeof value === 'string' ? value : '');

module.exports = { normaliseCompletion, emptyReply, isModelReply, replyText, flattenToolCalls, normaliseUsage };

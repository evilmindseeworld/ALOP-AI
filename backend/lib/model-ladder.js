'use strict';

/**
 * THE HEAD MODEL'S LADDER, and why one fallback was never enough.
 *
 * The council's head — the model that writes the final answer and the one that
 * holds the native tool loop — was one model behind one provider on one
 * account. Its recovery was a single free model. So two outages away from a
 * lost turn, and the second of those is not independent of the first: when a
 * provider is rate limiting an account, the model beside it on the same
 * provider is rate limited too.
 *
 * Hence a LADDER, ordered, and the ordering rule is stated so the next person
 * changing it knows what they are trading:
 *
 *   1. Measured latency first among the verified free rungs, then capability
 *      and price. Every rung must support native tool
 *      calling, because a tool turn that falls to a model without `tools`
 *      cannot answer the question it was routed for. Checked against
 *      OpenRouter's catalogue on 2026-08-16: every id below reports `tools`
 *      among its supported parameters.
 *
 *   2. EVERY DEFAULT RUNG IS `:free`. THIS IS A STANDING RULE, NOT A SETTING.
 *
 *      The owner's instruction, 2026-08-16: this product runs on OpenRouter's
 *      free models. Subscriptions — Codex/ChatGPT, Gemini — are for the people
 *      building it, and they do not transfer: a subscription authenticates a
 *      human in a CLI, while this server holds an API key on a different
 *      account with a different bill. The comment on TOOL_SEAT_MODEL in
 *      server.js already said exactly that, and the default underneath it was a
 *      metered model anyway.
 *
 *      So Luna, Gemini 2.5 Flash and Sonnet 5 remain below as historical
 *      pricing/effort data, but they are not runnable paths. FREE_ONLY is a
 *      standing rule: COUNCIL_HEAD_FALLBACKS, COUNCIL_SYNTHESIS_MODEL and
 *      COUNCIL_TOOL_SEAT_MODEL cannot opt back into paid inference.
 *
 *      WHAT THIS COSTS, stated rather than buried: the free rungs are the
 *      slowest models on the roster — 120B measured at 23.9s median against
 *      Gemma's 2.4s — so a complex or tool-backed answer is now written by a
 *      slow model. That is the trade the instruction makes, and the fix for it
 *      is a genuinely free head (Google AI Studio's free tier), not a metered
 *      one.
 *
 *      PROVIDER DIVERSITY IS WEAKER NOW, and it has to be said: both default
 *      rungs are NVIDIA models on one gateway, so they are two rungs wearing
 *      one provider's name on the day that provider is down. Free tool-capable
 *      models from a second provider would be the fix; there was not one in the
 *      verified set on 2026-08-16.
 *
 *   3. Free does not mean unlimited. The `:free` rungs cost $0 and still spend
 *      OpenRouter's account-wide daily REQUEST quota, which is the ceiling that
 *      actually binds here — see the second half of lib/spend.js.
 *
 * HISTORICAL PRICES (OpenRouter catalogue, 2026-08-16, $/M prompt / $/M completion):
 *   nvidia/nemotron-3-ultra-550b-a55b:free 0 / 0   (1M context)
 *   nvidia/nemotron-3-super-120b-a12b:free 0 / 0   (the previous sole fallback)
 *   -- historical data only; FREE_ONLY provides no paid opt-in --
 *   openai/gpt-5.6-luna                    0.10 / 0.60
 *   google/gemini-2.5-flash                0.30 / 2.50
 *   anthropic/claude-sonnet-5              2.00 / 10.00
 *
 * `SYNTHESIS_MODEL_TENTHS` in lib/spend.js retains the historical rates for
 * defensive settlement accounting. Putting a metered model in configuration
 * does not opt in: FREE_ONLY rejects it before any OpenRouter request.
 */

const DEFAULT_HEAD_LADDER = Object.freeze([
  Object.freeze({ model: 'nvidia/nemotron-3-super-120b-a12b:free', effort: null }),
  Object.freeze({ model: 'nvidia/nemotron-3-ultra-550b-a55b:free', effort: null }),
]);

/**
 * The metered rungs stay as data for historical pricing/effort compatibility
 * and tests. They are NEVER runnable under FREE_ONLY; the request boundary
 * rejects them even when a deployment variable names one.
 */
const METERED_RUNGS = Object.freeze([
  Object.freeze({ model: 'openai/gpt-5.6-luna', effort: 'high' }),
  Object.freeze({ model: 'google/gemini-2.5-flash', effort: 'high' }),
  Object.freeze({ model: 'anthropic/claude-sonnet-5', effort: 'high' }),
]);

/**
 * The reasoning effort a model is configured to run at, or null.
 *
 * Read from the ladder rather than assumed, because `high` is not a universal
 * parameter: it was written for the metered rungs, and sending it to a free
 * model that does not take it is an unverified field on the request that writes
 * every answer this product produces — the same risk the `usage: {include}`
 * comment in lib/openrouter.js refuses to take without a live probe. There is
 * no OpenRouter key on this machine, so the safe default for a rung whose
 * effort was never established is to send none.
 */
function effortFor(model, ladder = DEFAULT_HEAD_LADDER) {
  const rung = (ladder || []).find((entry) => entry.model === model)
    || METERED_RUNGS.find((entry) => entry.model === model);
  return rung?.effort || null;
}

const DISABLED = /^(off|none|0|false)$/i;

/**
 * Parse a `model[:effort],model[:effort]` list from a deployment variable.
 * Blank means the default ladder; an explicit off/none means no fallbacks at
 * all, which is the rollback switch.
 *
 * @returns {Array<{model: string, effort: string|null}>|null} null = disabled
 */
function parseLadder(raw, fallback = DEFAULT_HEAD_LADDER) {
  if (raw == null || String(raw).trim() === '') return [...fallback];
  const value = String(raw).trim();
  if (DISABLED.test(value)) return null;
  const rungs = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      /* `provider/model:free` already contains a colon, so the effort suffix is
       * only the LAST segment and only when it names an effort. Splitting
       * naively here would turn every free model id into a model called
       * `provider/model` at effort `free`. */
      const match = /^(.*?)(?::(low|medium|high|max))?$/i.exec(entry);
      return { model: match[1], effort: match[2] ? match[2].toLowerCase() : null };
    })
    .filter((rung) => rung.model);
  return rungs.length ? rungs : [...fallback];
}

/**
 * The rungs BELOW a given model — what to try when it fails.
 *
 * Matching by id rather than by position, so a deployment that overrides the
 * head model to something already on the ladder does not retry it as its own
 * fallback. A head model that is not on the ladder at all gets the whole thing.
 */
function fallbacksAfter(head, ladder = DEFAULT_HEAD_LADDER) {
  if (!ladder) return [];
  const at = ladder.findIndex((rung) => rung.model === head);
  const rest = at === -1 ? ladder : ladder.slice(at + 1);
  return rest.filter((rung) => rung.model !== head);
}

/** Shape `streamModel` wants: `{model, reasoning}` per attempt. */
function asStreamFallbacks(rungs) {
  return rungs.map(({ model, effort }) => ({
    model,
    /* `exclude: true` on every rung: a recovery attempt's chain-of-thought is
     * not the answer and must not be streamed into one. */
    reasoning: effort ? { effort, exclude: true } : { exclude: true },
  }));
}

module.exports = {
  DEFAULT_HEAD_LADDER,
  METERED_RUNGS,
  parseLadder,
  fallbacksAfter,
  asStreamFallbacks,
  effortFor,
};

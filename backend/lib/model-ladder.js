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
 *   1. Capability first, then price. Every rung must support native tool
 *      calling, because a tool turn that falls to a model without `tools`
 *      cannot answer the question it was routed for. Checked against
 *      OpenRouter's catalogue on 2026-08-16: every id below reports `tools`
 *      among its supported parameters.
 *
 *   2. PROVIDER DIVERSITY IS THE POINT. OpenAI, then Google, then Anthropic,
 *      then two NVIDIA free models. Two rungs from one provider are one rung
 *      wearing two names on the day that provider is down — which is the exact
 *      failure this ladder exists for.
 *
 *      THE ORDER OF RUNGS 2 AND 3 IS THE OWNER'S, given 2026-08-16: Luna, then
 *      Gemini, then Sonnet. Price agrees with it — Gemini is about a sixth of
 *      Sonnet per synthesis on the estimates in lib/spend.js — so the cheap
 *      recovery is tried before the dear one, and Sonnet remains the rung that
 *      catches a Google outage on top of an OpenAI one. Do not reorder these
 *      two back on a capability argument without asking.
 *
 *   3. The last rung costs nothing. A ladder whose every rung is metered runs
 *      out with the money, and an account at its spend ceiling is precisely
 *      when the turn still needs an answer.
 *
 * PRICES (OpenRouter catalogue, 2026-08-16, $/M prompt / $/M completion):
 *   openai/gpt-5.6-luna                    0.10 / 0.60
 *   google/gemini-2.5-flash                0.30 / 2.50
 *   anthropic/claude-sonnet-5              2.00 / 10.00
 *   nvidia/nemotron-3-ultra-550b-a55b:free 0 / 0   (1M context)
 *   nvidia/nemotron-3-super-120b-a12b:free 0 / 0   (the previous sole fallback)
 *
 * COST IS NO LONGER ASSUMED AWAY. This file used to record that lib/spend.js
 * charged a flat Luna-shaped rate for every rung, so a fallen turn was
 * under-priced against the daily ceiling. `SYNTHESIS_MODEL_TENTHS` prices the
 * rungs individually now and the reservation holds the dearest one, so adding
 * a metered rung here changes what a turn reserves — check that table when you
 * change this list.
 */

const DEFAULT_HEAD_LADDER = Object.freeze([
  Object.freeze({ model: 'openai/gpt-5.6-luna', effort: 'high' }),
  Object.freeze({ model: 'google/gemini-2.5-flash', effort: 'high' }),
  Object.freeze({ model: 'anthropic/claude-sonnet-5', effort: 'high' }),
  Object.freeze({ model: 'nvidia/nemotron-3-ultra-550b-a55b:free', effort: null }),
  Object.freeze({ model: 'nvidia/nemotron-3-super-120b-a12b:free', effort: null }),
]);

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

module.exports = { DEFAULT_HEAD_LADDER, parseLadder, fallbacksAfter, asStreamFallbacks };

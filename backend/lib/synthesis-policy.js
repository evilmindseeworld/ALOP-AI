'use strict';

/**
 * THE HEAD IS FREE BY DEFAULT. It was `openai/gpt-5.6-luna`, which is metered
 * on the OpenRouter account this server holds — a Codex/ChatGPT subscription
 * covers that model on a DIFFERENT account and does not transfer to an API key.
 * The owner's instruction, 2026-08-16: this product runs on free models.
 *
 * The strongest free rung that the catalogue says can call tools, which the head
 * must be able to do — it holds the native tool loop. Paying for a better head
 * is a deliberate opt-in through COUNCIL_SYNTHESIS_MODEL.
 */
const DEFAULT_SYNTHESIS_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
const DISABLED_MODEL = /^(off|none|0|false)$/i;

/**
 * Resolve the optional model flag without making a blank deployment variable
 * disable the feature. Explicit off/none values are the rollback switch and
 * return null so callers can use their existing recovery path.
 */
function configuredSynthesisModel(raw, fallback = DEFAULT_SYNTHESIS_MODEL) {
  if (raw == null || String(raw).trim() === '') return fallback;
  const value = String(raw).trim();
  return DISABLED_MODEL.test(value) ? null : value;
}

/**
 * The fast model owns simple turns. Every multi-draft or tool-backed turn gets
 * the configured head model as the final writer, with high reasoning effort.
 */
function chooseSynthesis({ complexity, toolQuestion = false, primaryModel, configuredModel }) {
  const needsHead = Boolean(toolQuestion) || complexity !== 'simple';
  const useHead = needsHead && Boolean(configuredModel);
  return {
    model: useHead ? configuredModel : primaryModel,
    highEffort: useHead,
    reason: toolQuestion ? 'tools' : (complexity || 'unknown'),
  };
}

module.exports = {
  DEFAULT_SYNTHESIS_MODEL,
  configuredSynthesisModel,
  chooseSynthesis,
};

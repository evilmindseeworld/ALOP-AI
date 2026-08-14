'use strict';

const DEFAULT_SYNTHESIS_MODEL = 'openai/gpt-5.6-luna';
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

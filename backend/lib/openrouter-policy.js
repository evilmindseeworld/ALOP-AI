'use strict';

/* This is the one inference billing boundary for OpenRouter. Model catalogue
 * lookups and `/key` capacity reads do not select an inference model, so they
 * intentionally stay outside this policy. */
const OPENROUTER_POLICY = 'FREE_ONLY';
const FREE_ROUTER_ALIAS = 'openrouter/free';
const MODEL_LOG_LIMIT = 200;

const modelText = (model) => typeof model === 'string' ? model.trim() : '';

const isAllowedOpenRouterModel = (model) => {
  const candidate = modelText(model);
  return candidate === FREE_ROUTER_ALIAS || candidate.endsWith(':free');
};

const safeSource = (source) => String(source || 'request')
  .replace(/[^a-z0-9_.:/-]/gi, '_')
  .slice(0, 80) || 'request';

class OpenRouterPolicyError extends Error {
  constructor(model, source) {
    const candidate = modelText(model);
    const displayModel = candidate.slice(0, MODEL_LOG_LIMIT);
    super(`OpenRouter model blocked by ${OPENROUTER_POLICY}: ${displayModel || '(missing)'}`);
    this.name = 'OpenRouterPolicyError';
    this.code = 'OPENROUTER_PAID_MODEL_BLOCKED';
    this.policy = OPENROUTER_POLICY;
    this.model = displayModel || null;
    this.source = safeSource(source);
  }
}

function assertAllowedOpenRouterModel(model, context = {}) {
  if (isAllowedOpenRouterModel(model)) return model;

  const error = new OpenRouterPolicyError(model, context?.source);
  console.warn(
    `[OPENROUTER] blocked model route policy=${error.policy} source=${error.source} model=${error.model || '(missing)'}`,
  );
  throw error;
}

module.exports = {
  OPENROUTER_POLICY,
  OpenRouterPolicyError,
  assertAllowedOpenRouterModel,
  isAllowedOpenRouterModel,
};

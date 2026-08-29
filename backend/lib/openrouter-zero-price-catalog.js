'use strict';

/*
 * The cost receipt must not turn FREE_ONLY into a price assertion. FREE_ONLY
 * answers whether a model may be sent to OpenRouter; it does not settle what
 * a provider attempt cost. This is the separate, committed price authority
 * used by the receipt when a turn has failed or missing usage data.
 *
 * The entries are the OpenRouter model-catalogue snapshot recorded by this
 * repository on 2026-08-16. Keep the model ids exact: a free router alias and
 * an unlisted :free id do not prove the same price as a catalogued model.
 * Updating this data is a deliberate accounting review, not a routing switch.
 */

const ZERO_PRICE_CATALOG_VERSION = 'openrouter-model-catalog-2026-08-16';
const ZERO_PRICE_CATALOG_SOURCE = 'OpenRouter GET /api/v1/models catalogue snapshot, verified 2026-08-16';

const rows = [
  ['cohere/north-mini-code:free', 0, 0],
  ['google/gemma-4-26b-a4b-it:free', 0, 0],
  ['google/gemma-4-31b-it:free', 0, 0],
  ['nvidia/nemotron-3-nano-30b-a3b:free', 0, 0],
  ['nvidia/nemotron-3-super-120b-a12b:free', 0, 0],
  ['nvidia/nemotron-3-ultra-550b-a55b:free', 0, 0],
  ['openai/gpt-oss-20b:free', 0, 0],
  ['poolside/laguna-s-2.1:free', 0, 0],
];

const ZERO_PRICE_CATALOG = Object.freeze(rows.map(([model, inputUsdPerMillionTokens, outputUsdPerMillionTokens]) =>
  Object.freeze({
    model,
    inputUsdPerMillionTokens,
    outputUsdPerMillionTokens,
    verified: true,
    source: ZERO_PRICE_CATALOG_SOURCE,
    catalogVersion: ZERO_PRICE_CATALOG_VERSION,
  }))
);

const byModel = new Map(ZERO_PRICE_CATALOG.map((entry) => [entry.model, entry]));

const zeroPriceMetadata = (model) => {
  const entry = typeof model === 'string' ? byModel.get(model.trim()) : undefined;
  return entry && entry.verified === true
    && entry.inputUsdPerMillionTokens === 0
    && entry.outputUsdPerMillionTokens === 0
    ? entry
    : null;
};

const isVerifiedZeroPriceModel = (model) => Boolean(zeroPriceMetadata(model));

module.exports = {
  ZERO_PRICE_CATALOG_VERSION,
  ZERO_PRICE_CATALOG_SOURCE,
  ZERO_PRICE_CATALOG,
  zeroPriceMetadata,
  isVerifiedZeroPriceModel,
};

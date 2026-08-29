'use strict';

const {
  ZERO_PRICE_CATALOG_SOURCE,
  ZERO_PRICE_CATALOG_VERSION,
  zeroPriceMetadata,
} = require('./openrouter-zero-price-catalog');

const OPENROUTER_MODELS_PATH = '/models';
const PREFLIGHT_SOURCE = 'OpenRouter GET /api/v1/models';

const uniqueRoutes = (routeIds) => {
  if (!Array.isArray(routeIds)) return { routes: [], invalid: true };
  const routes = [];
  let invalid = routeIds.length === 0;
  for (const route of routeIds) {
    if (typeof route !== 'string' || !route.trim()) {
      invalid = true;
      continue;
    }
    if (route !== route.trim()) invalid = true;
    if (!routes.includes(route)) routes.push(route);
  }
  return { routes, invalid };
};

const modelsUrlFor = (host = 'https://openrouter.ai/api/v1/chat/completions') => {
  const url = new URL(host);
  const pathname = url.pathname.replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '');
  url.pathname = `${pathname}${OPENROUTER_MODELS_PATH}`;
  url.search = '';
  url.hash = '';
  return url.toString();
};

const parseZeroPrice = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

const baseResult = ({ activeRoutes, url, metadataRequest = null } = {}) => ({
  pass: false,
  source: PREFLIGHT_SOURCE,
  catalogSource: ZERO_PRICE_CATALOG_SOURCE,
  catalogVersion: ZERO_PRICE_CATALOG_VERSION,
  activeRoutes,
  activeRouteCount: activeRoutes.length,
  metadataUrl: url,
  metadataRequest,
  checkedRoutes: [],
  unknownActiveRoutes: [],
  missingRoutes: [],
  malformedPriceRoutes: [],
  nonzeroInputRoutes: [],
  nonzeroOutputRoutes: [],
});

/**
 * Verify the exact active production route set against a fresh OpenRouter
 * metadata response. This performs one metadata GET only; it never sends a
 * prompt, resolves an alias, or infers a price from a `:free` suffix.
 */
async function preflightZeroPriceCatalog({
  routeIds,
  host,
  apiKey,
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const { routes: activeRoutes, invalid: invalidRouteSet } = uniqueRoutes(routeIds);
  let url = null;
  try { url = modelsUrlFor(host); } catch {
    return { ...baseResult({ activeRoutes }), reason: 'metadata_url_invalid' };
  }
  if (invalidRouteSet) return { ...baseResult({ activeRoutes, url }), reason: 'active_route_set_invalid' };
  if (!apiKey || typeof apiKey !== 'string') {
    return { ...baseResult({ activeRoutes, url }), reason: 'metadata_authorization_missing' };
  }
  if (typeof fetchImpl !== 'function') {
    return { ...baseResult({ activeRoutes, url }), reason: 'metadata_request_failed' };
  }

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      signal,
    });
  } catch {
    return { ...baseResult({ activeRoutes, url }), reason: 'metadata_request_failed' };
  }
  const metadataRequest = { method: 'GET', status: Number(response?.status) || null, ok: response?.ok === true };
  if (!response?.ok || typeof response.json !== 'function') {
    return { ...baseResult({ activeRoutes, url, metadataRequest }), reason: 'metadata_request_failed' };
  }

  let payload;
  try { payload = await response.json(); } catch {
    return { ...baseResult({ activeRoutes, url, metadataRequest }), reason: 'metadata_response_malformed' };
  }
  if (!Array.isArray(payload?.data)) {
    return { ...baseResult({ activeRoutes, url, metadataRequest }), reason: 'metadata_response_malformed' };
  }

  const metadataById = new Map();
  let ambiguousMetadata = false;
  for (const row of payload.data) {
    if (typeof row?.id !== 'string' || !row.id.trim()) continue;
    const id = row.id;
    if (metadataById.has(id)) ambiguousMetadata = true;
    else metadataById.set(id, row);
  }

  const result = baseResult({ activeRoutes, url, metadataRequest });
  if (ambiguousMetadata) return { ...result, reason: 'metadata_ambiguous' };

  for (const route of activeRoutes) {
    const pinned = zeroPriceMetadata(route);
    if (!pinned) {
      result.unknownActiveRoutes.push(route);
      continue;
    }
    const row = metadataById.get(route);
    if (!row) {
      result.missingRoutes.push(route);
      continue;
    }
    const input = parseZeroPrice(row.pricing?.prompt);
    const output = parseZeroPrice(row.pricing?.completion);
    if (input === null || output === null) {
      result.malformedPriceRoutes.push(route);
      continue;
    }
    result.checkedRoutes.push(route);
    if (input !== pinned.inputUsdPerMillionTokens) result.nonzeroInputRoutes.push(route);
    if (output !== pinned.outputUsdPerMillionTokens) result.nonzeroOutputRoutes.push(route);
  }

  const reason = result.unknownActiveRoutes.length ? 'active_route_not_catalogued'
    : result.missingRoutes.length ? 'catalog_route_missing'
      : result.malformedPriceRoutes.length ? 'catalog_price_malformed'
        : result.nonzeroInputRoutes.length ? 'catalog_input_price_nonzero'
          : result.nonzeroOutputRoutes.length ? 'catalog_output_price_nonzero'
            : null;
  return { ...result, pass: !reason && result.checkedRoutes.length === activeRoutes.length, reason };
}

module.exports = {
  OPENROUTER_MODELS_PATH,
  PREFLIGHT_SOURCE,
  modelsUrlFor,
  preflightZeroPriceCatalog,
};

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ZERO_PRICE_CATALOG } = require('./openrouter-zero-price-catalog');
const {
  OPENROUTER_MODELS_PATH,
  preflightZeroPriceCatalog,
} = require('./openrouter-zero-price-preflight');

const routes = ZERO_PRICE_CATALOG.slice(0, 3).map((entry) => entry.model);
const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const metadata = (ids = routes, pricing = {}) => ({
  data: ids.map((id) => ({ id, pricing: { prompt: '0', completion: '0', ...pricing } })),
});

const fakeFetch = (body, { status = 200, assertRequest = () => {} } = {}) => async (url, init = {}) => {
  assert.equal(url, `https://openrouter.ai/api/v1${OPENROUTER_MODELS_PATH}`);
  assert.equal(init.method, 'GET');
  assert.equal(init.body, undefined);
  assert.equal(init.headers.Authorization, 'Bearer test-key');
  assertRequest(url, init);
  return response(body, status);
};

test('the preflight passes only for the exact active routes and exact zero input/output prices', async () => {
  let calls = 0;
  const result = await preflightZeroPriceCatalog({
    routeIds: routes,
    apiKey: 'test-key',
    fetchImpl: async (...args) => {
      calls += 1;
      return fakeFetch(metadata(), { assertRequest: () => assert.equal(calls, 1) })(...args);
    },
  });

  assert.equal(result.pass, true);
  assert.equal(result.activeRouteCount, 3);
  assert.deepEqual(result.activeRoutes, routes);
  assert.deepEqual(result.nonzeroInputRoutes, []);
  assert.deepEqual(result.nonzeroOutputRoutes, []);
  assert.deepEqual(result.missingRoutes, []);
  assert.equal(JSON.stringify(result).includes('test-key'), false);
});

test('a missing active route fails closed instead of falling back to an alias or snapshot', async () => {
  const result = await preflightZeroPriceCatalog({
    routeIds: routes,
    apiKey: 'test-key',
    fetchImpl: fakeFetch(metadata(routes.slice(0, 2))),
  });

  assert.equal(result.pass, false);
  assert.deepEqual(result.missingRoutes, [routes[2]]);
  assert.equal(result.reason, 'catalog_route_missing');
});

test('a nonzero input or output price fails the freshness gate', async () => {
  const input = await preflightZeroPriceCatalog({
    routeIds: [routes[0]],
    apiKey: 'test-key',
    fetchImpl: fakeFetch(metadata([routes[0]], { prompt: '0.000001' })),
  });
  const output = await preflightZeroPriceCatalog({
    routeIds: [routes[1]],
    apiKey: 'test-key',
    fetchImpl: fakeFetch(metadata([routes[1]], { completion: '0.000001' })),
  });

  assert.equal(input.pass, false);
  assert.deepEqual(input.nonzeroInputRoutes, [routes[0]]);
  assert.equal(output.pass, false);
  assert.deepEqual(output.nonzeroOutputRoutes, [routes[1]]);
});

test('malformed metadata and an active free alias are both unknown, never zero', async () => {
  const malformed = await preflightZeroPriceCatalog({
    routeIds: [routes[0]],
    apiKey: 'test-key',
    fetchImpl: fakeFetch({ data: [{ id: routes[0], pricing: { prompt: 'not-a-price', completion: '0' } }] }),
  });
  const alias = await preflightZeroPriceCatalog({
    routeIds: ['openrouter/free'],
    apiKey: 'test-key',
    fetchImpl: fakeFetch(metadata()),
  });

  assert.equal(malformed.pass, false);
  assert.deepEqual(malformed.malformedPriceRoutes, [routes[0]]);
  assert.equal(alias.pass, false);
  assert.deepEqual(alias.unknownActiveRoutes, ['openrouter/free']);
  assert.equal(alias.reason, 'active_route_not_catalogued');
});

test('metadata unavailability or missing authorization fails closed without model traffic', async () => {
  const unavailable = await preflightZeroPriceCatalog({
    routeIds: [routes[0]],
    apiKey: 'test-key',
    fetchImpl: async () => { throw new Error('network down'); },
  });
  const unauthorized = await preflightZeroPriceCatalog({
    routeIds: [routes[0]],
    apiKey: '',
    fetchImpl: async () => { throw new Error('must not be called'); },
  });

  assert.equal(unavailable.pass, false);
  assert.equal(unavailable.reason, 'metadata_request_failed');
  assert.equal(unauthorized.pass, false);
  assert.equal(unauthorized.reason, 'metadata_authorization_missing');
});

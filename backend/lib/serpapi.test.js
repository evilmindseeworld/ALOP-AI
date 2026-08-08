const test = require('node:test');
const assert = require('node:assert');
const { searchSerpApi, ENGINE_NAMES, engineMenu, formatRows, extractRows } = require('./serpapi');

const okResponse = (body) => ({ ok: true, json: async () => body });
const captured = (body) => {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url) => { calls.push(url); return okResponse(body); },
  };
};

/* An unknown engine is a BILLED 400 — the request reaches SerpApi before it
 * fails — so it has to be refused here, before the network. */
test('an engine the model invented never reaches the network', async () => {
  const { calls, fetchImpl } = captured({ organic_results: [{ title: 'x' }] });
  const res = await searchSerpApi({ engine: 'google_cars', query: 'a', apiKey: 'k', fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(calls.length, 0, 'a bad engine must not be paid for');
  // Naming what IS available turns a wasted round into a corrected one.
  assert.match(res.error, /google_shopping/);
});

test('no key means no call and no throw', async () => {
  const explode = async () => { throw new Error('should not be called'); };
  const res = await searchSerpApi({ engine: 'google_shopping', query: 'a', apiKey: '', fetchImpl: explode });
  assert.equal(res.ok, false);
});

test('only allowlisted parameters are forwarded', async () => {
  const { calls, fetchImpl } = captured({ shopping_results: [{ title: 'x', price: 'AED 1' }] });
  await searchSerpApi({
    engine: 'google_shopping',
    query: 'monitor',
    // `api_key` and `num` are the interesting pair: one is an override attempt,
    // the other is allowlisted and must survive.
    params: { gl: 'ae', num: '5', api_key: 'attacker', callback: 'evil' },
    apiKey: 'real',
    fetchImpl,
  });
  const url = new URL(calls[0]);
  assert.equal(url.searchParams.get('gl'), 'ae');
  assert.equal(url.searchParams.get('num'), '5');
  assert.equal(url.searchParams.get('api_key'), 'real', 'the real key must not be overridable by a model argument');
  assert.equal(url.searchParams.get('callback'), null);
});

test('SerpApi reporting a failure with HTTP 200 is a failure', async () => {
  // Their error shape. Treating this as success hands the council an empty
  // list and no reason for it.
  const fetchImpl = async () => okResponse({ error: 'Google hasn\'t returned any results for this query.' });
  const res = await searchSerpApi({ engine: 'google_shopping', query: 'zzz', apiKey: 'k', fetchImpl });
  assert.equal(res.ok, false);
  assert.match(res.error, /hasn't returned any results/);
});

test('the result list is found even when the engine moves it', async () => {
  // google_flights returns `best_flights` normally and only `other_flights`
  // when nothing scored well. Keying on the expected name alone would report
  // "no flights" because of a field name.
  const rows = extractRows({ other_flights: [{ price: 'AED 2,400' }] }, 'best_flights');
  assert.equal(rows.length, 1);
  assert.deepEqual(extractRows({ best_flights: [] }, 'best_flights'), []);
  assert.deepEqual(extractRows(null, 'best_flights'), []);
});

test('rows render across engines without a renderer per engine', async () => {
  const text = formatRows([
    { title: 'LG 27', price: 'AED 1,199', source: 'Amazon.ae', link: 'https://a.ae/dp/1' },
    { name: 'Some Cafe', rating: 4.5, address: 'Dubai Marina' },
  ]);
  assert.match(text, /LG 27/);
  assert.match(text, /AED 1,199/);
  assert.match(text, /Some Cafe/);
  assert.match(text, /Dubai Marina/);
});

test('a price given as an object keeps its written form', async () => {
  // {value: "AED 1,199.00", extracted_value: 1199} — the extracted number has
  // lost its currency, and a currency cannot be recovered once discarded.
  const text = formatRows([{ title: 'X', price: { value: 'AED 1,199.00', extracted_value: 1199 } }]);
  assert.match(text, /AED 1,199\.00/);
});

test('network failure degrades, never throws', async () => {
  const boom = async () => { throw new Error('network'); };
  const res = await searchSerpApi({ engine: 'google_shopping', query: 'a', apiKey: 'k', fetchImpl: boom });
  assert.equal(res.ok, false);
  assert.equal(res.rows.length, 0);

  const notOk = async () => ({ ok: false, status: 429, json: async () => ({}) });
  const limited = await searchSerpApi({ engine: 'google_shopping', query: 'a', apiKey: 'k', fetchImpl: notOk });
  assert.match(limited.error, /429/);
});

test('the engine menu names every engine it offers', () => {
  const menu = engineMenu();
  for (const name of ENGINE_NAMES) assert.ok(menu.includes(name), `${name} missing from the menu`);
});

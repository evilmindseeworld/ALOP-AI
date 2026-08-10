const test = require('node:test');
const assert = require('node:assert');
const { searchShopping, formatShopping, shoppingParams, isShoppingQuery } = require('./shopping');

/* The gate decides whether a paid API call happens at all, so both of its
 * mistakes cost something real: a false negative reproduces the exact bug this
 * module was written for, and a false positive bills for nothing. */
test('isShoppingQuery — the question that started this', () => {
  assert.equal(isShoppingQuery('best monitors under 2500 AED'), true);
  assert.equal(isShoppingQuery('cheapest laptop in Dubai'), true);
  assert.equal(isShoppingQuery('how much does a PS5 cost'), true);
  assert.equal(isShoppingQuery('recommend a gaming monitor for $400'), true);
});

test('isShoppingQuery — needs a product AND a money signal, not either', () => {
  /* CHANGED DELIBERATELY: this used to assert false for "the price of
   * freedom", and it now returns true.
   *
   * The AND contract is what kept "air fryer price" out of Google Shopping —
   * the noun list had monitors and laptops and no air fryers, and a closed
   * list of things people buy cannot be completed. Unmistakable buying words
   * now stand alone, and this idiom is the price of that.
   *
   * It costs one Serper query, a fraction of a cent, whose empty result
   * changes no answer. The failure it bought out of is a fabricated price
   * quoted to the user as a fact. This file's own header sets that trade;
   * this line is where it is paid. */
  assert.equal(isShoppingQuery('what is the price of freedom'), true);
  // "cost" is not a strong signal precisely because of this shape, so the
  // AND contract still governs it.
  assert.equal(isShoppingQuery('the cost of the war in Ukraine'), false);
  // A product word with nothing about buying.
  assert.equal(isShoppingQuery('how do I calibrate my monitor'), false);
  assert.equal(isShoppingQuery('who won the election'), false);
  assert.equal(isShoppingQuery(''), false);
  assert.equal(isShoppingQuery(null), false);
});

test('isShoppingQuery — word boundaries, not substrings', () => {
  // "sunder" contains "under", "recost" contains "cost". Both used to fire.
  assert.equal(isShoppingQuery('asunder and recosted monitor lizard habitat'), false);
});

test('shoppingParams sends gl only when it is a real country code', () => {
  assert.deepEqual(shoppingParams('ae'), { gl: 'ae' });
  assert.deepEqual(shoppingParams('AE'), { gl: 'ae' });
  // No region is better than a wrong one: gl=us on a UAE question returns
  // dollars from merchants that will not ship.
  assert.deepEqual(shoppingParams(''), {});
  assert.deepEqual(shoppingParams('XX-invalid'), {});
  assert.deepEqual(shoppingParams(undefined), {});
});

const okResponse = (body) => ({ ok: true, json: async () => body });

test('searchShopping keeps listings that carry a number and drops the rest', async () => {
  const fetchImpl = async () =>
    okResponse({
      shopping: [
        { title: 'LG 27 inch', price: 'AED 1,199.00', source: 'Amazon.ae', link: 'https://amazon.ae/dp/X', delivery: 'Free delivery' },
        { title: 'No price here', source: 'Shop', link: 'https://x.com/p/1' },
        { title: 'Empty price', price: '', source: 'Shop', link: 'https://x.com/p/2' },
      ],
    });
  const { results } = await searchShopping('monitor price', { apiKey: 'k', fetchImpl });
  assert.equal(results.length, 1);
  assert.equal(results[0].price, 'AED 1,199.00');
  assert.equal(results[0].source, 'Amazon.ae');
});

test('searchShopping is inert without a key and never throws', async () => {
  const explode = async () => { throw new Error('should not be called'); };
  assert.deepEqual(await searchShopping('monitor price', { apiKey: '', fetchImpl: explode }), { results: [] });

  // A provider failure degrades the turn; it does not fail it.
  const failing = async () => { throw new Error('network'); };
  assert.deepEqual(await searchShopping('monitor price', { apiKey: 'k', fetchImpl: failing }), { results: [] });

  const notOk = async () => ({ ok: false, json: async () => ({}) });
  assert.deepEqual(await searchShopping('monitor price', { apiKey: 'k', fetchImpl: notOk }), { results: [] });

  // Malformed body — the shape is a third party's, not ours.
  const junk = async () => okResponse({ shopping: 'not an array' });
  assert.deepEqual(await searchShopping('monitor price', { apiKey: 'k', fetchImpl: junk }), { results: [] });
});

test('formatShopping keeps the currency verbatim and states its own limits', () => {
  const block = formatShopping([{ title: 'LG 27', price: 'AED 1,199.00', source: 'Amazon.ae', url: 'https://a.ae/dp/X', delivery: '' }], { asOf: '2026-08-08' });
  // Parsing the price would force a currency guess; 1,899 dirhams silently
  // becoming 1,899 dollars is the failure that avoids.
  assert.match(block, /AED 1,199\.00/);
  assert.match(block, /2026-08-08/);
  // The council must be told this is a sample, or it describes it as the market.
  assert.match(block, /SAMPLE|sample/);
  assert.equal(formatShopping([]), '');
  assert.equal(formatShopping(null), '');
});

/* The noun list was the bug. Requiring a product noun on every shopping
 * question meant live prices ran only for products somebody had enumerated —
 * "air fryer" was not one, so a question that is nothing but buying intent got
 * SEO listicles and quoted a content farm's invented price range. */
test("a buying question about a product nobody listed still gets prices", () => {
  for (const q of [
    "best air fryers in the UAE under 700 AED",
    "air fryer price",
    "cheapest cat litter in dubai",
    "how much is a kayak",
    "espresso machine deals",
    "ninja foodi price uae",
  ]) {
    assert.equal(isShoppingQuery(q), true, `missed: ${q}`);
  }
});

test("the questions that are not about buying anything still cost nothing", () => {
  for (const q of [
    "the monitor lizard",
    "how does an air fryer work",
    "who won the election",
    "best practices for react hooks",
    "best time to visit japan",
    // A currency with no figure is economics, not a budget.
    "the USD is falling against the euro",
  ]) {
    assert.equal(isShoppingQuery(q), false, `false positive: ${q}`);
  }
});

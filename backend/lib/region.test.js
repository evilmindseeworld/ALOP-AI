const test = require("node:test");
const assert = require("node:assert/strict");
const { detectRegion, regionHint, ZONE_COUNTRY, COUNTRY } = require("./region");

// ===== precedence =====

test("the CDN header wins, because infrastructure already saw the IP", () => {
  const r = detectRegion({ cdnCountry: "AE", timezone: "Europe/London", acceptLanguage: "en-US,en" });
  assert.equal(r.country, "AE");
  assert.equal(r.source, "cdn");
});

test("timezone beats Accept-Language", () => {
  // A timezone is one country; a language tag is a preference. `en-US` is the
  // factory default on devices sold worldwide.
  const r = detectRegion({ timezone: "Asia/Dubai", acceptLanguage: "en-US,en;q=0.9" });
  assert.equal(r.country, "AE");
  assert.equal(r.source, "timezone");
});

test("Accept-Language is used when it is all there is", () => {
  const r = detectRegion({ acceptLanguage: "en-GB,en;q=0.9" });
  assert.equal(r.country, "GB");
  assert.equal(r.currency, "GBP");
  assert.equal(r.source, "language");
});

// ===== the answer it produces =====

test("carries a currency and a readable place name", () => {
  assert.deepEqual(
    { ...detectRegion({ cdnCountry: "AE" }) },
    { country: "AE", currency: "AED", place: "the UAE", source: "cdn" },
  );
  assert.equal(detectRegion({ cdnCountry: "JP" }).currency, "JPY");
  assert.equal(detectRegion({ cdnCountry: "DE" }).currency, "EUR");
});

test("place names read naturally in a sentence", () => {
  // "the user appears to be in United States" is the tell of a template.
  for (const code of ["US", "GB", "AE", "NL", "PH"]) {
    assert.ok(/^(the )?[A-ZÀ-Ü]/.test(COUNTRY.get(code)[1]), code);
  }
  assert.ok(regionHint(detectRegion({ cdnCountry: "US" })).includes("in the United States"));
  assert.ok(regionHint(detectRegion({ cdnCountry: "JP" })).includes("in Japan"));
});

// ===== nothing usable =====

test("NOTHING USABLE MEANS NO GUESS AT ALL", () => {
  // Defaulting to US is exactly the bug this module exists to fix. An absent
  // hint is strictly better than a confident wrong one.
  for (const input of [undefined, {}, { timezone: "Mars/Olympus" }, { acceptLanguage: "en" }, { cdnCountry: "" }]) {
    assert.equal(detectRegion(input), null, JSON.stringify(input));
  }
  assert.equal(regionHint(null), "");
  assert.equal(regionHint(undefined), "");
});

test("Cloudflare's non-country codes are not countries", () => {
  // XX is "unknown" and T1 is Tor. Both are two uppercase letters and would
  // pass a naive check.
  assert.equal(detectRegion({ cdnCountry: "XX" }), null);
  assert.equal(detectRegion({ cdnCountry: "T1" }), null);
});

test("an unknown but well-formed country falls through to the next signal", () => {
  // A country we have no currency for is not usable, and must not block a
  // weaker signal that IS.
  const r = detectRegion({ cdnCountry: "AQ", timezone: "Asia/Dubai" });
  assert.equal(r.country, "AE");
});

test("malformed input never throws", () => {
  for (const input of [
    { cdnCountry: 42 },
    { timezone: {} },
    { acceptLanguage: null },
    { acceptLanguage: ",,,;;;" },
    { cdnCountry: "toolong" },
    { acceptLanguage: "*" },
  ]) {
    assert.doesNotThrow(() => detectRegion(input), JSON.stringify(input));
  }
});

test("case and whitespace do not defeat it", () => {
  assert.equal(detectRegion({ cdnCountry: " ae " }).country, "AE");
  assert.equal(detectRegion({ acceptLanguage: "en-gb" }).country, "GB");
  assert.equal(detectRegion({ acceptLanguage: "en_GB" }).country, "GB");
});

// ===== the hint =====

test("THE HINT IS ADVISORY, NOT A FILTER", () => {
  // A user in Dubai asking about US tax law must still get US tax law. The
  // surest way to break that is to state their location as a constraint.
  const hint = regionHint(detectRegion({ cdnCountry: "AE" }));
  assert.ok(hint.includes("may be wrong"));
  assert.ok(hint.includes("follow the question"));
  assert.ok(hint.includes("AED"));
});

test("every mapped timezone resolves to a country we can price in", () => {
  // A zone pointing at a country with no currency entry would silently produce
  // null and look like "no signal" rather than like the data bug it is.
  for (const [zone, code] of ZONE_COUNTRY) {
    assert.ok(COUNTRY.has(code), `${zone} -> ${code} has no currency entry`);
  }
});

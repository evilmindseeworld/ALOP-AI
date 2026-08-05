const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyPage, checkLinks, isCitable, OK, GONE, UNAVAILABLE, UNREACHABLE } = require("./link-check");

const page = (over = {}) => ({
  status: 200,
  requestedUrl: "https://shop.test/p/monitor-xg27",
  finalUrl: "https://shop.test/p/monitor-xg27",
  html: "<html><head><title>ASUS ROG Strix XG27AQWMG</title></head><body><h1>XG27AQWMG</h1></body></html>",
  ...over,
});
const verdict = (over) => classifyPage(page(over)).verdict;

// ===== status =====

test("404 and 410 are gone", () => {
  assert.equal(verdict({ status: 404 }), GONE);
  assert.equal(verdict({ status: 410 }), GONE);
});

test("a healthy page is ok", () => {
  assert.equal(verdict(), OK);
});

test("401 and 403 stay citable", () => {
  // Paywalls and bot checks are not evidence the page is bad. It is a
  // perfectly good citation for a human who has a subscription.
  assert.equal(verdict({ status: 401 }), OK);
  assert.equal(verdict({ status: 403 }), OK);
});

test("5xx is unreachable, not gone", () => {
  // A server having a bad minute says nothing about whether the URL is real.
  assert.equal(verdict({ status: 500 }), UNREACHABLE);
  assert.equal(verdict({ status: 503 }), UNREACHABLE);
  assert.equal(isCitable(UNREACHABLE), true);
});

// ===== soft 404 via redirect =====

test("a deep url bounced to the site root is gone", () => {
  assert.equal(
    verdict({ requestedUrl: "https://shop.test/p/monitor-xg27", finalUrl: "https://shop.test/" }),
    GONE,
  );
});

test("a shallow url landing on root is just canonicalisation", () => {
  assert.equal(verdict({ requestedUrl: "https://shop.test/home", finalUrl: "https://shop.test/" }), OK);
});

test("a redirect to a different host is not a soft 404", () => {
  // Domain moves and link shorteners both do this and both are fine.
  assert.equal(verdict({ requestedUrl: "https://old.test/p/x/y", finalUrl: "https://new.test/" }), OK);
});

test("a deep url redirecting to another deep url is fine", () => {
  assert.equal(
    verdict({ requestedUrl: "https://shop.test/p/x", finalUrl: "https://shop.test/products/x-2026" }),
    OK,
  );
});

// ===== soft 404 via the page saying so =====

test("a 200 page titled Page not found is gone", () => {
  assert.equal(verdict({ html: "<title>Page not found | Shop</title>" }), GONE);
  assert.equal(verdict({ html: "<title>404 Error</title>" }), GONE);
  assert.equal(verdict({ html: "<html><body><h1>We can't find that page</h1></body></html>" }), GONE);
});

test("a product that exists but cannot be bought is unavailable, not gone", () => {
  // Different verdict on purpose: the page is real and may still be worth
  // reading for specs, it just should not be cited as somewhere to buy.
  for (const t of ["No longer available", "Currently unavailable", "Out of stock", "Sold out", "Discontinued"]) {
    assert.equal(verdict({ html: `<title>XG27 — ${t}</title>` }), UNAVAILABLE, t);
  }
});

// ===== the bias: keep good links =====

test("the same phrases in the BODY do not condemn the page", () => {
  // A live product page mentions "out of stock" for one variant, or "sold out"
  // in a related-items rail, constantly. Only the title and h1 count.
  const html =
    "<html><head><title>ASUS ROG Strix XG27AQWMG</title></head><body>" +
    "<h1>XG27AQWMG</h1><aside>Related: AW2725DF — sold out</aside>" +
    "<p>Size 32in: out of stock. Size 27in: in stock.</p></body></html>";
  assert.equal(verdict({ html }), OK);
});

test("a title that merely CONTAINS a signal word is not a match", () => {
  assert.equal(verdict({ html: "<title>Notfoundry Ceramics</title>" }), OK);
  assert.equal(verdict({ html: "<title>Model 404 Turntable Review</title>" }), OK);
  assert.equal(verdict({ html: "<title>How to find a discontinued part</title>" }), UNAVAILABLE);
});

test("no html at all is still ok", () => {
  // A HEAD-only check, or a body we could not read, is not evidence.
  assert.equal(verdict({ html: "" }), OK);
  assert.equal(verdict({ html: undefined }), OK);
});

test("an unparseable url pair is not evidence", () => {
  assert.equal(verdict({ requestedUrl: "not a url", finalUrl: "also not" }), OK);
});

test("only gone and unavailable are uncitable", () => {
  assert.equal(isCitable(OK), true);
  assert.equal(isCitable(UNREACHABLE), true);
  assert.equal(isCitable(GONE), false);
  assert.equal(isCitable(UNAVAILABLE), false);
});

// ===== the batch =====

const fetchPage = async (url) => {
  if (url.includes("dead")) return { status: 404, finalUrl: url, html: "" };
  if (url.includes("boom")) throw new Error("ETIMEDOUT");
  return { status: 200, finalUrl: url, html: "<title>Fine</title>" };
};

test("checks a batch and keys results by url", async () => {
  const r = await checkLinks(["https://a.test/x", "https://dead.test/x", "https://boom.test/x"], { fetchPage });
  assert.equal(r.get("https://a.test/x").verdict, OK);
  assert.equal(r.get("https://dead.test/x").verdict, GONE);
  assert.equal(r.get("https://boom.test/x").verdict, UNREACHABLE);
});

test("a network failure never makes a link uncitable", async () => {
  // Our inability to reach it says nothing about whether it works for a reader.
  const r = await checkLinks(["https://boom.test/x"], { fetchPage });
  assert.equal(isCitable(r.get("https://boom.test/x").verdict), true);
});

test("each url is fetched once however many times it appears", async () => {
  let calls = 0;
  await checkLinks(["https://a.test/x", "https://a.test/x", "https://a.test/x"], {
    fetchPage: async (u) => { calls++; return fetchPage(u); },
  });
  assert.equal(calls, 1);
});

test("the SSRF guard runs BEFORE the fetch", async () => {
  let fetched = false;
  const r = await checkLinks(["http://169.254.169.254/latest/meta-data/"], {
    fetchPage: async () => { fetched = true; return { status: 200, html: "" }; },
    assertSafeUrl: async () => { throw new Error("private or reserved address"); },
  });
  assert.equal(fetched, false, "a blocked URL must never be fetched");
  assert.equal(isCitable(r.get("http://169.254.169.254/latest/meta-data/").verdict), false);
});

test("concurrency is bounded", async () => {
  let inFlight = 0;
  let peak = 0;
  const urls = Array.from({ length: 20 }, (_, i) => `https://a.test/${i}`);
  await checkLinks(urls, {
    concurrency: 4,
    fetchPage: async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return { status: 200, html: "" };
    },
  });
  assert.ok(peak <= 4, `peak was ${peak}`);
});

test("empty and malformed input is a clean empty map", async () => {
  for (const input of [undefined, null, [], [null, "", 42]]) {
    const r = await checkLinks(input, { fetchPage });
    assert.equal(r.size, 0, JSON.stringify(input));
  }
});

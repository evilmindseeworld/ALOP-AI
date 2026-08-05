const test = require("node:test");
const assert = require("node:assert/strict");
const { extractPageSignal, hasPrice } = require("./page-extract");

/** A retail page shaped like the ones that caused the bug: price far down. */
const retailPage = (priceLine) =>
  ["# Microless UAE", "Home > Monitors > Gaming", "Free delivery on orders over 200",
   ...Array.from({ length: 60 }, (_, i) => `Some marketing sentence number ${i} about the display technology.`),
   "## ASUS ROG Strix OLED XG27AQWMG",
   priceLine,
   "In stock — ships within 2 days",
   ...Array.from({ length: 40 }, (_, i) => `Related product ${i}`)].join("\n");

test("THE PRICE SURVIVES EVEN WHEN IT IS FAR PAST THE OLD 3000-CHAR CUTOFF", () => {
  // The exact failure: three UAE retailers all showed a price, and the answer
  // said none did, because the fetch was truncated before reaching it.
  const page = retailPage("AED 1,899.00");
  assert.ok(page.length > 3000, "fixture must actually exceed the old limit");
  assert.equal(page.slice(0, 3000).includes("AED 1,899.00"), false, "…and hide the price inside it");

  const out = extractPageSignal(page);
  assert.ok(out.includes("AED 1,899.00"));
  assert.ok(out.includes("In stock"));
});

test("keeps the head, which is where the product name is", () => {
  const out = extractPageSignal(retailPage("AED 1,899.00"));
  assert.ok(out.includes("Microless UAE"));
});

test("recognises the currencies this app actually answers in", () => {
  for (const line of [
    "AED 1,899.00", "SAR 2,199", "₹ 1,49,900", "£1,199.99", "€1.299,00",
    "$899.00", "Rs. 149900", "Dhs. 1,899", "1,899 AED", "USD 899",
  ]) {
    assert.equal(hasPrice(line), true, line);
  }
});

test("a currency word with no number nearby is not a price", () => {
  // "Prices shown in AED" appears on nearly every UAE retail page.
  assert.equal(hasPrice("All prices shown in AED"), false);
  assert.equal(hasPrice("We accept USD and EUR"), false);
  assert.equal(hasPrice("Model number XG27AQWMG"), false);
});

test("a number far from the currency marker is not a price", () => {
  // Otherwise "Prices in AED. Part 90LM0BZ0-B01171" scores.
  assert.equal(hasPrice("Prices in AED. Part number 90LM0BZ0-B01171 ships worldwide today"), false);
});

test("captures availability, which is the other thing a shopper needs", () => {
  const out = extractPageSignal(retailPage("AED 1,899.00"));
  assert.ok(/in stock/i.test(out));
});

test("does not repeat a line that is already in the head", () => {
  const page = ["AED 99.00", ...Array.from({ length: 80 }, () => "filler line")].join("\n");
  const out = extractPageSignal(page);
  assert.equal((out.match(/AED 99\.00/g) || []).length, 1);
});

/**
 * Filler long enough to push what follows past the 2500-character head.
 *
 * The first version of the two tests below used 60 short lines — about 430
 * characters — so the whole fixture sat INSIDE the head and the scanner never
 * ran on it. They failed for a reason that had nothing to do with what they
 * were testing, which is its own lesson about fixtures.
 */
const pastTheHead = () =>
  Array.from({ length: 60 }, (_, i) => `Filler line ${i} with enough words in it to take up real space on the page.`);

test("deduplicates repeated price rows", () => {
  // Markdown tables and sticky nav emit the same price many times.
  const page = ["# Shop", ...pastTheHead(), ...Array.from({ length: 12 }, () => "AED 1,899.00")].join("\n");
  const out = extractPageSignal(page);
  assert.equal((out.match(/AED 1,899\.00/g) || []).length, 1);
});

test("ignores long prose that happens to mention a number", () => {
  const prose = "In 2019 the company sold 4,500 units at an average of USD 300 across every region it operated in, which analysts described as a turning point for the category and a signal of broader demand.";
  const page = ["# Article", ...pastTheHead(), prose].join("\n");
  assert.equal(extractPageSignal(page).includes(prose), false);
});

test("stays inside its ceiling however many prices a page has", () => {
  const page = ["# Shop", ...Array.from({ length: 60 }, () => "filler"),
    ...Array.from({ length: 400 }, (_, i) => `Product ${i} — AED ${1000 + i}.00`)].join("\n");
  const out = extractPageSignal(page);
  assert.ok(out.length <= 4000, `got ${out.length}`);
});

test("a page with no prices falls back to the head, unlabelled", () => {
  const page = ["# A blog post", ...Array.from({ length: 80 }, () => "no numbers here at all")].join("\n");
  const out = extractPageSignal(page);
  assert.ok(out.includes("A blog post"));
  assert.equal(out.includes("PRICE AND AVAILABILITY"), false);
});

test("empty and malformed input returns an empty string, never throws", () => {
  for (const v of ["", "   ", null, undefined, 42, {}]) {
    assert.equal(extractPageSignal(v), "");
  }
});

test("a short page is returned whole", () => {
  assert.equal(extractPageSignal("Just this."), "Just this.");
});

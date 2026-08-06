const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

/**
 * The sign-in page's roster must be the roster the server actually runs.
 *
 * `frontend/src/constants/council.js` duplicates `COUNCIL` in `server.js`, and
 * that duplication is deliberate — the sign-in page renders before the user has
 * a token, so there is no authenticated call it could make, and publishing an
 * unauthenticated roster endpoint would be a new public surface for a marketing
 * detail. That reasoning is sound and it is written down in the frontend file.
 *
 * What was not sound is the sentence after it: "it is wrong until someone
 * updates it". The hero of the sign-in page is the roster — seven real models
 * at seven real temperatures — and the whole argument of that page is that the
 * numbers are checkable. A roster that has drifted from the server is the one
 * claim on the page that must not be false, because it is the only claim the
 * page makes about the product's internals.
 *
 * A documented invariant is not enforced until something checks it. This is the
 * check. It costs one regex over two files and it never needs a network call.
 *
 * Deliberately NOT asserted: the order. The frontend sorts by temperature on
 * purpose, because the ladder low-to-high is the explanation. The server's
 * order is the order the seats were written in and means nothing.
 */

const BACKEND = readFileSync(join(__dirname, "..", "server.js"), "utf8");
const FRONTEND = readFileSync(
  join(__dirname, "..", "..", "frontend", "src", "constants", "council.js"),
  "utf8",
);

/**
 * Seats are parsed FIELD BY FIELD, not by one whole-object pattern.
 *
 * The first version matched `{ model: …, temperature: …, free: … }` as a single
 * shape, and broke the moment the frontend seats grew `title`, `company` and
 * `blurb` for the display layer — it parsed zero seats on that side. It failed
 * loudly rather than comparing two empty lists, which is the only reason that
 * was a five-minute fix instead of a guard that had silently stopped guarding.
 *
 * So: find each object block that declares a `model`, then pull the three
 * fields that must agree out of it independently. Field order, line breaks and
 * any number of extra display-only fields are all now irrelevant, because the
 * contract is about three values and never was about formatting.
 */
const blocks = (src) => src.split("{").filter((b) => /\bmodel:\s*['"]/.test(b));

const field = (block, name, pattern) => {
  const m = new RegExp(`\\b${name}:\\s*${pattern}`).exec(block);
  return m ? m[1] : null;
};

const seats = (src) =>
  blocks(src)
    .map((b) => ({
      model: field(b, "model", `['"]([^'"]+)['"]`),
      temperature: field(b, "temperature", `([0-9.]+)`),
      free: field(b, "free", `(true|false)`),
    }))
    .filter((s) => s.model && s.temperature !== null && s.free !== null)
    .map((s) => `${s.model} @${Number(s.temperature).toFixed(1)} ${s.free === "true" ? "free" : "pro"}`)
    .sort();

const backendSeats = seats(BACKEND);
const frontendSeats = seats(FRONTEND);

test("the parser found a roster on both sides at all", () => {
  // A guard on the guard. Two empty lists compare equal, and would turn this
  // whole file into a test that passes because it stopped reading anything.
  assert.ok(backendSeats.length >= 5, `backend roster parsed as ${backendSeats.length} seats`);
  assert.ok(frontendSeats.length >= 5, `frontend roster parsed as ${frontendSeats.length} seats`);
});

test("the sign-in page advertises exactly the council the server runs", () => {
  // Model name, temperature and free/pro, all three. A temperature drift is the
  // subtle one: the page's argument is the 0.2-to-0.8 spread, so a seat quietly
  // retuned on the server makes the ladder a picture of something that is no
  // longer true.
  assert.deepEqual(frontendSeats, backendSeats);
});

test("the free tier is a real subset, not the whole council", () => {
  // If every seat were free, the Pro tag on the sign-in page and the plan split
  // in classifyRequest would both be decoration.
  const free = backendSeats.filter((s) => s.endsWith("free"));
  assert.ok(free.length > 0, "no free seats — the free plan would have no council");
  assert.ok(free.length < backendSeats.length, "every seat is free — Pro buys nothing");
});

test("temperatures actually spread, because the spread is the product claim", () => {
  // "They disagree on purpose" is on the sign-in page. Seven seats at one
  // temperature would be one answer seven times, and the page would be lying.
  const temps = backendSeats.map((s) => Number(/@([0-9.]+)/.exec(s)[1]));
  assert.ok(Math.max(...temps) - Math.min(...temps) >= 0.3, `spread is only ${Math.max(...temps) - Math.min(...temps)}`);
  assert.ok(new Set(temps).size >= 3, "fewer than three distinct temperatures");
});

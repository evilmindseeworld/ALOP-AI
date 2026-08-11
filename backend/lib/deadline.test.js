const test = require("node:test");
const assert = require("node:assert/strict");
const { settleByDeadline } = require("./deadline");

const after = (ms, value) => new Promise((r) => setTimeout(() => r(value), ms));
const rejectAfter = (ms, msg) => new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms));

test("returns everything when everything is fast", async () => {
  const { results, pending } = await settleByDeadline(
    [
      { promise: after(5, "a"), fallback: null },
      { promise: after(5, "b"), fallback: null },
    ],
    { deadlineMs: 500 },
  );
  assert.deepEqual(results, ["a", "b"]);
  assert.equal(pending, 0);
});

test("DOES NOT WAIT FOR THE SLOWEST PROVIDER", async () => {
  // The actual bug: Brave answers in 300ms, Google hangs to its 8s timeout,
  // and the user waits 8s to be shown Brave's results.
  const started = Date.now();
  const { results, waited, pending } = await settleByDeadline(
    [
      { promise: after(10, "brave"), fallback: null },
      { promise: after(5000, "google"), fallback: null },
    ],
    { deadlineMs: 120 },
  );
  assert.deepEqual(results, ["brave", null]);
  assert.equal(pending, 1);
  assert.ok(waited < 400, `waited ${waited}ms`);
  assert.ok(Date.now() - started < 500);
});

test("resolves early once `enough` is satisfied, like the council's quorum", async () => {
  const started = Date.now();
  const { results } = await settleByDeadline(
    [
      { promise: after(5, ["r1", "r2", "r3"]), fallback: [] },
      { promise: after(5000, ["r4"]), fallback: [] },
      { promise: after(5000, ["r5"]), fallback: [] },
    ],
    { deadlineMs: 5000, enough: (r) => r.flat().length >= 3 },
  );
  assert.deepEqual(results[0], ["r1", "r2", "r3"]);
  assert.ok(Date.now() - started < 500, "should not have waited for the slow two");
});

test("a provider that throws contributes its fallback, and the call still resolves", async () => {
  const { results } = await settleByDeadline(
    [
      { promise: Promise.reject(new Error("401 bad key")), fallback: [] },
      { promise: after(5, ["ok"]), fallback: [] },
    ],
    { deadlineMs: 300 },
  );
  assert.deepEqual(results, [[], ["ok"]]);
});

test("all providers failing is an empty result, not a rejection", async () => {
  // Search degrading to nothing is a turn that says "I found nothing", not a
  // 500. This must never reject.
  await assert.doesNotReject(async () => {
    const { results } = await settleByDeadline(
      [
        { promise: Promise.reject(new Error("a")), fallback: [] },
        { promise: Promise.reject(new Error("b")), fallback: [] },
      ],
      { deadlineMs: 300 },
    );
    assert.deepEqual(results, [[], []]);
  });
});

test("A STRAGGLER THAT REJECTS AFTER THE DEADLINE DOES NOT CRASH THE PROCESS", async () => {
  // An unhandled rejection is a process-level event in Node — in production
  // that is a crash on the wrong config, caused by a search provider being
  // slow. This is the property most worth having a test for.
  const seen = [];
  const onUnhandled = (e) => seen.push(e);
  process.on("unhandledRejection", onUnhandled);

  await settleByDeadline(
    [
      { promise: after(5, "fast"), fallback: null },
      { promise: rejectAfter(60, "late failure"), fallback: null },
    ],
    { deadlineMs: 20 },
  );
  await new Promise((r) => setTimeout(r, 150));

  process.off("unhandledRejection", onUnhandled);
  assert.deepEqual(seen, []);
});

test("a late arrival does not mutate the array the caller already has", async () => {
  const { results } = await settleByDeadline(
    [
      { promise: after(5, "fast"), fallback: null },
      { promise: after(80, "late"), fallback: null },
    ],
    { deadlineMs: 20 },
  );
  assert.deepEqual(results, ["fast", null]);
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(results, ["fast", null], "the late value must not appear afterwards");
});

test("an empty list resolves immediately", async () => {
  const { results, pending } = await settleByDeadline([], { deadlineMs: 1000 });
  assert.deepEqual(results, []);
  assert.equal(pending, 0);
});

test("malformed input does not throw", async () => {
  for (const v of [undefined, null, "nonsense"]) {
    const { results } = await settleByDeadline(v, { deadlineMs: 50 });
    assert.deepEqual(results, []);
  }
});

test("a non-promise value is accepted as already settled", async () => {
  const { results } = await settleByDeadline([{ promise: "plain", fallback: null }], { deadlineMs: 100 });
  assert.deepEqual(results, ["plain"]);
});

test("A PREDICATE THAT THROWS DOES NOT CRASH THE PROCESS EITHER", async () => {
  // The `enough` call sits inside a `then` whose promise nobody holds, so a
  // throw from the caller's predicate became the same process-level event the
  // straggler test above exists to prevent — arriving by the one route the
  // fallbacks did not cover.
  const seen = [];
  const onUnhandled = (e) => seen.push(e);
  process.on("unhandledRejection", onUnhandled);

  const { results } = await settleByDeadline(
    [
      { promise: after(5, "fast"), fallback: null },
      { promise: new Promise(() => {}), fallback: "never" },
    ],
    {
      deadlineMs: 40,
      enough: (r) => {
        if (r[0] === "fast") throw new Error("predicate blew up");
        return false;
      },
    },
  );
  await new Promise((r) => setTimeout(r, 100));

  process.off("unhandledRejection", onUnhandled);
  assert.deepEqual(seen, []);
  // A predicate that cannot answer has not said "enough": the deadline still
  // governs, and what had landed by then is returned.
  assert.deepEqual(results, ["fast", "never"]);
});

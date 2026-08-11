const test = require("node:test");
const assert = require("node:assert/strict");
const { runCouncil, SEAT_STATES } = require("./council-run");

/**
 * The council runner.
 *
 * This is the most intricate concurrency in the product and until now it had no
 * test, because it lived in server.js which cannot be required. It decides how
 * long a user waits and how many opinions their answer is built from, and it
 * has three separate ways to finish. All three are here.
 */

const seat = (model, temperature = 0.5) => ({ model, temperature });

/** A callModel that resolves each named model after a set delay. */
const scripted = (script) => (model) => {
  const entry = script[model];
  if (!entry) return Promise.reject(new Error(`no script for ${model}`));
  const { after = 0, content, throws } = entry;
  return new Promise((resolve, reject) => {
    setTimeout(() => (throws ? reject(new Error(throws)) : resolve(content)), after);
  });
};

test("resolves as soon as quorum is met, without waiting for the rest", async () => {
  // The whole point of the whip. A council of five where two providers are slow
  // must answer in the time the fast three took.
  const started = Date.now();
  const results = await runCouncil(
    [seat("a"), seat("b"), seat("c"), seat("slow-1"), seat("slow-2")],
    [],
    5000,
    3,
    500,
    {
      callModel: scripted({
        a: { content: "answer a" },
        b: { content: "answer b" },
        c: { content: "answer c" },
        "slow-1": { after: 3000, content: "late" },
        "slow-2": { after: 3000, content: "later" },
      }),
    }
  );
  assert.equal(results.length, 3);
  assert.ok(Date.now() - started < 1000, "waited for the slow seats after quorum was made");
});

test("quorum aborts model calls that were left outside the answer", async () => {
  let slowAborted = false;
  let release;
  const timings = [];
  const finish = [];
  const results = await runCouncil(
    [seat("a"), seat("b"), seat("c"), seat("slow")],
    [],
    5000,
    3,
    500,
    {
      callModel: (model, _messages, _temperature, _whip, _tokens, signal) => {
        if (model === "slow") {
          return new Promise((resolve, reject) => {
            release = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            signal.addEventListener("abort", () => { slowAborted = true; release(); }, { once: true });
          });
        }
        return new Promise((resolve) => setTimeout(() => resolve(`answer ${model}`), 5));
      },
      onSeatTiming: (row) => timings.push(row),
      onFinish: (event) => finish.push(event),
    },
  );
  assert.equal(results.length, 3);
  assert.equal(slowAborted, true);
  assert.equal(finish[0].reason, "quorum");
  assert.equal(timings.length, 4);
  assert.ok(timings.some((row) => row.model === "slow" && row.outcome === "quorum"));
});

test("the whip aborts a model call and reports its bounded duration", async () => {
  let aborted = false;
  const timings = [];
  const results = await runCouncil([seat("never")], [], 20, 1, 500, {
    callModel: (_model, _messages, _temperature, _whip, _tokens, signal) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => { aborted = true; reject(new Error("cancelled")); }, { once: true });
    }),
    onSeatTiming: (row) => timings.push(row),
  });
  assert.deepEqual(results, []);
  assert.equal(aborted, true);
  assert.equal(timings[0].outcome, "timed_out");
  assert.ok(timings[0].durationMs < 200);
});

test("a disconnected parent aborts all seats without rejecting the runner", async () => {
  const controller = new AbortController();
  let aborted = false;
  const pending = runCouncil([seat("never")], [], 5000, 1, 500, {
    signal: controller.signal,
    callModel: (_model, _messages, _temperature, _whip, _tokens, signal) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => { aborted = true; reject(new Error("client left")); }, { once: true });
    }),
  });
  setTimeout(() => controller.abort(), 5);
  assert.deepEqual(await pending, []);
  assert.equal(aborted, true);
});

test("returns what it has when the whip fires", async () => {
  const results = await runCouncil([seat("fast"), seat("never")], [], 60, 2, 500, {
    callModel: scripted({
      fast: { content: "in time" },
      never: { after: 5000, content: "too late" },
    }),
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].content, "in time");
});

test("resolves when every seat has settled, even below quorum", async () => {
  // Quorum of 3 is unreachable with two failures. It must not hold the user
  // until the whip.
  const started = Date.now();
  const results = await runCouncil([seat("a"), seat("dead-1"), seat("dead-2")], [], 5000, 3, 500, {
    callModel: scripted({
      a: { content: "the only one" },
      "dead-1": { throws: "502" },
      "dead-2": { throws: "timeout" },
    }),
  });
  assert.equal(results.length, 1);
  assert.ok(Date.now() - started < 1000, "held the room open after every seat had settled");
});

test("a bare skip is neither an answer nor a failure", async () => {
  const seen = [];
  const results = await runCouncil([seat("a"), seat("skipper")], [], 5000, 5, 500, {
    callModel: scripted({ a: { content: "real answer" }, skipper: { content: "  Skip. " } }),
    onSeat: (e) => seen.push(e),
  });
  assert.equal(results.length, 1, "a skip must not reach the synthesis");
  assert.equal(seen.filter((e) => e.state === SEAT_STATES.SKIPPED).length, 1);
  assert.equal(seen.filter((e) => e.state === SEAT_STATES.FAILED).length, 0);
});

test("an answer that merely starts with skip is still an answer", () => {
  // The regex is anchored at both ends for this. "Skipping the preamble: ..."
  // is a real answer and losing it would be silent.
  return runCouncil([seat("a")], [], 5000, 1, 500, {
    callModel: scripted({ a: { content: "Skipping the preamble, here is the answer." } }),
  }).then((results) => assert.equal(results.length, 1));
});

test("an empty completion is failed, not skipped", async () => {
  // The model did not choose to say nothing, so it must not read as a
  // deliberate abstention in the interface.
  const seen = [];
  await runCouncil([seat("a")], [], 5000, 1, 500, {
    callModel: scripted({ a: { content: "  " } }),
    onSeat: (e) => seen.push(e),
  });
  assert.deepEqual(
    seen.map((e) => e.state),
    [SEAT_STATES.THINKING, SEAT_STATES.FAILED]
  );
});

test("every seat is announced before it is asked", async () => {
  // The interface draws seven seats thinking the moment the turn starts. If
  // `thinking` were emitted late, the board would fill in one seat at a time
  // and read as a queue rather than as a room.
  const seen = [];
  await runCouncil([seat("a"), seat("b"), seat("c")], [], 5000, 3, 500, {
    callModel: scripted({ a: { content: "x" }, b: { content: "y" }, c: { content: "z" } }),
    onSeat: (e) => seen.push(e),
  });
  const firstThree = seen.slice(0, 3);
  assert.deepEqual(
    firstThree.map((e) => e.state),
    [SEAT_STATES.THINKING, SEAT_STATES.THINKING, SEAT_STATES.THINKING]
  );
  assert.deepEqual(new Set(firstThree.map((e) => e.model)), new Set(["a", "b", "c"]));
});

test("a reporter that throws cannot lose an answer", async () => {
  // onSeat writes to an HTTP response in production. A client that disconnects
  // mid-turn must not cost the user a model call they already paid for.
  const results = await runCouncil([seat("a"), seat("b")], [], 5000, 2, 500, {
    callModel: scripted({ a: { content: "answer a" }, b: { content: "answer b" } }),
    onSeat: () => {
      throw new Error("socket closed");
    },
  });
  assert.equal(results.length, 2);
});

test("runs with no reporter at all", async () => {
  const results = await runCouncil([seat("a")], [], 5000, 1, 500, {
    callModel: scripted({ a: { content: "fine" } }),
  });
  assert.equal(results.length, 1);
});

test("an empty roster resolves immediately rather than hanging to the whip", async () => {
  const started = Date.now();
  const results = await runCouncil([], [], 5000, 1, 500, { callModel: scripted({}) });
  assert.deepEqual(results, []);
  assert.ok(Date.now() - started < 500);
});

test("refuses to run without a way to call a model", async () => {
  // An async function rejects rather than throwing synchronously, so this is
  // rejects() and not throws(). Worth a test at all because the failure it
  // guards is silent: without callModel every seat would reject and the user
  // would get the fallback answer with no indication the council never ran.
  await assert.rejects(() => runCouncil([seat("a")], [], 100, 1, 10, {}), /callModel/);
});

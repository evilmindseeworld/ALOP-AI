const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { createRequestBudget } = require("./request-budget");

const LIMITS = { dayRequests: 1000, warnRequests: 800 };

/** Records every rpc call so the ARGUMENTS can be asserted, not just the result. */
const spyRpc = (impl) => {
  const calls = [];
  const rpc = async (fn, args) => {
    calls.push({ fn, args });
    return impl(fn, args);
  };
  rpc.calls = calls;
  return rpc;
};

const ok = (row) => async () => ({ data: [row], error: null });

// ===== the reservation =====

test("a turn inside the budget is admitted", async () => {
  const { reserve } = createRequestBudget({ rpc: spyRpc(ok({ allowed: true, used: 47 })), limits: LIMITS });
  assert.deepEqual(await reserve(10), { allowed: true, used: 47 });
});

test("a turn that would exceed the day is REFUSED", async () => {
  // The whole mechanism. The SQL increments first and rolls back on failure, so
  // `used` here is the count with this turn's reservation already removed —
  // which is what makes it safe to show a user.
  const { reserve } = createRequestBudget({ rpc: spyRpc(ok({ allowed: false, used: 1000 })), limits: LIMITS });
  const result = await reserve(47);
  assert.equal(result.allowed, false);
  assert.equal(result.used, 1000);
  assert.notEqual(result.unmetered, true, "a refusal must not be reported as unmetered");
});

test("THE COUNTER IS GLOBAL — no user id ever reaches the store", async () => {
  // The single most likely thing for a later edit to get wrong, because every
  // OTHER ceiling in this codebase is per-user and the analogy is inviting.
  // OpenRouter's free-model quota belongs to the ACCOUNT: keying this per user
  // would enforce 1000/day as 1000 PER USER, which is no limit at all.
  const rpc = spyRpc(ok({ allowed: true, used: 1 }));
  const budget = createRequestBudget({ rpc, limits: LIMITS });
  await budget.reserve(10);
  await budget.settle(10, 5);

  assert.ok(rpc.calls.length >= 2, "expected both calls to reach the store");
  for (const { fn, args } of rpc.calls) {
    const keys = Object.keys(args).join(",");
    assert.ok(
      !/user|clerk|account_id|tenant/i.test(keys),
      `${fn} was called with a per-identity key (${keys}) — this budget is account-wide`,
    );
    for (const value of Object.values(args)) {
      assert.notEqual(typeof value, "string", `${fn} received a string argument; only numbers belong in a global counter`);
    }
  }
});

test("the reservation asks for the configured day limit, not a hardcoded one", async () => {
  const rpc = spyRpc(ok({ allowed: true, used: 1 }));
  const { reserve } = createRequestBudget({ rpc, limits: { dayRequests: 50, warnRequests: 40 } });
  await reserve(9);
  assert.deepEqual(rpc.calls[0], { fn: "reserve_or_requests", args: { p_requests: 9, p_day_limit: 50 } });
});

// ===== failing open =====

test("a broken store ADMITS the turn rather than taking the product down", async () => {
  // Failing closed would convert a Supabase blip into a total outage. The
  // exposure is a window of unmetered requests, and OpenRouter's own 429 is
  // still behind us. Same trade pg-rate-limit-store.js makes and argues.
  const errors = [];
  const { reserve } = createRequestBudget({
    rpc: async () => { throw new Error("connection refused"); },
    limits: LIMITS,
    onError: (m) => errors.push(m),
  });

  const result = await reserve(10);
  assert.equal(result.allowed, true);
  assert.equal(result.unmetered, true);
  assert.equal(result.used, null, "an unmetered admission must not invent a count");
  assert.equal(errors.length, 1, "a ceiling that stopped applying must not be silent about it");
  assert.match(errors[0], /UNMETERED/);
});

test("a store that answers with an error object also fails open", async () => {
  // Supabase reports failure in the payload rather than by throwing, so the
  // error path has two entrances and both have to work.
  const errors = [];
  const { reserve } = createRequestBudget({
    rpc: async () => ({ data: null, error: { message: "permission denied" } }),
    limits: LIMITS,
    onError: (m) => errors.push(m),
  });
  assert.equal((await reserve(10)).allowed, true);
  assert.match(errors[0], /permission denied/);
});

test("an empty result set is a failure, not an admission with no count", async () => {
  const errors = [];
  const { reserve } = createRequestBudget({
    rpc: async () => ({ data: [], error: null }),
    limits: LIMITS,
    onError: (m) => errors.push(m),
  });
  const result = await reserve(10);
  assert.equal(result.allowed, true);
  assert.equal(result.unmetered, true);
  assert.equal(errors.length, 1);
});

// ===== settlement =====

test("settlement hands back the reservation and charges the real count", async () => {
  const rpc = spyRpc(ok({ used: 42 }));
  const { settle } = createRequestBudget({ rpc, limits: LIMITS });
  await settle(47, 11);
  assert.deepEqual(rpc.calls[0], { fn: "settle_or_requests", args: { p_reserved: 47, p_actual: 11 } });
});

test("an aborted turn settles to what it actually spent, not to zero and not to the reservation", async () => {
  // A turn the client abandoned still made the provider calls it made, and
  // OpenRouter still counted them. Settling to 0 would hand back quota that was
  // really consumed; leaving the reservation would hold quota nobody spent.
  const rpc = spyRpc(ok({ used: 20 }));
  const { settle } = createRequestBudget({ rpc, limits: LIMITS });
  await settle(47, 3);
  assert.deepEqual(rpc.calls[0].args, { p_reserved: 47, p_actual: 3 });
});

test("a refused turn refunds its whole reservation", async () => {
  const rpc = spyRpc(ok({ used: 0 }));
  const { settle } = createRequestBudget({ rpc, limits: LIMITS });
  await settle(47, 0);
  assert.deepEqual(rpc.calls[0].args, { p_reserved: 47, p_actual: 0 });
});

test("a failed settlement is logged and never rejects", async () => {
  // It runs from a `finally` that does not await it, and an unhandled rejection
  // in a `finally` ends the process under Node's default policy.
  const errors = [];
  const { settle } = createRequestBudget({
    rpc: async () => { throw new Error("gone"); },
    limits: LIMITS,
    onError: (m) => errors.push(m),
  });
  await assert.doesNotReject(() => settle(10, 5));
  assert.match(errors[0], /Settlement failed/);
});

// ===== the warn threshold =====

test("crossing the warn mark logs and REFUSES NOTHING", async () => {
  const warnings = [];
  const { settle } = createRequestBudget({ rpc: spyRpc(ok({ used: 801 })), limits: LIMITS, onWarn: (m) => warnings.push(m) });
  const used = await settle(10, 10);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /801\/1000/);
  assert.equal(used, 801, "the warn path must not swallow the settled count");
});

test("the warn mark fires exactly AT the threshold, not one past it", async () => {
  const warnings = [];
  const { settle } = createRequestBudget({ rpc: spyRpc(ok({ used: 800 })), limits: LIMITS, onWarn: (m) => warnings.push(m) });
  await settle(1, 1);
  assert.equal(warnings.length, 1, "800 of an 800 warn threshold must warn");
});

test("below the warn mark is silent", async () => {
  const warnings = [];
  const { settle } = createRequestBudget({ rpc: spyRpc(ok({ used: 799 })), limits: LIMITS, onWarn: (m) => warnings.push(m) });
  await settle(1, 1);
  assert.deepEqual(warnings, []);
});

// ===== construction =====

test("a missing dependency fails loudly at construction, not silently at request time", () => {
  assert.throws(() => createRequestBudget({ limits: LIMITS }), /rpc function/);
  assert.throws(() => createRequestBudget({ rpc: async () => ({}) }), /numeric limits/);
});

// ===== the route contract =====
//
// server.js exits during import when deployment configuration is absent, so the
// wiring is asserted against its source. These are the parts that live in the
// route rather than in this module, and each one is a way the mechanism can be
// present and still not work.

const SERVER = readFileSync(join(__dirname, "..", "server.js"), "utf8");
const ROUTE = SERVER.slice(SERVER.indexOf("app.post('/api/council'"), SERVER.indexOf("// ===== OVERLAY"));

test("the request ceiling is checked BEFORE any model is called", () => {
  // A ceiling enforced after the first provider call is a report, not a ceiling.
  const guard = ROUTE.indexOf("if (!requestBudget.allowed)");
  assert.ok(guard !== -1, "the request ceiling is missing from the council route");
  assert.ok(guard < ROUTE.indexOf("runCouncilWithWhip"), "the ceiling must precede the council");
  assert.ok(guard < ROUTE.indexOf("streamModel("), "the ceiling must precede any streamed model call");
});

test("the refusal is a 402 carrying a reason that distinguishes it from the money ceiling", () => {
  // Same status and shape as the cost refusal so an existing client keeps
  // working; the reason is what tells a reader which ceiling fired, and they
  // mean opposite things — one is about this user, the other about everyone.
  const refusal = ROUTE.slice(ROUTE.indexOf("if (!requestBudget.allowed)"));
  assert.match(refusal, /res\.status\(402\)/);
  assert.match(refusal, /reason: 'daily_request_limit'/);
});

test("a turn refused by the request ceiling does not keep the user's money reservation", () => {
  // The `finally` skips settlement when the turn never started, so without an
  // explicit refund here the cost reservation would be held until midnight
  // against a turn that was refused. Charging a user for a refused turn is
  // worse than not having the ceiling.
  const refusal = ROUTE.slice(
    ROUTE.indexOf("if (!requestBudget.allowed)"),
    ROUTE.indexOf("requestsReserved = reservedRequests"),
  );
  assert.match(refusal, /settleSpend\(user\.id, spendReserved, 0\)/);
  assert.match(refusal, /spendReserved = 0/);
});

test("the settlement runs from the finally and is NOT guarded on a user id", () => {
  // The cost ledger needs a user to credit and so cannot settle without one.
  // This counter is global, so a turn that reserved must always hand back what
  // it did not spend — including on paths where the user row never resolved.
  // Guarding on auditUserId would leak the reservation until midnight UTC.
  const tail = ROUTE.slice(ROUTE.lastIndexOf("} finally {"));
  assert.match(tail, /if \(requestsReserved > 0\) \{/);
  assert.ok(
    !/if \(requestsReserved > 0 && auditUserId\)/.test(tail),
    "the global request settlement must not depend on a user id",
  );
  assert.match(tail, /settleRequests\(requestsReserved, countTurnRequests\(/);
});

test("the synthesis cap is never below the council's own draft ceiling", () => {
  // Two limits on two different calls, and confusing them is easy. The router's
  // tokenLimit bounds each SEAT's draft; SYNTH_MAX_TOKENS bounds the synthesis
  // that writes what the user reads. If the synthesis cap is the lower of the
  // two, every draft arrives complete and the essay built from them is cut off
  // mid-sentence — healthy in every log, broken only for the user.
  const synth = Number(/complex: (\d+) \}/.exec(SERVER.slice(SERVER.indexOf("const SYNTH_MAX_TOKENS")))?.[1]);
  assert.ok(Number.isFinite(synth), "could not read SYNTH_MAX_TOKENS.complex");

  // Read ONLY the tokenLimit expression, up to the end of its line. A looser
  // sweep of the file picked up `whipMs: 5000` — a millisecond value — and
  // reported a truncation bug that did not exist. A guard that fails on the
  // wrong evidence is worse than none: it gets silenced rather than believed.
  const router = readFileSync(join(__dirname, "router.js"), "utf8");
  const limitLines = [...router.matchAll(/tokenLimit:([^\n]*)/g)].map((m) => m[1]);
  assert.ok(limitLines.length > 0, "could not find a tokenLimit in router.js");
  const drafts = limitLines.flatMap((line) => [...line.matchAll(/\b(\d{3,6})\b/g)].map((m) => Number(m[1])));
  const largestDraft = Math.max(...drafts);
  assert.ok(
    synth >= largestDraft,
    `SYNTH_MAX_TOKENS.complex is ${synth} but a council seat may draft up to ${largestDraft} — synthesis would truncate`,
  );
});

test("the reservation and the price are computed from the same turn shape", () => {
  // Two ceilings disagreeing about what a turn will do is how one of them ends
  // up wrong. Both take the same seat count and the same agent-loop literals.
  assert.match(ROUTE, /reservationCents\(selection\.members\.length, 12, 4\)/);
  assert.match(ROUTE, /reservationRequests\(selection\.members\.length, 12, 4\)/);
});

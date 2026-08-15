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

// ===== what a turn really costs =====
//
// The numbers below were derived independently by a second reviewer from the
// call sites, and they are the ones the previous accounting got wrong. It
// charged a flat overhead of 3 to council turns and exactly 1 to everything
// else; the overhead named three calls that are NOT made per turn (the router's
// classification is pure code, the title fires once per new chat, the feedback
// note only when a user rates an answer) while missing the four that are — two
// router MODEL calls and the two fire-and-forget rememberTurn calls.
//
// Nearly right, composed of entirely the wrong things, and therefore the kind
// of number that survives review indefinitely. These tests pin the arithmetic
// to the branch shapes so it cannot drift back.

const { countTurnRequests, reservationRequests } = require("./spend");

const ROUTER = { memory: { ms: 5, ok: true }, search: { ms: 5, ok: true } };
const council = (n) => ({
  seats: Array.from({ length: n }, (_, i) => ({ model: `m${i}` })),
  synthesisMs: 9,
  routerReads: ROUTER,
  fastCalls: 2,
});

test("a council turn costs its seats plus synthesis plus four", () => {
  // 2 router calls + N seats + 1 synthesis + 2 rememberTurn.
  assert.equal(countTurnRequests(council(1)), 6, "simple tier");
  assert.equal(countTurnRequests(council(3)), 8, "moderate tier");
  assert.equal(countTurnRequests(council(7)), 12, "complex tier");
});

test("the cheap branches cost FIVE, not one", () => {
  // The worst of the old errors. A memory or search answer spends two router
  // calls, one streamed answer and two rememberTurn calls — it was charged 1.
  assert.equal(countTurnRequests({ routerReads: ROUTER, fastCalls: 2 }), 5);
});

test("a turn that skipped the router is not charged for it", () => {
  // A greeting and an image turn set skipRouter, so neither router call is
  // dispatched. Counting them from routerReads rather than from a constant is
  // what makes this free instead of a flat charge.
  assert.equal(countTurnRequests({}), 1, "greeting: one streamed answer");
  assert.equal(countTurnRequests({ routerReads: ROUTER }), 3, "search with no results");
});

test("fire-and-forget memory calls are counted, because nothing else can see them", () => {
  // rememberTurn's two calls leave no seat record, no synthesis time and no
  // router read. Without recordFastCalls they are invisible to the meter and
  // every answering turn undercounts by two.
  assert.equal(countTurnRequests({ ...council(3), fastCalls: 0 }), 6);
  assert.equal(countTurnRequests(council(3)), 8);
});

test("the reservation still bounds the corrected count", () => {
  // The load-bearing property, re-checked after the correction: raising what a
  // turn is known to cost without raising the reservation would let concurrent
  // turns walk the shared cap past its limit.
  const seats = [];
  for (let round = 1; round <= 4; round++) for (let i = 0; i < 7; i++) seats.push({ model: `m${i}`, round });
  for (let i = 0; i < 7; i++) seats.push({ model: `m${i}`, round: 5 });
  const worst = { seats, synthesisMs: 1200, fallbackCouncil: { used: true }, routerReads: ROUTER, fastCalls: 2 };
  assert.ok(
    reservationRequests(7, 12, 4) >= countTurnRequests(worst),
    `reservation ${reservationRequests(7, 12, 4)} does not bound worst case ${countTurnRequests(worst)}`,
  );
});

test("every answering branch records its memory calls", () => {
  // The count is only right if rememberTurn is actually handed the telemetry at
  // every call site. Five branches answer a user; missing one undercounts that
  // branch by two forever, and it is invisible because the other four are right.
  // Matched to end-of-statement rather than to the first ")", because one call
  // site passes a nested expression — `validResponses[0]?.content?.slice(0,800)`
  // — and a lazy match stopped inside it and reported a correct call as broken.
  // A guard that fails on well-formed code gets silenced rather than believed.
  const calls = [...SERVER.matchAll(/rememberTurn\(.*?\);$/gm)].map((m) => m[0]);
  assert.ok(calls.length >= 5, `expected 5 rememberTurn call sites, found ${calls.length}`);
  for (const call of calls) {
    // `telemetry` is the fifth argument and the turn id follows it, so this
    // checks the argument is PRESENT rather than last — anchoring on the end of
    // the statement made adding a sixth argument look like dropping the fifth.
    assert.match(call, /,\s*telemetry\s*[,)]/, `${call} does not pass telemetry, so its two provider calls go uncounted`);
  }
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
  assert.match(refusal, /reservationLedger\.settle\(\{[\s\S]{0,200}?actualCents: 0,/);
  /* THROUGH THE LEDGER, so the early settlement and the one in the route's
   * `finally` cannot both apply. Two paths reach a settlement for this turn and
   * the second used to be stopped only by `spendReserved` being zeroed — a
   * guard one edit away from being wrong. `settle_turn_reservation` transitions
   * the row once and reports FALSE to the loser. */
  assert.match(refusal, /turnId: turnContext\.turnId/);
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

// ===== every model-calling route is behind the budget =====
//
// The audit finding this closes: the ledger was wired into /api/council and
// nowhere else, so three authenticated routes called OpenRouter with no
// reservation. One ordinary account could drive ~90 unmetered requests a minute
// across them — a 50-request day gone in under a minute — and once OpenRouter
// returned its own 429 the latch refused the COUNCIL for every user. An
// unmetered side route does not just overspend its own budget; it takes the
// main feature down for everybody.
//
// A ceiling with three doors around it is not a ceiling, so the assertion is
// not "these three routes were fixed" but "no model call sits outside a
// wrapper" — the form that also catches the fourth route nobody has written yet.

const MODEL_ROUTES = [
  { path: "/api/overlay", reserve: 2 },
  { path: "/api/chat-title", reserve: 1 },
  { path: "/api/feedback", reserve: 1 },
];

/* CODE ONLY. Counting `spend()` across the raw slice counted the sentence in the
 * handler's own comment explaining where spend() goes, and reported a correct
 * route as broken — the third time today a guard has been fooled by the prose
 * sitting next to the thing it checks. A guard that fires on a comment gets
 * silenced rather than believed, so comments come out before anything counts. */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const routeBody = (path) => {
  const start = SERVER.indexOf(`app.post('${path}'`);
  assert.notEqual(start, -1, `${path} is missing`);
  const next = SERVER.indexOf("\napp.", start + 1);
  return stripComments(SERVER.slice(start, next === -1 ? SERVER.length : next));
};

for (const { path, reserve } of MODEL_ROUTES) {
  test(`${path} reserves against the daily budget before calling a model`, () => {
    const body = routeBody(path);
    const guard = body.indexOf("withRequestBudget(");
    assert.ok(guard !== -1, `${path} calls OpenRouter without reserving`);
    // Before the model call, not merely present somewhere in the handler.
    const firstCall = body.indexOf("callModel(");
    assert.ok(firstCall !== -1, `${path} no longer calls a model — update this list`);
    assert.ok(guard < firstCall, `${path} reserves AFTER its first model call`);
  });

  test(`${path} reserves an honest upper bound`, () => {
    // Admission commits to a number before the work happens, so a route that
    // can exceed its reservation walks the shared cap past its limit exactly
    // like an under-reserved council turn. Counted against the callModel sites
    // in the handler; the vision call is Google's endpoint, not OpenRouter's.
    const body = routeBody(path);
    const declared = Number(new RegExp(`withRequestBudget\\(res, (\\d+)`).exec(body)?.[1]);
    assert.equal(declared, reserve, `${path} reserves ${declared}, expected ${reserve}`);
    const calls = (body.match(/callModel\(/g) || []).length;
    assert.ok(declared >= calls, `${path} reserves ${declared} but can make ${calls} OpenRouter calls`);
  });

  test(`${path} counts every attempt, including ones that throw`, () => {
    // OpenRouter charges quota for a request it received, so a failed call is
    // spent quota. Counting only successes would make the expensive failure
    // case free — the same rule the council's seat counting follows.
    const body = routeBody(path);
    const spends = (body.match(/\bspend\(\)/g) || []).length;
    const calls = (body.match(/callModel\(/g) || []).length;
    assert.equal(spends, calls, `${path} has ${calls} model calls but ${spends} spend() records`);
  });
}

test("NO model-calling route escapes the budget wrapper", () => {
  // The form that survives a fourth route being added. Every `app.post`/`app.get`
  // handler containing a callModel or streamModel must also contain a budget
  // gate — either the wrapper, or the council's own reserve/settle pair.
  const handlers = [...SERVER.matchAll(/\napp\.(post|get|put)\('([^']+)'/g)];
  const offenders = [];
  for (let i = 0; i < handlers.length; i++) {
    const start = handlers[i].index;
    const end = i + 1 < handlers.length ? handlers[i + 1].index : SERVER.length;
    const body = stripComments(SERVER.slice(start, end));
    const path = handlers[i][2];
    const callsModel = /\b(callModel|streamModel)\(/.test(body);
    if (!callsModel) continue;
    const gated = body.includes("withRequestBudget(") || body.includes("reserveRequests(");
    if (!gated) offenders.push(path);
  }
  assert.deepEqual(
    offenders,
    [],
    `these routes call OpenRouter with no reservation: ${offenders.join(", ")}`,
  );
});

test("the refusal is identical in shape across every route", () => {
  // A client that handles one 402 handles all of them. `reason` is the field
  // that says which ceiling fired, and it must not vary by route.
  const wrapper = SERVER.slice(SERVER.indexOf("const withRequestBudget"), SERVER.indexOf("// ===== HEALTH ====="));
  assert.match(wrapper, /res\.status\(402\)/);
  assert.match(wrapper, /reason: 'daily_request_limit'/);
  assert.match(wrapper, /Retry-After/);
});

test("the wrapper settles from a finally, so a throw cannot strand quota", () => {
  // Every exit has already reserved. A reservation that is never settled is
  // quota lost until midnight UTC for every user, not just this one.
  const wrapper = SERVER.slice(SERVER.indexOf("const withRequestBudget"), SERVER.indexOf("// ===== HEALTH ====="));
  assert.match(wrapper, /\} finally \{[\s\S]*settleRequests\(worstCase, spent\)/);
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
  //
  // The MONEY reservation takes one argument the request reservation does not,
  // and the asymmetry is correct rather than drift: a metered tool seat costs
  // three times a free seat in cents and exactly the same in OpenRouter
  // requests, because the request quota does not care what a request cost.
  assert.match(ROUTE, /reservationCents\(maxSeats, 12, 4, toolSeatCount\)/);
  assert.match(ROUTE, /reservationRequests\(maxSeats, 12, 4\)/);
});

test("THE METERED SEAT IS PRICED AS ONE, at reservation and at settlement", () => {
  // Every other seat on this council is a `:free` id billed at $0, so the money
  // ceiling has never bound on a model call. The native tool seat is the first
  // that can. Reserving it at the free rate under-reserves by exactly the
  // difference on the one path that can actually spend money — and an
  // under-reservation is only discovered at settlement, after several
  // concurrent turns have each been admitted on it.
  assert.match(ROUTE, /const toolSeatCount = mayAddToolSeat \? 1 : 0/);
  assert.match(ROUTE, /planRoster\.length \+ toolSeatCount/,
    "the tool seat is not in planRoster — it is added by policy — so the worst case is one seat wider than either");
  assert.match(ROUTE, /priceTurn\([\s\S]{0,80}?\{ toolSeatModel: TOOL_SEAT_MODEL \}\)/,
    "settling at the free rate refunds the difference straight back to the user");
});

test("the reservation covers the roster the research escalation can widen to", () => {
  // The seat count is no longer the one classifyRequest returned: a turn the
  // router sends to live research is re-selected onto the full council further
  // down. Reserving against the narrow roster and widening afterwards is a
  // downstream layer re-expanding a budget set above it — the money is gone
  // before anything can refuse it — so the pessimism has to live at admission.
  assert.match(ROUTE, /const maxSeats = mayEscalate[\s\S]{0,120}planRoster\.length/);
  assert.match(ROUTE, /escalateForResearch\(selection, planRoster\)/);
  // Both seeded and direct search now reach the council, so every non-greeting
  // turn must reserve enough headroom to widen after the router decides.
  assert.match(ROUTE, /const mayEscalate = selection\.category !== 'greeting'/);
});

// ===== degraded mode: fail open, but not forever =====

const dead = () => async () => { throw new Error('supabase unreachable'); };
const QUIET = { onError: () => {}, onWarn: () => {} };

test("the first failure still admits — a blip must not be an outage", async () => {
  const { reserve } = createRequestBudget({ rpc: dead(), limits: LIMITS, ...QUIET });
  const result = await reserve(10);
  assert.equal(result.allowed, true);
  assert.equal(result.unmetered, true);
  assert.equal(result.degraded, true, "the caller must be able to tell this apart from a metered admission");
});

test("THE FAIL-OPEN IS BOUNDED. An outage can no longer empty the account", async () => {
  // The defect: `allowed: true` was returned for every request for as long as
  // the store was down, with no counter of any kind. A Supabase outage of an
  // hour could spend the whole day's allowance, invisibly — the only number
  // anyone could look at lived in the store that was down.
  const { reserve } = createRequestBudget({ rpc: dead(), limits: { ...LIMITS, degradedRequests: 25 }, ...QUIET });

  let admitted = 0;
  for (let i = 0; i < 20; i++) if ((await reserve(5)).allowed) admitted++;

  assert.equal(admitted, 5, "25 degraded requests at 5 per turn is five turns, then it refuses");
  const refused = await reserve(5);
  assert.equal(refused.allowed, false);
  assert.equal(refused.degraded, true);
  assert.equal(refused.degradedLimit, 25);
  assert.notEqual(refused.unmetered, true, "a refusal is not an unmetered admission");
});

test("a turn is either fully covered by the degraded allowance or refused", async () => {
  const { reserve } = createRequestBudget({ rpc: dead(), limits: { ...LIMITS, degradedRequests: 10 }, ...QUIET });
  assert.equal((await reserve(8)).allowed, true);
  // 2 left, 8 asked. Admitting it would make the ceiling a suggestion.
  assert.equal((await reserve(8)).allowed, false);
  assert.equal((await reserve(2)).allowed, true, "a turn that DOES fit is still admitted");
});

test("the default degraded allowance is a strict fraction of the day", async () => {
  const { reserve } = createRequestBudget({ rpc: dead(), limits: LIMITS, ...QUIET });
  assert.equal((await reserve(1)).degradedLimit, 50, "5% of 1000");

  const tiny = createRequestBudget({ rpc: dead(), limits: { dayRequests: 4, warnRequests: 3 }, ...QUIET });
  assert.equal((await tiny.reserve(1)).degradedLimit, 1, "a small day still admits something rather than failing closed");
});

test("recovery needs no intervention, and clears the spent allowance", async () => {
  let up = false;
  const rpc = async () => {
    if (!up) throw new Error('down');
    return { data: [{ allowed: true, used: 3 }], error: null };
  };
  const { reserve } = createRequestBudget({ rpc, limits: { ...LIMITS, degradedRequests: 2 }, ...QUIET });

  assert.equal((await reserve(2)).allowed, true);
  assert.equal((await reserve(2)).allowed, false, "allowance spent");

  up = true;
  const metered = await reserve(2);
  assert.equal(metered.allowed, true);
  assert.equal(metered.degraded, undefined, "a metered admission is not degraded");

  up = false;
  assert.equal((await reserve(2)).allowed, true, "the allowance was reset by the recovery");
});

test("settlement refunds the local ledger, so a cheap turn does not cost a worst case", async () => {
  const budget = createRequestBudget({ rpc: dead(), limits: { ...LIMITS, degradedRequests: 10 }, ...QUIET });
  // Reserve charges the worst case (8); the turn actually spent 2.
  assert.equal((await budget.reserve(8)).allowed, true);
  await budget.settle(8, 2);
  // 8 - 6 refunded = 2 spent, so an 8-request turn still fits.
  assert.equal((await budget.reserve(8)).allowed, true);
});

test("the local allowance resets with the UTC day", async () => {
  let clock = Date.parse('2026-08-14T23:59:00Z');
  const { reserve } = createRequestBudget({
    rpc: dead(),
    limits: { ...LIMITS, degradedRequests: 1 },
    now: () => clock,
    ...QUIET,
  });
  assert.equal((await reserve(1)).allowed, true);
  assert.equal((await reserve(1)).allowed, false);

  clock = Date.parse('2026-08-15T00:01:00Z');
  assert.equal((await reserve(1)).allowed, true, "a new day's real budget is untouched, so this one must be too");
});

test("degraded refusals are logged — a ceiling nobody can see is not a ceiling", async () => {
  const errors = [];
  const { reserve } = createRequestBudget({
    rpc: dead(),
    limits: { ...LIMITS, degradedRequests: 1 },
    onError: (m) => errors.push(m),
    onWarn: () => {},
  });
  await reserve(1);
  await reserve(1);
  assert.match(errors[0], /DEGRADED/);
  assert.match(errors[1], /REFUSING/);
  assert.match(errors[1], /supabase unreachable/, "the cause has to survive to the log");
});

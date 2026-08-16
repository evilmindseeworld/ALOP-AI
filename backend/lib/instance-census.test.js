const test = require("node:test");
const assert = require("node:assert/strict");
const {
  startInstanceCensus,
  countLiveInstances,
  instanceId,
  CENSUS_PREFIX,
  CENSUS_TTL_MS,
} = require("./instance-census");

/**
 * A fake `rate_limits` table. Small enough to read, and it enforces the two
 * properties the census depends on: `key` is a primary key (so an instance
 * beating twice is still one row) and expired rows are not returned.
 */
const fakeDb = ({ rows = new Map(), failUpsert = null, failSelect = null } = {}) => ({
  rows,
  from() {
    return {
      upsert: async (row) => {
        if (failUpsert) return { error: { message: failUpsert } };
        rows.set(row.key, row);
        return { error: null };
      },
      select() {
        const chain = {
          _like: null,
          _after: null,
          like(_col, pattern) { chain._like = pattern.replace(/%$/, ""); return chain; },
          gt(_col, value) { chain._after = value; return chain; },
          then(resolve) {
            if (failSelect) return resolve({ data: null, error: { message: failSelect } });
            const data = [...rows.values()]
              .filter((r) => r.key.startsWith(chain._like ?? ""))
              .filter((r) => !chain._after || r.expires_at > chain._after)
              .map((r) => ({ key: r.key }));
            return resolve({ data, error: null });
          },
        };
        return chain;
      },
    };
  },
});

const census = (db, options = {}) =>
  startInstanceCensus({
    db,
    sharedStore: false,
    log: () => {},
    warn: () => {},
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {},
    ...options,
  });

test("one instance beating repeatedly is still one instance", async () => {
  const db = fakeDb();
  const seen = [];
  const c = census(db, { id: "inst-a", onCensus: (s) => seen.push(s) });
  await c.tick();
  await c.tick();
  assert.deepEqual(seen.at(-1), { instances: 1, unsafe: false });
});

test("two instances with the shared store OFF is the unsafe state", async () => {
  const rows = new Map();
  const seen = [];
  await census(fakeDb({ rows }), { id: "inst-a" }).tick();
  await census(fakeDb({ rows }), { id: "inst-b", onCensus: (s) => seen.push(s) }).tick();
  assert.deepEqual(seen.at(-1), { instances: 2, unsafe: true });
});

test("two instances with the shared store ON is fine, and says so quietly", async () => {
  const rows = new Map();
  const lines = [];
  await census(fakeDb({ rows }), { id: "inst-a", sharedStore: true }).tick();
  const c = census(fakeDb({ rows }), {
    id: "inst-b",
    sharedStore: true,
    log: (l) => lines.push(l),
    warn: (l) => lines.push(`WARN ${l}`),
  });
  await c.tick();
  assert.equal(lines.filter((l) => l.startsWith("WARN")).length, 0);
  assert.match(lines.join("\n"), /2 instance\(s\) running, limits shared through postgres/);
});

test("the warning names the multiplier, because that is the number that is wrong", async () => {
  const rows = new Map();
  const warnings = [];
  await census(fakeDb({ rows }), { id: "a" }).tick();
  await census(fakeDb({ rows }), { id: "b" }).tick();
  const c = census(fakeDb({ rows }), { id: "c", warn: (l) => warnings.push(l) });
  await c.tick();
  assert.match(warnings.join("\n"), /3 INSTANCES ARE RUNNING/);
  assert.match(warnings.join("\n"), /currently 3x its configured value/);
});

test("an instance that stopped beating drops out of the count", async () => {
  const rows = new Map();
  const start = Date.now();
  await census(fakeDb({ rows }), { id: "old", now: () => start }).tick();

  const seen = [];
  const later = start + CENSUS_TTL_MS + 1;
  await census(fakeDb({ rows }), { id: "new", now: () => later, onCensus: (s) => seen.push(s) }).tick();
  assert.deepEqual(seen.at(-1), { instances: 1, unsafe: false });
});

test("a census that cannot be taken is null, never a reassuring 1", async () => {
  const seen = [];
  const warnings = [];
  const c = census(fakeDb({ failSelect: "connection refused" }), {
    onCensus: (s) => seen.push(s),
    warn: (l) => warnings.push(l),
  });
  await c.tick();
  assert.deepEqual(seen.at(-1), { instances: null, unsafe: false });
  assert.match(warnings.join("\n"), /instance count unavailable/);
});

test("a failed heartbeat is reported and does not throw into the timer", async () => {
  const warnings = [];
  const c = census(fakeDb({ failUpsert: "table missing" }), { warn: (l) => warnings.push(l) });
  await c.tick();
  assert.match(warnings.join("\n"), /heartbeat failed: table missing/);
});

test("the state is reported when it changes, not once a minute forever", async () => {
  const rows = new Map();
  const lines = [];
  const c = census(fakeDb({ rows }), { id: "a", log: (l) => lines.push(l), warn: (l) => lines.push(l) });
  await c.tick();
  await c.tick();
  await c.tick();
  assert.equal(lines.length, 1, "three beats, one line, because nothing changed");
});

test("the census key carries its own prefix so it cannot collide with a limiter counter", async () => {
  const rows = new Map();
  await census(fakeDb({ rows }), { id: "inst-a" }).tick();
  const key = [...rows.keys()][0];
  assert.equal(key, `${CENSUS_PREFIX}inst-a`);
  // A limiter's own rows are prefixed `<name>|` and must not be counted as
  // instances — which is what this filter proves.
  rows.set("api-floor|u:user_1", { key: "api-floor|u:user_1", expires_at: new Date(Date.now() + 60_000).toISOString() });
  assert.equal(await countLiveInstances({ db: fakeDb({ rows }) }), 1);
});

test("Render's per-instance id is preferred over the hostname", () => {
  assert.equal(instanceId({ RENDER_INSTANCE_ID: "srv-abc-123", HOSTNAME: "box" }), "srv-abc-123");
  assert.equal(instanceId({ HOSTNAME: "box" }), "box");
  assert.match(instanceId({}), /^pid-\d+$/);
});

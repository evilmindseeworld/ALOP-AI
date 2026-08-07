const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { API_CACHE_CONTROL, noStoreApi, setNoStore } = require("./http-cache");

test("API cache policy is no-store", () => {
  const headers = {};
  const response = { setHeader: (name, value) => { headers[name] = value; } };
  assert.equal(setNoStore(response), response);
  assert.equal(headers["Cache-Control"], API_CACHE_CONTROL);
});

test("noStoreApi sets the header and continues the request", () => {
  const headers = {};
  let continued = false;
  noStoreApi({}, { setHeader: (name, value) => { headers[name] = value; } }, () => { continued = true; });
  assert.equal(headers["Cache-Control"], "no-store");
  assert.equal(continued, true);
});

test("server mounts no-store before API handlers", () => {
  const source = readFileSync(join(__dirname, "..", "server.js"), "utf8");
  const policy = source.indexOf("app.use('/api', noStoreApi)");
  const firstHandler = source.search(/app\.(?:get|post|put|patch|delete)\('\/api/);
  assert.ok(policy >= 0, "the API cache middleware is not mounted");
  assert.ok(firstHandler > policy, "an API handler precedes the no-store policy");
});

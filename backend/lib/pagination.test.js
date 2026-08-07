const test = require("node:test");
const assert = require("node:assert/strict");
const { boundedPage, pageInfo } = require("./pagination");

test("boundedPage supplies the default page", () => {
  assert.deepEqual(
    boundedPage({}, { defaultLimit: 50, maxLimit: 100, maxOffset: 10000 }),
    { limit: 50, offset: 0 },
  );
});

test("boundedPage clamps hostile limits and offsets", () => {
  assert.deepEqual(
    boundedPage({ limit: "100000", offset: "-20" }, { defaultLimit: 50, maxLimit: 100, maxOffset: 10000 }),
    { limit: 100, offset: 0 },
  );
  assert.deepEqual(
    boundedPage({ limit: "0", offset: "999999" }, { defaultLimit: 50, maxLimit: 100, maxOffset: 10000 }),
    { limit: 1, offset: 10000 },
  );
});

test("pageInfo reports another page only inside the offset ceiling", () => {
  assert.equal(pageInfo([1, 2], { limit: 2, offset: 9998 }, 10000).hasMore, true);
  assert.equal(pageInfo([1, 2], { limit: 2, offset: 9999 }, 10000).hasMore, false);
  assert.equal(pageInfo([1], { limit: 2, offset: 0 }, 10000).hasMore, false);
});

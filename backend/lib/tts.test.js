const test = require("node:test");
const assert = require("node:assert/strict");
const { synthesize, boundText, isConfigured, MAX_CHARS } = require("./tts");

/**
 * The two things that can go wrong here cost money.
 *
 * One is billing the paid model by omitting a header that defaults to it. The
 * other is letting an unbounded body through, since Fish Audio charges per
 * character and the client is not a trust boundary.
 */

test("unconfigured is a 501, not an attempted call", async () => {
  let called = false;
  const out = await synthesize("hello", {
    env: {},
    fetchImpl: async () => {
      called = true;
    },
  });
  assert.equal(out.ok, false);
  assert.equal(out.status, 501);
  assert.equal(called, false, "must not reach the provider without a key");
  assert.equal(isConfigured({}), false);
});

test("defaults to the free model", async () => {
  let sent;
  await synthesize("hello", {
    env: { FISH_AUDIO_API_KEY: "k" },
    fetchImpl: async (url, init) => {
      sent = init;
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(4), headers: { get: () => "audio/mpeg" } };
    },
  });
  // Fish Audio defaults to s2.1-pro, which is the paid one. Omitting this
  // header is a silent bill.
  assert.equal(sent.headers.model, "s2.1-pro-free");
  assert.equal(sent.headers.Authorization, "Bearer k");
});

test("an explicit model overrides the free default", async () => {
  let sent;
  await synthesize("hello", {
    env: { FISH_AUDIO_API_KEY: "k", FISH_AUDIO_MODEL: "s2.1-pro" },
    fetchImpl: async (url, init) => {
      sent = init;
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(4), headers: { get: () => null } };
    },
  });
  assert.equal(sent.headers.model, "s2.1-pro");
});

test("omits reference_id entirely when no voice is configured", async () => {
  let body;
  await synthesize("hello", {
    env: { FISH_AUDIO_API_KEY: "k" },
    fetchImpl: async (url, init) => {
      body = JSON.parse(init.body);
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(4), headers: { get: () => null } };
    },
  });
  // Sending reference_id: undefined would serialise away, but an empty string
  // would not, and Fish Audio would reject it. This asserts the key is absent.
  assert.equal("reference_id" in body, false);
  assert.equal(body.format, "mp3");
});

test("out of credit is distinguished from broken", async () => {
  const paid = await synthesize("hello", {
    env: { FISH_AUDIO_API_KEY: "k" },
    fetchImpl: async () => ({ ok: false, status: 402 }),
  });
  assert.equal(paid.status, 402);

  const broken = await synthesize("hello", {
    env: { FISH_AUDIO_API_KEY: "k" },
    fetchImpl: async () => ({ ok: false, status: 500 }),
  });
  assert.equal(broken.status, 502, "a provider 500 is our 502, not our 500");
});

test("boundText caps what a caller can bill", () => {
  assert.equal(boundText("x".repeat(MAX_CHARS + 500)).length, MAX_CHARS);
  assert.equal(boundText("  spaced   out  "), "spaced out");
  assert.equal(boundText(""), null);
  assert.equal(boundText("   "), null);
  assert.equal(boundText(null), null);
  assert.equal(boundText(12), null);
  // An object with a toString would otherwise reach the provider as "[object Object]".
  assert.equal(boundText({}), null);
});

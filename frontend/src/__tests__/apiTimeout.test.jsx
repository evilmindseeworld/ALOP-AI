import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useApi, API_TIMEOUT_MS } from "../lib/api";

// The bug this file exists for: a request that never settles.
//
// `loadChats` clears its skeleton in a `finally`. When `apiCall` was unbounded,
// a sleeping backend meant the promise never settled, the `finally` never ran,
// and the signed-in app sat on skeleton loaders forever — no error, no toast,
// nothing to click. Every assertion below is about the promise SETTLING.
//
// Mutation-tested: delete the AbortController/timer from `useApi` and the first
// two tests hang and then fail by name.
describe("apiCall timeouts", () => {
  const call = (getToken) => renderHook(() => useApi(getToken)).result.current;

  // A fetch that never answers, with the abort semantics the real one has:
  // an ALREADY-aborted signal rejects immediately rather than waiting for an
  // abort event that has been and gone. Getting that wrong hangs the test and
  // reads exactly like a source bug, which cost a run here.
  // Rejects with the shape the REAL fetch uses: a DOMException whose `name` is
  // "AbortError". The first version rejected with `new Error("AbortError")`,
  // so the abort test matched on a message the platform never produces and
  // could not tell "reported as an abort" from "reported as anything at all".
  const abortError = () =>
    typeof DOMException === "function"
      ? new DOMException("The user aborted a request.", "AbortError")
      : Object.assign(new Error("The user aborted a request."), { name: "AbortError" });

  const hangingFetch = () =>
    vi.fn(
      (_url, opts) =>
        new Promise((_, reject) => {
          const fail = () => reject(abortError());
          if (opts.signal.aborted) fail();
          else opts.signal.addEventListener("abort", fail, { once: true });
        })
    );

  /** A response whose headers have arrived but whose body never will. */
  const headersThenStall = () =>
    vi.fn(async (_url, opts) => ({
      ok: true,
      json: () =>
        new Promise((_, reject) => {
          const fail = () => reject(abortError());
          if (opts.signal.aborted) fail();
          else opts.signal.addEventListener("abort", fail, { once: true });
        }),
    }));

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("rejects when getToken never resolves", async () => {
    // Clerk unreachable. getToken is not a fetch, so no signal can cancel it —
    // if it is not raced against the deadline, nothing ever settles.
    vi.stubGlobal("fetch", vi.fn());
    const apiCall = call(() => new Promise(() => {}));

    const p = apiCall("/api/chats");
    const assertion = expect(p).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS + 1);
    await assertion;
  });

  it("rejects when fetch never settles", async () => {
    // A sleeping Render instance: the socket opens and then nothing arrives.
    vi.stubGlobal("fetch", hangingFetch());
    const apiCall = call(async () => "token");

    const p = apiCall("/api/chats");
    const assertion = expect(p).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS + 1);
    await assertion;
  });

  it("rejects when the body never arrives, not just when the headers do not", async () => {
    // THE BUG THE FIRST FIX MISSED. `fetch` resolves at the response HEADERS.
    // Every caller reads the body afterwards — `loadChats` does `res.json()`
    // — so clearing the deadline on return left a backend that answers
    // headers and then stalls hanging the caller exactly as before.
    vi.stubGlobal("fetch", headersThenStall());
    const res = await call(async () => "token")("/api/chats");

    const p = res.json();
    const assertion = expect(p).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS + 1);
    await assertion;
  });

  it("survives a 22.5s cold boot, which is what the 45s is for", async () => {
    // A timeout that fires on a healthy request is worse than no timeout: it
    // breaks the app that was working. The measured Render cold boot is 22.5s.
    //
    // This asserts the number rather than assuming it — the earlier version
    // used a mock that resolved at t=0, so it passed for ANY value of
    // API_TIMEOUT_MS, including 1ms. Lower the constant below 22.5s and this
    // fails.
    const COLD_BOOT_MS = 22_500;
    expect(API_TIMEOUT_MS).toBeGreaterThan(COLD_BOOT_MS);

    const fetchMock = vi.fn(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, json: async () => ({}) }), COLD_BOOT_MS))
    );
    vi.stubGlobal("fetch", fetchMock);

    const p = call(async () => "token")("/api/chats");
    await vi.advanceTimersByTimeAsync(COLD_BOOT_MS);
    const res = await p;

    expect(res.ok).toBe(true);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
  });

  it("releases the deadline once the body is read", async () => {
    // The timer must not outlive a completed read, or it aborts a response
    // nobody is watching and keeps the environment awake.
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ chats: [] }) }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await call(async () => "token")("/api/chats");
    await expect(res.json()).resolves.toEqual({ chats: [] });

    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS + 1);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
  });

  it("rejects immediately when the caller's signal is already aborted", async () => {
    // An aborted signal never fires the event, so subscribing alone ignored it
    // for the full 45s. Real fetch rejects at once.
    vi.stubGlobal("fetch", hangingFetch());
    const external = new AbortController();
    external.abort();

    await expect(
      call(async () => "token")("/api/chats", { signal: external.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("sends the bearer token and the API base path", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);

    await call(async () => "abc123")("/api/chats");

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/chats$/);
    expect(opts.headers.Authorization).toBe("Bearer abc123");
  });

  it("relays a caller's own signal instead of ignoring it", async () => {
    // Before the rewrite `options.signal` was spread into fetch and then
    // overwritten, so passing one did nothing at all.
    vi.stubGlobal("fetch", hangingFetch());
    const external = new AbortController();

    const p = call(async () => "token")("/api/chats", { signal: external.signal });
    external.abort();

    // A deliberate abort is NOT a timeout, and must not be reported as one:
    // the caller cancelled, the network is fine. Asserted on `name`, which is
    // where the platform actually puts it — matching the message would pass
    // against any error at all.
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    await expect(p).rejects.not.toThrow(/timed out/i);
  });
});

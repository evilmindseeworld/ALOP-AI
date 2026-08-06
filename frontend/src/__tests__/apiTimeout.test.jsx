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
  const hangingFetch = () =>
    vi.fn(
      (_url, opts) =>
        new Promise((_, reject) => {
          const fail = () => reject(new Error("AbortError"));
          if (opts.signal.aborted) fail();
          else opts.signal.addEventListener("abort", fail, { once: true });
        })
    );

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

  it("does not abort a call that finishes inside the deadline", async () => {
    // The guard against the obvious over-correction: a timeout that fires on a
    // healthy request is worse than no timeout, because it breaks the app that
    // was working. A cold boot is 22.5s and must still succeed.
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const apiCall = call(async () => "token");

    const res = await apiCall("/api/chats");

    expect(res).toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);

    // The timer must be cleared, or it aborts a signal nobody is watching and
    // — worse — keeps the test environment awake.
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS + 1);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
  });

  it("sends the bearer token and the API base path", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
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
    // the caller cancelled, the network is fine.
    await expect(p).rejects.toThrow(/AbortError/);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useChats } from "../hooks/useChats";

/**
 * THE COMPOSER MUST ALWAYS COME BACK.
 *
 * `send` and `generateImage` take an in-flight lock — `sendInFlightRef` plus
 * `status` — and every early return has to hand it back. At the time this file
 * was written there were ELEVEN separate `sendInFlightRef.current = false`
 * statements across the two functions, each one a manual release on a
 * particular exit path, and `generateImage` had no try/catch/finally at all.
 *
 * That shape is a known trap in this exact file. Its own header records the
 * expensive version of it:
 *
 *   "three separate bugs have lived here. The expensive one was the abort path:
 *    it returned without resetting status, which left the composer permanently
 *    disabled the moment a user-facing Stop button existed."
 *
 * A lock released by hand at N exit points is correct only while every one of
 * those N is remembered AND nothing between them throws. `finally` is correct
 * by construction and does not need to be remembered.
 *
 * The concrete hole this file demonstrates: `onAttachmentConsumed?.()` is a
 * CALLER-SUPPLIED callback invoked before the streaming try block. It belongs
 * to App.jsx, it clears the attachment preview, and nothing here can promise it
 * will not throw. If it does, the lock is never released, the composer is dead
 * for the rest of the session, and the only recovery is a page reload.
 *
 * The assertion is deliberately about being able to SEND AGAIN, not about the
 * value of a ref. A user does not care which flag is stuck; they care that the
 * box stopped working.
 */

const setup = () => {
  const setToast = vi.fn();
  const apiCall = vi.fn(async (path, options = {}) => {
    if (path === "/api/chats" && options.method === "POST") {
      return { ok: true, json: async () => ({ id: "chat-1", title: "New Chat", messages: [] }) };
    }
    if (path === "/api/chats" && !options.method) {
      return { ok: true, json: async () => ({ chats: [], hasMore: false }) };
    }
    return { ok: true, json: async () => ({}) };
  });

  // A council response that completes immediately, so a successful send is
  // genuinely finished rather than left mid-stream.
  global.fetch = vi.fn(async () => ({
    ok: true,
    body: {
      getReader: () => ({
        read: async () => ({ done: true, value: undefined }),
      }),
    },
    json: async () => ({}),
  }));

  const hook = renderHook(() =>
    useChats({ apiCall, getToken: async () => "token", isReady: true, setToast })
  );
  return { ...hook, apiCall, setToast };
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("the in-flight lock is always released", () => {
  it("survives a caller-supplied callback that throws", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));

    // onAttachmentConsumed belongs to App.jsx. This hook cannot promise it is
    // safe, so it must not be able to strand the lock.
    const exploding = () => {
      throw new Error("clearing the attachment preview blew up");
    };

    await act(async () => {
      try {
        await result.current.send("first question", "data:image/png;base64,AAAA", exploding);
      } catch {
        // The throw propagating is acceptable. The composer staying dead is not.
      }
    });

    // THE ASSERTION: the user can send again.
    await waitFor(() => expect(result.current.status).not.toBe("loading"));

    const before = global.fetch.mock.calls.length;
    await act(async () => {
      await result.current.send("second question");
    });

    expect(
      global.fetch.mock.calls.length,
      "the second send never reached the network — the in-flight lock was never " +
        "released, so the composer is dead for the rest of the session",
    ).toBeGreaterThan(before);
  });

  it("releases the lock after an ordinary successful send", async () => {
    // The control. If the lock were never taken at all, the test above would
    // pass for the wrong reason and this file would be guarding nothing.
    const { result } = setup();
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));

    await act(async () => {
      await result.current.send("first question");
    });
    await waitFor(() => expect(result.current.status).not.toBe("loading"));

    const before = global.fetch.mock.calls.length;
    await act(async () => {
      await result.current.send("second question");
    });
    expect(global.fetch.mock.calls.length).toBeGreaterThan(before);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useChats } from "../hooks/useChats";

/**
 * A CONVERSATION MUST NEVER BE SAVED OVER WITH A SHORTER ONE.
 *
 * This file is the executable form of a bug that shipped to production, and it
 * is written to fail against the code that shipped it.
 *
 * Moving transcripts out of GET /api/chats created a window that did not exist
 * before: `chat.messages` is `undefined` from the moment a conversation is
 * selected until its transcript arrives. `activeMessages` is
 * `activeChat?.messages || []`, so during that window it is an EMPTY ARRAY that
 * is indistinguishable from a genuinely empty chat.
 *
 * Every write path builds on `activeMessages` and then calls
 * `updateChatMessages`, which PUTs the FULL array — a replace, not an append.
 * So a user who opens a fifty-message conversation and types before the
 * transcript lands persists a two-message array over it. The old messages are
 * not hidden or stale; they are gone from the database.
 *
 * WHY THE EXISTING TESTS DID NOT CATCH IT: they seed chats that already have
 * `messages: []` — the shape the OLD list endpoint returned, where empty always
 * meant empty. Nothing had a chat in the `undefined` state, because until this
 * change no chat could be in it. The test suite encoded the old invariant so
 * faithfully that it could not see the new one break.
 *
 * The assertion here is deliberately about what reaches the SERVER, not about
 * what renders. A guard that merely hides the composer would still fail this if
 * anything else could reach the write path.
 */

/** A PUT that would replace a stored transcript. */
const transcriptWrites = (apiCall) =>
  apiCall.mock.calls
    .filter(([path, opts]) => /^\/api\/chats\/[^/]+$/.test(path) && opts?.method === "PUT")
    .map(([, opts]) => JSON.parse(opts.body).messages)
    .filter(Array.isArray);

/**
 * A user with one existing conversation of `existing` messages.
 *
 * `messages` is deliberately absent from the LIST response — that is the whole
 * point.
 *
 * `transcriptFails` makes GET /api/chats/:id REJECT rather than hang. The first
 * version of this file returned `new Promise(() => {})`, which models a request
 * that never resolves AND never times out — a state production cannot reach,
 * because `useApi` aborts every call at 45 seconds. Testing it produced a test
 * timeout that looked like a hang in the product and was really a hang in the
 * mock. A rejection is what a cold backend actually delivers to this code, and
 * it is the case that matters: the transcript is unknown and the user is
 * typing anyway.
 */
const setup = ({ existing = 50, transcriptFails = true } = {}) => {
  const setToast = vi.fn();
  const stored = Array.from({ length: existing }, (_, i) => ({
    role: i % 2 ? "assistant" : "user",
    content: `old message ${i}`,
    id: `old-${i}`,
  }));

  const apiCall = vi.fn(async (path, options = {}) => {
    if (path === "/api/chats" && !options.method) {
      return {
        ok: true,
        json: async () => ({
          chats: [{ id: "chat-1", title: "An old conversation", pinned: false, favorite: false, updated_at: "2026-01-01T00:00:00Z" }],
          hasMore: false,
        }),
      };
    }
    if (path === "/api/chats/chat-1" && !options.method) {
      // What a cold or failing backend actually delivers: an abort/HTTP error.
      if (transcriptFails) throw new Error("Request timed out after 45s");
      return { ok: true, json: async () => ({ id: "chat-1", messages: stored }) };
    }
    return { ok: true, json: async () => ({}) };
  });

  global.fetch = vi.fn(async () => ({ ok: true, body: null, json: async () => ({}) }));

  const hook = renderHook(() =>
    useChats({ apiCall, getToken: async () => "token", isReady: true, setToast })
  );
  return { ...hook, apiCall, setToast, stored };
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("a transcript that has not loaded is not an empty transcript", () => {
  it("does not persist a short array over a conversation still loading", async () => {
    const { result, apiCall, setToast } = setup();
    await waitFor(() => expect(result.current.chats.length).toBe(1));

    act(() => result.current.setActiveChatId("chat-1"));
    // The transcript fetch fails, so the real transcript stays unknown.
    await waitFor(() => expect(result.current.isLoadingMessages).toBe(false));

    await act(async () => {
      await result.current.send("a new question");
    });

    // THE ASSERTION: nothing may PUT a transcript while the real one is unknown.
    //
    // Written so it CANNOT pass vacuously. A bare `for` over the writes is
    // green when there are no writes at all, which is the same shape as a guard
    // that silently swallows the user's message — and it is indistinguishable
    // from a correct refusal unless the two are asserted separately.
    const written = transcriptWrites(apiCall);
    const truncating = written.filter((w) => w.length <= 2);
    expect(
      truncating,
      `a PUT replaced the stored transcript with ${truncating[0]?.length} message(s) ` +
        `while the real one had not loaded — this is permanent data loss`,
    ).toHaveLength(0);

    // And the refusal has to be VISIBLE. Dropping the message with no write and
    // no word to the user is not a fix, it is a quieter bug.
    expect(
      written.length > 0 || setToast.mock.calls.length > 0,
      "the send neither wrote anything nor told the user why — the message vanished",
    ).toBe(true);
  });

  it("does not rename an existing conversation as though it were new", async () => {
    // The same empty-vs-unloaded confusion drives the title path: a chat whose
    // messages have not arrived looks brand new, so it gets retitled from the
    // first thing the user types over it.
    const { result, apiCall } = setup();
    await waitFor(() => expect(result.current.chats.length).toBe(1));
    act(() => result.current.setActiveChatId("chat-1"));
    await waitFor(() => expect(result.current.isLoadingMessages).toBe(false));

    await act(async () => {
      await result.current.send("a new question");
    });

    const renames = apiCall.mock.calls.filter(
      ([path, opts]) => /^\/api\/chats\/[^/]+$/.test(path) && opts?.method === "PUT" && JSON.parse(opts.body).title,
    );
    expect(renames, "an existing conversation was retitled while its transcript was still loading").toHaveLength(0);
  });
});

describe("the normal path still works", () => {
  it("sends against the full transcript once it has loaded", async () => {
    // The guard against over-correcting. If the fix simply blocks sending, this
    // fails — the product still has to work.
    const { result, apiCall } = setup({ transcriptFails: false });
    await waitFor(() => expect(result.current.chats.length).toBe(1));

    act(() => result.current.setActiveChatId("chat-1"));
    await waitFor(() => expect(result.current.isLoadingMessages).toBe(false));
    await waitFor(() => expect(result.current.activeMessages.length).toBe(50));

    await act(async () => {
      await result.current.send("a new question");
    });

    const writes = transcriptWrites(apiCall);
    expect(writes.length, "sending after the transcript loaded wrote nothing").toBeGreaterThan(0);
    // Appended to, never replaced.
    for (const written of writes) expect(written.length).toBeGreaterThan(50);
  });
});

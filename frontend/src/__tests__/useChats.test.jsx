import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useChats } from "../hooks/useChats";

/**
 * The council streaming loop is the one genuinely intricate piece of the app,
 * and three separate bugs have lived here. The expensive one was the abort
 * path: it returned without resetting status, which left the composer
 * permanently disabled the moment a user-facing Stop button existed.
 */
const sseStream = (frames) => {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (i >= frames.length) return { done: true, value: undefined };
        return { done: false, value: encoder.encode(frames[i++]) };
      },
    }),
  };
};

/**
 * The council requests only, selected by URL rather than by call index.
 *
 * `send()` now issues two fetches on the first message of a chat: the answer,
 * and a one-shot /api/chat-title so the sidebar gets a written name instead of
 * the first six words. Three tests here indexed `fetch.mock.calls[0]` and
 * started reading the title request's body instead of the council's. Selecting
 * by endpoint says what the assertion is actually about and does not break
 * again the next time something else is fired alongside a send.
 */
const councilCalls = (fetchImpl) =>
  fetchImpl.mock.calls.filter(([url]) => String(url).includes("/api/council"));

const setup = ({ fetchImpl } = {}) => {
  const setToast = vi.fn();
  const apiCall = vi.fn(async (path, options = {}) => {
    if (path === "/api/chats" && options.method === "POST") {
      return { ok: true, json: async () => ({ id: "chat-1", title: "New Chat", messages: [] }) };
    }
    if (path === "/api/chats") return { ok: true, json: async () => [] };
    return { ok: true, json: async () => ({}) };
  });

  global.fetch = fetchImpl || vi.fn();

  const hook = renderHook(() => useChats({ apiCall, getToken: async () => "token", isReady: true, setToast }));
  return { ...hook, apiCall, setToast };
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("useChats", () => {
  it("starts idle with no chats and finishes its initial load", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));
    expect(result.current.status).toBe("idle");
    expect(result.current.chats).toEqual([]);
  });

  it("streams chunks into the assistant message and returns to idle", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      body: sseStream([
        'data: {"type":"chunk","text":"Hello"}\n',
        'data: {"type":"chunk","text":" world"}\n',
        "data: [DONE]\n",
      ]),
    }));

    const { result } = setup({ fetchImpl });
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));

    await act(async () => {
      await result.current.send("hi");
    });

    await waitFor(() => expect(result.current.status).toBe("idle"));
    const messages = result.current.chats[0].messages;
    expect(messages[messages.length - 1].content).toBe("Hello world");
  });

  it("skips a malformed frame rather than failing the whole response", async () => {
    // A frame that is not valid JSON is a transport artifact, not a reason to
    // throw away a reply the user is already reading.
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      body: sseStream([
        'data: {"type":"chunk","text":"good"}\n',
        "data: {not json\n",
        'data: {"type":"chunk","text":" more"}\n',
        "data: [DONE]\n",
      ]),
    }));

    const { result } = setup({ fetchImpl });
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));

    await act(async () => {
      await result.current.send("hi");
    });

    await waitFor(() => expect(result.current.status).toBe("idle"));
    const messages = result.current.chats[0].messages;
    expect(messages[messages.length - 1].content).toBe("good more");
  });

  it("surfaces a server error in the transcript and sets error status", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, json: async () => ({ error: "Model unavailable" }) }));

    const { result } = setup({ fetchImpl });
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));

    await act(async () => {
      await result.current.send("hi");
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    const messages = result.current.chats[0].messages;
    expect(messages[messages.length - 1].content).toContain("Model unavailable");
  });

  it("returns to idle after an abort, so the composer is not disabled forever", async () => {
    const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchImpl = vi.fn(async () => {
      throw abortError;
    });

    const { result } = setup({ fetchImpl });
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));

    await act(async () => {
      await result.current.send("hi");
    });

    await waitFor(() => expect(result.current.status).toBe("idle"));
  });

  it("does not blow up when Stop is pressed with nothing running", () => {
    const { result } = setup();
    expect(() => result.current.stopGeneration()).not.toThrow();
  });

  it("ignores an empty message", async () => {
    const fetchImpl = vi.fn();
    const { result } = setup({ fetchImpl });
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));

    await act(async () => {
      await result.current.send("   ");
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("titles a new chat from the first message", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, body: sseStream(["data: [DONE]\n"]) }));
    const { result, apiCall } = setup({ fetchImpl });
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));

    await act(async () => {
      await result.current.send("how do promises work in javascript");
    });

    const renamed = apiCall.mock.calls.find(([, opts]) => opts?.body?.includes("How do promises work"));
    expect(renamed, "the chat was never renamed from its first message").toBeTruthy();
  });

  it("upgrades the six-word title to the written one when it arrives", async () => {
    // Two renames, in order. The local slice lands immediately so the sidebar
    // never shows "New Chat" while a request is in flight; the model-written
    // title replaces it. The first six words of a question are the
    // low-information-scent pattern this endpoint exists to fix.
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes("/api/chat-title")) {
        return { ok: true, json: async () => ({ title: "Promise resolution order" }) };
      }
      return { ok: true, body: sseStream(["data: [DONE]\n"]) };
    });
    const { result, apiCall } = setup({ fetchImpl });
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));

    await act(async () => {
      await result.current.send("how do promises work in javascript");
    });

    await waitFor(() => {
      const written = apiCall.mock.calls.find(([, o]) => o?.body?.includes("Promise resolution order"));
      expect(written, "the written title never replaced the six-word one").toBeTruthy();
    });

    const local = apiCall.mock.calls.findIndex(([, o]) => o?.body?.includes("How do promises work"));
    const written = apiCall.mock.calls.findIndex(([, o]) => o?.body?.includes("Promise resolution order"));
    expect(local, "the instant title must come first").toBeLessThan(written);
  });

  it("keeps the local title when the title endpoint fails or declines", async () => {
    // The endpoint answers 200 with title: null for every failure, so the
    // client has one condition rather than an error path. A chat that already
    // has a usable name must never be renamed to nothing.
    for (const response of [
      { ok: true, json: async () => ({ title: null }) },
      { ok: false, json: async () => ({}) },
    ]) {
      const fetchImpl = vi.fn(async (url) =>
        String(url).includes("/api/chat-title")
          ? response
          : { ok: true, body: sseStream(["data: [DONE]\n"]) },
      );
      const { result, apiCall } = setup({ fetchImpl });
      await waitFor(() => expect(result.current.isInitialLoading).toBe(false));

      await act(async () => {
        await result.current.send("how do promises work in javascript");
      });

      const renames = apiCall.mock.calls.filter(([, o]) => o?.body?.includes("title"));
      expect(renames.some(([, o]) => /"title":\s*null/.test(o.body))).toBe(false);
      expect(
        apiCall.mock.calls.some(([, o]) => o?.body?.includes("How do promises work")),
        "the six-word title should have survived",
      ).toBe(true);
    }
  });

  it("sends only the last few turns as history", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, body: sseStream(["data: [DONE]\n"]) }));
    const { result } = setup({ fetchImpl });
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));

    await act(async () => {
      await result.current.send("first");
    });

    const body = JSON.parse(councilCalls(fetchImpl)[0][1].body);
    expect(Array.isArray(body.history)).toBe(true);
    expect(body.history.length).toBeLessThanOrEqual(8);
  });

  it("attaches the image only when one was supplied", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, body: sseStream(["data: [DONE]\n"]) }));
    const { result } = setup({ fetchImpl });
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));

    await act(async () => {
      await result.current.send("no image");
    });
    expect(JSON.parse(councilCalls(fetchImpl)[0][1].body)).not.toHaveProperty("image");

    await act(async () => {
      await result.current.send("with image", "data:image/jpeg;base64,AAAA");
    });
    expect(JSON.parse(councilCalls(fetchImpl)[1][1].body).image).toBe("data:image/jpeg;base64,AAAA");
  });

  it("replaces the last answer on regenerate instead of appending a second exchange", async () => {
    // The point of regenerate is that the transcript ends up the same length it
    // started: one question, one answer. Re-sending against a stale copy of the
    // messages puts the discarded answer back and duplicates the question.
    const replies = ["first", "second"];
    let call = 0;
    // Branches on the endpoint rather than counting calls. `send()` also fires
    // /api/chat-title on the first message of a chat, and a purely
    // order-dependent mock handed that request "first" — leaving the council
    // with "second" and regenerate with undefined.
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes("/api/chat-title")) {
        return { ok: true, json: async () => ({ title: "A written title" }) };
      }
      return {
        ok: true,
        body: sseStream([`data: {"type":"chunk","text":"${replies[call++]}"}\n`, "data: [DONE]\n"]),
      };
    });

    const { result } = setup({ fetchImpl });
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));

    await act(async () => {
      await result.current.send("hi");
    });
    await waitFor(() => expect(result.current.status).toBe("idle"));

    await act(async () => {
      await result.current.regenerateLast();
    });
    await waitFor(() => expect(result.current.chats[0].messages.at(-1)?.content).toBe("second"));

    const messages = result.current.chats[0].messages;
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[0].content).toBe("hi");
  });

  it("clears the attachment through the callback, not by reaching into the parent", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, body: sseStream(["data: [DONE]\n"]) }));
    const { result } = setup({ fetchImpl });
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));

    const consumed = vi.fn();
    await act(async () => {
      await result.current.send("hi", "data:image/jpeg;base64,AAAA", consumed);
    });

    expect(consumed).toHaveBeenCalled();
  });
});

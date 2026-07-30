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

  it("sends only the last few turns as history", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, body: sseStream(["data: [DONE]\n"]) }));
    const { result } = setup({ fetchImpl });
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));

    await act(async () => {
      await result.current.send("first");
    });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
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
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).not.toHaveProperty("image");

    await act(async () => {
      await result.current.send("with image", "data:image/jpeg;base64,AAAA");
    });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).image).toBe("data:image/jpeg;base64,AAAA");
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

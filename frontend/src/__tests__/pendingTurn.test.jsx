import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useChats } from "../hooks/useChats";
import {
  rememberPendingTurn,
  readPendingTurn,
  clearPendingTurn,
  PENDING_TURN_MAX_AGE_MS,
} from "../lib/pendingTurn";

/**
 * A turn that outlived the tab it was started in.
 *
 * The reconnect logic in useChats covers a dropped socket. It cannot cover the
 * tab going away, because the operation id lives in the closure that went with
 * it — and the user message is already persisted by then, so the user comes
 * back to their own question with nothing under it while the server finishes
 * writing an answer no one will ask for.
 */

const OPERATION_ID = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("the pending-turn record", () => {
  it("comes back for the same user", () => {
    rememberPendingTurn("user_1", { chatId: "chat-1", operationId: OPERATION_ID });
    expect(readPendingTurn("user_1")).toMatchObject({ chatId: "chat-1", operationId: OPERATION_ID });
  });

  it("is a miss for a second account on the same browser", () => {
    rememberPendingTurn("user_1", { chatId: "chat-1", operationId: OPERATION_ID });
    expect(readPendingTurn("user_2")).toBeNull();
  });

  it("expires", () => {
    rememberPendingTurn("user_1", { chatId: "chat-1", operationId: OPERATION_ID });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + PENDING_TURN_MAX_AGE_MS + 1);
    expect(readPendingTurn("user_1")).toBeNull();
  });

  it("holds no message text at all", () => {
    rememberPendingTurn("user_1", { chatId: "chat-1", operationId: OPERATION_ID });
    const raw = Object.keys(localStorage)
      .filter((k) => k.startsWith("alop-pending-turn:"))
      .map((k) => localStorage.getItem(k))
      .join("");
    expect(raw).not.toMatch(/message|answer|content|title/i);
  });

  it("is removed for everyone on sign-out", () => {
    rememberPendingTurn("user_1", { chatId: "chat-1", operationId: OPERATION_ID });
    rememberPendingTurn("user_2", { chatId: "chat-9", operationId: OPERATION_ID });
    clearPendingTurn();
    expect(readPendingTurn("user_1")).toBeNull();
    expect(readPendingTurn("user_2")).toBeNull();
  });
});

/**
 * @param turnResponses  successive bodies for GET /api/turns/:id
 */
const mountWithPendingTurn = ({
  turnResponses = [{ state: "complete", answer: "The recovered answer.", complete: true }],
  storedMessages = [{ role: "user", content: "the question", id: "m1" }],
  userId = "user_1",
} = {}) => {
  const puts = [];
  let turnCall = 0;
  const apiCall = vi.fn(async (path, options = {}) => {
    if (path === "/api/chats" && !options.method) {
      return { ok: true, json: async () => [{ id: "chat-1", title: "Chat", updated_at: "2026-01-01T00:00:00.000Z" }] };
    }
    if (path.startsWith("/api/turns/")) {
      const body = turnResponses[Math.min(turnCall++, turnResponses.length - 1)];
      if (body?.status) return { ok: false, status: body.status, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    }
    if (path === "/api/chats/chat-1" && options.method === "PUT") {
      puts.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ updated_at: "2026-01-01T00:00:01.000Z" }) };
    }
    if (path === "/api/chats/chat-1") {
      return {
        ok: true,
        json: async () => ({ id: "chat-1", messages: storedMessages, updated_at: "2026-01-01T00:00:00.000Z" }),
      };
    }
    return { ok: true, json: async () => ({}) };
  });

  global.fetch = vi.fn();
  const hook = renderHook(() =>
    useChats({ apiCall, getToken: async () => "token", isReady: true, setToast: vi.fn(), userId })
  );
  return { ...hook, apiCall, puts };
};

describe("recovering an interrupted turn on reload", () => {
  it("appends the answer the server finished writing while the tab was gone", async () => {
    rememberPendingTurn("user_1", { chatId: "chat-1", operationId: OPERATION_ID });
    const { puts } = mountWithPendingTurn();

    await waitFor(() => expect(puts.length).toBe(1));
    const saved = puts[0].messages;
    expect(saved).toHaveLength(2);
    expect(saved[1]).toMatchObject({ role: "assistant", content: "The recovered answer.", recovered: true });
    // Recovered once, and the record is gone so the next reload does not repeat it.
    expect(readPendingTurn("user_1")).toBeNull();
  });

  it("does not append a second copy when the transcript already ends in an answer", async () => {
    rememberPendingTurn("user_1", { chatId: "chat-1", operationId: OPERATION_ID });
    const { puts, apiCall } = mountWithPendingTurn({
      storedMessages: [
        { role: "user", content: "the question", id: "m1" },
        { role: "assistant", content: "already saved", id: "m2" },
      ],
    });

    await waitFor(() => expect(apiCall.mock.calls.some(([p]) => p.startsWith("/api/turns/"))).toBe(true));
    await waitFor(() => expect(readPendingTurn("user_1")).toBeNull());
    expect(puts).toHaveLength(0);
  });

  it("forgets a turn the ledger has never heard of", async () => {
    rememberPendingTurn("user_1", { chatId: "chat-1", operationId: OPERATION_ID });
    const { puts } = mountWithPendingTurn({ turnResponses: [{ status: 404 }] });

    await waitFor(() => expect(readPendingTurn("user_1")).toBeNull());
    expect(puts).toHaveLength(0);
  });

  it("keeps the record when the request itself fails, so the next reload retries", async () => {
    rememberPendingTurn("user_1", { chatId: "chat-1", operationId: OPERATION_ID });
    const { puts } = mountWithPendingTurn({ turnResponses: [{ status: 500 }] });

    await waitFor(() => expect(puts).toHaveLength(0));
    expect(readPendingTurn("user_1")).not.toBeNull();
  });

  it("does nothing at all when there is no interrupted turn", async () => {
    const { apiCall } = mountWithPendingTurn();
    await waitFor(() => expect(apiCall).toHaveBeenCalled());
    expect(apiCall.mock.calls.some(([path]) => path.startsWith("/api/turns/"))).toBe(false);
  });

  it("waits for a turn that is still being written", async () => {
    rememberPendingTurn("user_1", { chatId: "chat-1", operationId: OPERATION_ID });
    const { puts } = mountWithPendingTurn({
      turnResponses: [
        { state: "running", answer: "half an ans", complete: false },
        { state: "complete", answer: "the whole answer", complete: true },
      ],
    });

    await waitFor(() => expect(puts.length).toBe(1), { timeout: 5000 });
    // The partial was never persisted; only the complete one.
    expect(puts[0].messages[1].content).toBe("the whole answer");
  });
});

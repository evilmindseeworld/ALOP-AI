import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { readChats, writeChats, clearChats, CACHE_PREFIX, CACHE_MAX_AGE_MS } from "../lib/chatCache";

/* The sidebar cache.
 *
 * Half of these are about speed and half are about not showing one person's
 * conversation titles to another. The second half is the reason this file
 * exists: a cache of user data in shared browser storage is a way to leak it,
 * and every rule that stops that has to be a test rather than a comment.
 */

const CHATS = [
  { id: "a", title: "Monitors under 500", pinned: true, favorite: false, updated_at: "2026-08-01T00:00:00Z" },
  { id: "b", title: "Fly vs Render", pinned: false, favorite: true, updated_at: "2026-08-02T00:00:00Z" },
];

beforeEach(() => {
  localStorage.clear();
});

describe("what is stored", () => {
  it("round-trips the fields the sidebar draws", () => {
    writeChats("user_1", CHATS);
    const back = readChats("user_1");
    expect(back).toHaveLength(2);
    expect(back[0].title).toBe("Monitors under 500");
    expect(back[0].pinned).toBe(true);
    expect(back[1].favorite).toBe(true);
  });

  it("NEVER stores messages, whatever the caller passes", () => {
    // The one rule that matters most. Transcripts are the sensitive part of
    // this product and they are lazy-loaded per conversation anyway.
    writeChats("user_1", [{ ...CHATS[0], messages: [{ role: "user", content: "my bank details" }] }]);
    const raw = localStorage.getItem(`${CACHE_PREFIX}user_1`);
    expect(raw).not.toContain("bank details");
    expect(raw).not.toContain("messages");
  });

  it("drops unknown fields rather than persisting them", () => {
    // An allowlist, so a new column on the server cannot start being written
    // here by accident.
    writeChats("user_1", [{ ...CHATS[0], secret_note: "internal", user_email: "a@b.com" }]);
    const raw = localStorage.getItem(`${CACHE_PREFIX}user_1`);
    expect(raw).not.toContain("internal");
    expect(raw).not.toContain("a@b.com");
  });

  it("marks restored rows as needing their transcript fetched", () => {
    // `messages: undefined` is the "not loaded" marker the transcript loader
    // keys on. A cached row that looked loaded would render as an empty chat.
    writeChats("user_1", CHATS);
    for (const chat of readChats("user_1")) {
      expect(chat.messages).toBeUndefined();
      expect(chat.fromCache).toBe(true);
    }
  });
});

describe("whose data it is", () => {
  it("does not hand one user's chats to another", () => {
    writeChats("user_1", CHATS);
    expect(readChats("user_2")).toBeNull();
  });

  it("does not read a cache whose stored id disagrees with the key", () => {
    // Belt and braces against a hand-edited or half-migrated entry: the id is
    // checked against the payload, not only against the key it was found under.
    localStorage.setItem(
      `${CACHE_PREFIX}user_1`,
      JSON.stringify({ userId: "user_2", at: Date.now(), chats: CHATS })
    );
    expect(readChats("user_1")).toBeNull();
  });

  it("clears every user's cache when signing out, not only the current one", () => {
    // Sign-out is called with no id on purpose: a previous account's entry may
    // still be sitting there, and "signed out of this browser" has to mean the
    // browser is holding nobody's sidebar.
    writeChats("user_1", CHATS);
    writeChats("user_2", CHATS);
    clearChats();
    expect(readChats("user_1")).toBeNull();
    expect(readChats("user_2")).toBeNull();
  });

  it("leaves unrelated keys alone when clearing", () => {
    localStorage.setItem("alop-dark-mode", "false");
    writeChats("user_1", CHATS);
    clearChats();
    expect(localStorage.getItem("alop-dark-mode")).toBe("false");
  });

  it("returns nothing without a user id", () => {
    writeChats("user_1", CHATS);
    expect(readChats(undefined)).toBeNull();
    expect(readChats(null)).toBeNull();
  });
});

describe("when it goes stale", () => {
  afterEach(() => vi.useRealTimers());

  it("ignores a cache older than the maximum age", () => {
    writeChats("user_1", CHATS);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + CACHE_MAX_AGE_MS + 1000);
    expect(readChats("user_1")).toBeNull();
  });

  it("still serves one inside the window", () => {
    writeChats("user_1", CHATS);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + CACHE_MAX_AGE_MS / 2);
    expect(readChats("user_1")).toHaveLength(2);
  });
});

describe("when the data is not what was expected", () => {
  it("treats corrupt JSON as a miss rather than throwing", () => {
    localStorage.setItem(`${CACHE_PREFIX}user_1`, "{not json");
    expect(() => readChats("user_1")).not.toThrow();
    expect(readChats("user_1")).toBeNull();
  });

  it("removes the entry when the last chat is deleted", () => {
    // Storing [] would read back as a hit and paint an empty sidebar over a
    // list the server is about to send.
    writeChats("user_1", CHATS);
    writeChats("user_1", []);
    expect(localStorage.getItem(`${CACHE_PREFIX}user_1`)).toBeNull();
  });

  it("skips rows with no id", () => {
    writeChats("user_1", [{ title: "orphan" }, CHATS[0]]);
    expect(readChats("user_1")).toHaveLength(1);
  });

  it("survives a non-array", () => {
    expect(() => writeChats("user_1", null)).not.toThrow();
    expect(readChats("user_1")).toBeNull();
  });

  it("caps how many rows it writes", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ id: `c${i}`, title: `Chat ${i}` }));
    writeChats("user_1", many);
    expect(readChats("user_1").length).toBeLessThanOrEqual(60);
  });
});

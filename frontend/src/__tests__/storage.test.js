import { describe, it, expect, vi, afterEach } from "vitest";
import { Storage } from "../lib/storage";

/**
 * jsdom here provides no localStorage at all — `localStorage.getItem` throws
 * TypeError rather than returning null. src/test/setup.js installs an
 * in-memory one so the happy path is testable; these swap it for a hostile
 * implementation to exercise the failure paths.
 */
const withLocalStorage = (impl) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { value: impl, configurable: true, writable: true });
  return () => Object.defineProperty(globalThis, "localStorage", original);
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Storage", () => {
  it("reads and writes through to localStorage", () => {
    Storage.set("alop-test", "hello");
    expect(Storage.get("alop-test")).toBe("hello");
  });

  it("returns null for a key that was never set", () => {
    expect(Storage.get("alop-never-set")).toBeNull();
  });

  it("returns null instead of throwing when reading is blocked", () => {
    // Some embedded webviews throw on localStorage access itself. A preference
    // that cannot be read is not a reason to fail a render.
    const restore = withLocalStorage({
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
    });
    try {
      expect(Storage.get("anything")).toBeNull();
    } finally {
      restore();
    }
  });

  it("swallows a failed write rather than propagating it", () => {
    // Safari private browsing and a full quota both reject setItem. The user
    // loses the preference, not the app.
    const restore = withLocalStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    try {
      expect(() => Storage.set("k", "v")).not.toThrow();
    } finally {
      restore();
    }
  });
});

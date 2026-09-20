import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";


// jsdom implements no layout, so it ships no scrollIntoView at all — calling it
// throws rather than no-opping. The command palette uses it to keep the
// keyboard cursor visible. Stubbing it here keeps the guard out of production
// code, where the method genuinely does exist.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// Same story for scrollTo, used by the jump-to-latest button.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {};
}

/* anime.js reads browser geometry APIs absent from jsdom; simple shims let it mount. */
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof globalThis.matchMedia !== "function") {
  globalThis.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
}

if (typeof globalThis.DOMMatrix === "undefined") {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor() {
      this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
      this.m41 = 0; this.m42 = 0;
    }
    inverse() { return new DOMMatrix(); }
    translate() { return new DOMMatrix(); }
  };
}

if (typeof globalThis.DOMPoint === "undefined") {
  globalThis.DOMPoint = class DOMPoint {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; this.z = 0; this.w = 1; }
    matrixTransform() { return new DOMPoint(this.x, this.y); }
  };
}

// localStorage is absent in this jsdom setup — not merely empty, undefined, so
// `localStorage.getItem` throws TypeError. The app stores the theme and the
// sidebar state there. src/lib/storage.js already swallows that, which is why
// nothing failed, but it means every persistence test would silently assert
// the failure path. An in-memory implementation makes the happy path testable.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
      setItem: (k, v) => store.set(String(k), String(v)),
      removeItem: (k) => store.delete(String(k)),
      clear: () => store.clear(),
      key: (i) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

/* AND IT IS CLEARED BEFORE EVERY TEST, which is not belt-and-braces.
 *
 * vitest runs several test FILES in one worker, and this setup file's guard
 * above only installs the shim when `globalThis.localStorage` is undefined — so
 * the second file in a worker inherits the FIRST file's Map, rows and all.
 * That is how `useChats.test.jsx` came to read a `chat-1` row it never wrote:
 * `deleteChat("doomed")` found no such chat and returned early, and the whole
 * suite failed only when run together and passed when run alone. Any
 * localStorage-backed cache (chatCache, the theme, the sidebar state) can do
 * the same to any file that runs after it. */
beforeEach(() => {
  try {
    globalThis.localStorage?.clear();
  } catch {
    /* A test may have replaced localStorage with its own stub. Not ours to fix. */
  }
});

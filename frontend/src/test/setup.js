import "@testing-library/jest-dom/vitest";


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

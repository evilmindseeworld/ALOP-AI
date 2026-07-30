/**
 * localStorage that cannot throw.
 *
 * Reads and writes fail for reasons that have nothing to do with this app:
 * Safari private browsing rejects writes, a full quota rejects writes, and
 * some embedded webviews throw on access itself. None of those are worth
 * losing a render over — a preference that fails to persist is a much smaller
 * problem than a blank screen.
 */
export const Storage = {
  get: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* preference not persisted; the app still works */
    }
  },
};

export default Storage;

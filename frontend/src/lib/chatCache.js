import { Storage } from "./storage";

/**
 * The sidebar, remembered between visits.
 *
 * Every reload showed the full app skeleton until /api/chats came back, and on
 * a cold backend that is twenty seconds of a shimmering placeholder for a list
 * the browser had already been told twice that day. The list is metadata that
 * changes when the user changes it, which is the exact shape that wants
 * stale-while-revalidate: paint what was there last time, immediately, then
 * correct it from the server without anyone watching a loading state.
 *
 * WHAT IS DELIBERATELY NOT CACHED: messages. Not one. They are the sensitive
 * part of this product, they are what makes a chat row grow to megabytes, and
 * they are already lazy-loaded per conversation. Only the fields the sidebar
 * draws are written, and `pick` is an allowlist rather than a delete-list so a
 * new column on the server cannot start being persisted by accident.
 *
 * THE THREE RULES THIS HAS TO OBEY, because a cache of one person's data in
 * shared browser storage is a way to show it to someone else:
 *
 *   1. Keyed by user id, and read back only for the SAME id. A second account
 *      on the same browser gets a miss, not the first account's sidebar.
 *   2. Cleared on sign-out. Signing out on a shared machine has to actually
 *      remove it, not merely stop reading it.
 *   3. Expired by age. A list from a month ago is not worth painting and is one
 *      more copy of someone's data sitting around for no benefit.
 */

const PREFIX = "alop-chats:";

/**
 * A week. Long enough that a returning user still gets an instant sidebar,
 * short enough that an abandoned browser is not holding a list indefinitely.
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Cap on rows written. The sidebar is paginated, so this only has to cover what
 * is painted before the server answers; the rest arrives with the revalidation.
 */
const MAX_ROWS = 60;

/** Allowlist. Anything not named here never reaches storage. */
const pick = (chat) => ({
  id: chat.id,
  title: chat.title,
  pinned: Boolean(chat.pinned),
  favorite: Boolean(chat.favorite),
  created_at: chat.created_at,
  updated_at: chat.updated_at,
});

const keyFor = (userId) => `${PREFIX}${userId}`;

/**
 * Whatever was listed last time, or null.
 *
 * Rows come back tagged `fromCache`, which the merge in useChats needs: a
 * cached row the server no longer lists has been deleted elsewhere and must
 * disappear, whereas an untagged local row is one this tab just created and
 * must survive. Without the tag those two are indistinguishable and deleted
 * conversations come back from the dead on every reload.
 */
export function readChats(userId) {
  if (!userId) return null;
  try {
    const raw = Storage.get(keyFor(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.userId !== userId) return null;
    if (!Array.isArray(parsed.chats) || parsed.chats.length === 0) return null;
    if (!(Date.now() - parsed.at < MAX_AGE_MS)) return null;
    // `messages: undefined` is the "not fetched" marker the transcript loader
    // keys on, so a hydrated row takes the normal lazy-load path the first time
    // it is opened. Spelt out rather than left off, because it is load-bearing.
    return parsed.chats.map((chat) => ({ ...chat, messages: undefined, fromCache: true }));
  } catch {
    // Corrupt or half-written. A miss is always safe here.
    return null;
  }
}

export function writeChats(userId, chats) {
  if (!userId || !Array.isArray(chats)) return;
  const rows = chats.filter((chat) => chat?.id).slice(0, MAX_ROWS).map(pick);
  if (rows.length === 0) {
    // An empty list is a real state, but writing it would mean a user who
    // deletes their last chat gets a stored empty array that reads as a hit.
    // Dropping the entry is the same outcome with less to go wrong.
    clearChats(userId);
    return;
  }
  Storage.set(keyFor(userId), JSON.stringify({ userId, at: Date.now(), chats: rows }));
}

/**
 * Remove one user's cache, or everyone's.
 *
 * Sign-out calls it with no argument on purpose. The signing-out user's id is
 * available at that moment, but a previous account's entry may still be sitting
 * there from before, and "signed out of this browser" should mean the browser
 * is not holding anybody's sidebar.
 */
export function clearChats(userId) {
  try {
    if (userId) {
      localStorage.removeItem(keyFor(userId));
      return;
    }
    /* localStorage.key(i), not Object.keys(localStorage).
     *
     * The property form works in browsers and silently clears nothing under
     * jsdom, which is how this was caught: a sign-out that appeared to wipe the
     * cache and did not. The indexed API is the specified one and works
     * everywhere. Backwards, because removing an entry reindexes the rest and a
     * forward loop would skip every other key. */
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    /* storage unavailable; nothing was written either */
  }
}

export const CACHE_PREFIX = PREFIX;
export const CACHE_MAX_AGE_MS = MAX_AGE_MS;

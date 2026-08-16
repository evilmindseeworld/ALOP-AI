import { Storage } from "./storage";

/**
 * The turn that was in flight when the tab went away.
 *
 * The reconnect logic in `useChats` survives a dropped socket, an offline
 * window and a failed read, because all of it lives in one closure that holds
 * the operation id. Nothing survives the tab CLOSING. Reload during a council
 * run — or let iOS discard the tab, which it does to a backgrounded page after
 * a couple of minutes — and the id is gone, while the server keeps writing the
 * answer to the turn ledger nobody will ever ask for. The user message is
 * already persisted at that point, so what they come back to is their own
 * question with silence under it, and the only recovery is asking again and
 * paying for the same answer twice.
 *
 * This is the id, written where a reload can find it.
 *
 * WHAT IS DELIBERATELY NOT WRITTEN: the question, the partial answer, the
 * title — no message content of any kind. The id is a correlation handle; the
 * text is fetched back from the server over an authenticated request, which is
 * the same rule `chatCache.js` follows and for the same reason.
 *
 * The three rules are that file's, unchanged: keyed by user id and read back
 * only for the same id, cleared on sign-out, expired by age.
 */

const PREFIX = "alop-pending-turn:";

/**
 * Fifteen minutes. A turn that has not finished by then is not going to, and a
 * stale id would make the next reload spend a request finding that out. The
 * backend's own resume window is a minute of polling per attempt, so this is
 * already generous against it.
 */
const MAX_AGE_MS = 15 * 60 * 1000;

const keyFor = (userId) => `${PREFIX}${userId}`;

/** Called as a turn starts, before the POST that the reload might interrupt. */
export function rememberPendingTurn(userId, { chatId, operationId }) {
  if (!userId || !chatId || !operationId) return;
  Storage.set(keyFor(userId), JSON.stringify({ userId, chatId, operationId, at: Date.now() }));
}

/** The interrupted turn, or null. Any doubt at all returns null. */
export function readPendingTurn(userId) {
  if (!userId) return null;
  try {
    const raw = Storage.get(keyFor(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.userId !== userId) return null;
    if (!parsed.chatId || !parsed.operationId) return null;
    if (!(Date.now() - parsed.at < MAX_AGE_MS)) return null;
    return { chatId: parsed.chatId, operationId: parsed.operationId, at: parsed.at };
  } catch {
    // Corrupt or half-written. A miss is always safe here.
    return null;
  }
}

/**
 * Remove one user's record, or everyone's.
 *
 * Sign-out calls it with no argument, exactly as `clearChats` does: another
 * account's id may still be sitting there from before, and "signed out of this
 * browser" has to mean the browser is not holding anybody's.
 */
export function clearPendingTurn(userId) {
  try {
    if (userId) {
      localStorage.removeItem(keyFor(userId));
      return;
    }
    /* Indexed API, backwards. `Object.keys(localStorage)` silently clears
     * nothing under jsdom — see the same loop in chatCache.js. */
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    /* storage unavailable; nothing was written either */
  }
}

export const PENDING_TURN_PREFIX = PREFIX;
export const PENDING_TURN_MAX_AGE_MS = MAX_AGE_MS;

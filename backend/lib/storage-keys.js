'use strict';

/**
 * THE ADDRESS OF AN ORIGINAL UPLOAD, AND WHY IT IS COMPUTED RATHER THAN STORED.
 *
 * Migration 003 refused a bucket, and the reason was not taste:
 *
 *   > A bucket would reintroduce a key namespace to get wrong ... there is no
 *   > path to traverse because there is no path, and ownership is a predicate
 *   > rather than a convention.
 *
 * 028 adds a bucket anyway — for ONE reason, that the original bytes of an
 * upload are discarded today and the person who uploaded them can never get
 * their file back — and this module is what keeps 003's property true while it
 * does. Every rule here exists to make the key un-influenceable:
 *
 *   THREE UUIDS AND NOTHING ELSE. `{userId}/{chatId}/{fileId}`. Each is checked
 *   against a hex-only pattern before it is joined, so `/`, `.`, `..`, a null
 *   byte, a backslash, a percent-escape and every other separator are rejected
 *   by the shape of a UUID rather than by a blocklist. A blocklist is a list of
 *   the traversals someone thought of.
 *
 *   THE FILENAME IS NOT IN THE KEY. It is the one part of an upload the user
 *   fully controls, and `../../secrets.pdf` is a filename. It stays in
 *   `chat_files.name`, where it is data, and is used for the download's
 *   `Content-Disposition` only after being quoted.
 *
 *   NOTHING IS SERVED BY KEY. `keyFor` is called only after a row has already
 *   been resolved by `WHERE id = $1 AND user_id = $2 AND chat_id = $3`. The key
 *   is derived FROM the authorised row; it is never the thing that authorises.
 *
 * The reverse direction (`ownerOf`) exists so the sweeper and any future
 * reconciliation can answer "whose object is this?" from the key alone, without
 * trusting a stored value that could have been written before a bug was fixed.
 */

/** The private bucket 028 creates. Not configurable: it is in the migration. */
const BUCKET = 'chat-files';

/**
 * Hex-only, anchored, exact lengths. Deliberately NOT version-checked — every
 * id here comes from `gen_random_uuid()`, and pinning the version nibble would
 * reject a perfectly good id from some other generator later for no security
 * gain. The property that matters is that a matching string contains nothing
 * but hex digits and hyphens, so it cannot be a path.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (value) => typeof value === 'string' && UUID.test(value);

class UnsafeKey extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsafeKey';
  }
}

/**
 * The object key for one file.
 *
 * THROWS rather than returning null. A caller that gets null tends to carry on
 * with an undefined in a template and write `undefined/undefined/x`; a caller
 * that gets an exception cannot. There is no legitimate path where these three
 * values are not UUIDs the server just read out of its own database.
 *
 * @param {{userId: string, chatId: string, fileId: string}} row
 * @returns {string} `{userId}/{chatId}/{fileId}`
 */
function keyFor({ userId, chatId, fileId } = {}) {
  for (const [label, value] of [['userId', userId], ['chatId', chatId], ['fileId', fileId]]) {
    if (!isUuid(value)) throw new UnsafeKey(`${label} is not a UUID; refusing to build a storage key from it`);
  }
  return `${userId}/${chatId}/${fileId}`;
}

/**
 * Whose object is this, according to the key itself?
 *
 * Returns null for anything that is not exactly three UUID segments — a key
 * with a fourth segment, a leading slash, or a segment that is not a UUID is
 * not a key this module produced, and the only safe reading of it is "unknown".
 *
 * @param {string} key
 * @returns {string|null} the owning user id
 */
function ownerOf(key) {
  if (typeof key !== 'string') return null;
  const parts = key.split('/');
  if (parts.length !== 3) return null;
  if (!parts.every(isUuid)) return null;
  return parts[0];
}

/**
 * Does this key belong to this user?
 *
 * Used by the sweeper, which deletes objects on the strength of a table row.
 * That row was written by a trigger from a column, and a column is a value
 * someone could in principle have written; checking the key's own first segment
 * costs nothing and does not depend on that history.
 */
const belongsTo = (key, userId) => isUuid(userId) && ownerOf(key) === userId;

module.exports = { BUCKET, UUID, isUuid, keyFor, ownerOf, belongsTo, UnsafeKey };

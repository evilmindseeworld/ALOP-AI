'use strict';

// Extracted from server.js so these rules can be tested directly. server.js
// exits the process at import time when required env vars are absent, which
// makes it untestable by construction — anything worth asserting on has to
// live outside it.

const sanitizeString = (str, max = 200) =>
  typeof str === 'string' ? str.trim().slice(0, max) : '';

const MAX_CHAT_MESSAGES = 200;
const MAX_MESSAGE_CONTENT = 100000;

/**
 * A message id is the only stable identity the browser gives us. It is not
 * enough for prefix comparison, though: a streaming assistant message keeps
 * its id while its content grows. Prefix checks therefore compare persisted
 * fields, while the fallback merge treats an id collision as "already seen".
 *
 * That distinction matters for old clients. They send a whole transcript with
 * no version token. If one of those transcripts is stale, we may append a new
 * id, but we must never let its shorter or older copy replace what is in the
 * database.
 */
const sameMessage = (a, b) => {
  if (!a || !b) return false;
  return (
    a.role === b.role &&
    a.content === b.content &&
    a.ts === b.ts &&
    a.id === b.id &&
    a.imageUrl === b.imageUrl &&
    a.imagePrompt === b.imagePrompt &&
    Boolean(a.hasImage) === Boolean(b.hasImage)
  );
};

const sameMessageIdentity = (a, b) => {
  if (!a || !b) return false;
  if (a.id !== undefined && a.id !== null && b.id !== undefined && b.id !== null) {
    return String(a.id) === String(b.id);
  }
  return sameMessage(a, b);
};

const startsWithMessages = (messages, prefix) =>
  messages.length >= prefix.length && prefix.every((message, i) => sameMessage(messages[i], message));

/**
 * Merge a transcript from a client that predates compare-and-set writes.
 *
 * This is deliberately conservative. A stale client can still save a new
 * message by appending ids the server has not seen, but it cannot delete an
 * existing message, restore an old assistant answer, or push the transcript
 * past its storage ceiling. New clients send an expected `updated_at` and use
 * exact replacement; this function is only the safe compatibility path.
 */
const mergeMessages = (existing, incoming) => {
  const current = Array.isArray(existing) ? existing : [];
  const next = Array.isArray(incoming) ? incoming : [];

  if (startsWithMessages(next, current)) {
    return next.length <= MAX_CHAT_MESSAGES
      ? { messages: next }
      : { error: `Maximum ${MAX_CHAT_MESSAGES} messages` };
  }

  // A stale request that is only a prefix must never truncate the stored copy.
  if (startsWithMessages(current, next)) return { messages: current };

  const merged = [...current];
  for (const message of next) {
    if (!merged.some((stored) => sameMessageIdentity(stored, message))) merged.push(message);
  }

  return merged.length <= MAX_CHAT_MESSAGES
    ? { messages: merged }
    : { error: `Maximum ${MAX_CHAT_MESSAGES} messages` };
};

const sanitizeMessages = (messages) => {
  if (!Array.isArray(messages)) return { error: 'Must be array' };
  // Truncating a transcript silently is permanent data loss. Rejecting the
  // write leaves the database untouched and gives the caller a chance to
  // reload or use a future paged transcript API instead.
  if (messages.length > MAX_CHAT_MESSAGES) return { error: `Maximum ${MAX_CHAT_MESSAGES} messages` };

  const sanitized = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return { error: 'Invalid message' };
    if (typeof m.content === 'string' && m.content.length > MAX_MESSAGE_CONTENT) {
      // The old slice() kept a plausible-looking but incomplete message. A
      // rejected write is noisy, but it cannot make a user's answer vanish.
      return { error: `Message content exceeds ${MAX_MESSAGE_CONTENT} characters` };
    }
    sanitized.push({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : '',
      ts: m.ts,
      id: m.id,
      ...(typeof m.imageUrl === 'string' ? { imageUrl: m.imageUrl.slice(0, 2000) } : {}),
      ...(typeof m.imagePrompt === 'string' ? { imagePrompt: m.imagePrompt.slice(0, 1000) } : {}),
      // The attachment itself is deliberately not persisted: a data URL runs to
      // megabytes and a row holds up to 200 messages. The flag is enough to
      // render "image attached" after a reload.
      ...(m.hasImage ? { hasImage: true } : {}),
    });
  }
  return { messages: sanitized };
};

// Builds the Supabase update payload for PUT /api/chats/:id.
// Returns { payload } on success or { error } for a 400.
// Strict by design: only whitelisted fields ever reach the database.
const buildChatUpdate = (body) => {
  const { messages, title, pinned, favorite } = body || {};
  const payload = {};

  if (title !== undefined) payload.title = sanitizeString(title, 120);
  if (pinned !== undefined) payload.pinned = Boolean(pinned);
  if (favorite !== undefined) payload.favorite = Boolean(favorite);

  if (messages !== undefined) {
    const result = sanitizeMessages(messages);
    if (result.error) return result;
    payload.messages = result.messages;
    // Only a new message counts as activity. Pinning must not touch this — the
    // sidebar sorts on updated_at, so bumping it here would yank a chat to the
    // top of the list purely for being pinned.
    payload.updated_at = new Date().toISOString();
  }

  return { payload };
};

module.exports = { buildChatUpdate, mergeMessages, sanitizeString, MAX_CHAT_MESSAGES };

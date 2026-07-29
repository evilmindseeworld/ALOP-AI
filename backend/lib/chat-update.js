'use strict';

// Extracted from server.js so these rules can be tested directly. server.js
// exits the process at import time when required env vars are absent, which
// makes it untestable by construction — anything worth asserting on has to
// live outside it.

const sanitizeString = (str, max = 200) =>
  typeof str === 'string' ? str.trim().slice(0, max) : '';

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
    if (!Array.isArray(messages)) return { error: 'Must be array' };
    payload.messages = messages.slice(0, 200).map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content.slice(0, 100000) : '',
      ts: m.ts,
      id: m.id,
      ...(typeof m.imageUrl === 'string' ? { imageUrl: m.imageUrl.slice(0, 2000) } : {}),
      ...(typeof m.imagePrompt === 'string' ? { imagePrompt: m.imagePrompt.slice(0, 1000) } : {}),
      // The attachment itself is deliberately not persisted: a data URL runs to
      // megabytes and a row holds up to 200 messages. The flag is enough to
      // render "image attached" after a reload.
      ...(m.hasImage ? { hasImage: true } : {}),
    }));
    // Only a new message counts as activity. Pinning must not touch this — the
    // sidebar sorts on updated_at, so bumping it here would yank a chat to the
    // top of the list purely for being pinned.
    payload.updated_at = new Date().toISOString();
  }

  return { payload };
};

module.exports = { buildChatUpdate, sanitizeString };

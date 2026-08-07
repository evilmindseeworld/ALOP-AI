"use strict";

const API_CACHE_CONTROL = "no-store";

/**
 * Mark a response as uncacheable by every intermediary.
 *
 * WHY `no-store`, NOT `no-cache`. Authenticated API responses contain a user's
 * chats, files, plan, and sometimes model output. `no-cache` still permits a
 * shared proxy to store that body and ask the origin before reuse; `no-store`
 * forbids retaining it at all. There is no safe public GET under /api today,
 * so the conservative policy belongs at the API boundary rather than at a
 * growing list of handlers where the next route can forget it.
 */
function setNoStore(res) {
  res.setHeader("Cache-Control", API_CACHE_CONTROL);
  return res;
}

/** Express middleware mounted at /api, before any API handler. */
function noStoreApi(_req, res, next) {
  setNoStore(res);
  next();
}

module.exports = { API_CACHE_CONTROL, setNoStore, noStoreApi };

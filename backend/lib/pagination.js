"use strict";

/**
 * Parse one offset page at the API boundary.
 *
 * WHY THIS LIVES HERE. Express query strings are attacker-controlled strings,
 * and Supabase's range() is not a safety boundary: a caller can ask it for a
 * million rows or a negative start unless the server clamps both values first.
 * Keeping the clamp in a tiny, dependency-free module gives every bounded
 * admin list the same limits and makes the dangerous cases testable without
 * importing server.js (which exits when its production environment is absent).
 */
function boundedPage(query = {}, { defaultLimit = 50, maxLimit = 100, maxOffset = 10000 } = {}) {
  const parsedLimit = Number.parseInt(query.limit, 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), maxLimit)
    : defaultLimit;

  const parsedOffset = Number.parseInt(query.offset, 10);
  const offset = Number.isFinite(parsedOffset)
    ? Math.min(Math.max(parsedOffset, 0), maxOffset)
    : 0;

  return { limit, offset };
}

/**
 * Return pagination metadata without issuing a second count query.
 *
 * A full page can mean more rows, but only while the next bounded offset is
 * still reachable. Counting every user or chat would scan the same table the
 * page just read and would make an admin screen pay twice for a fact it does
 * not need.
 */
function pageInfo(rows, { limit, offset }, maxOffset = 10000) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    hasMore: list.length === limit && offset + limit <= maxOffset,
    limit,
    offset,
  };
}

module.exports = { boundedPage, pageInfo };

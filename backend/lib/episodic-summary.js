'use strict';

/**
 * A CONVERSATION THAT CAN BE SEARCHED, NOT ONE THAT IS MERELY COMPRESSED.
 *
 * `chats.conversation_summary` is one 2000-character string per chat, rewritten
 * in place on every turn. Two consequences, and the second is the one users
 * notice:
 *
 *   A LONG CONVERSATION FORGETS ITS OWN BEGINNING. The summary is rewritten to
 *   fit, so turn 3 survives only as far as it still fits beside turn 60.
 *
 *   THERE IS NO GRANULARITY BUT "EVERYTHING". "What did we decide about the
 *   pricing page" can only be answered from a summary of the whole chat, which
 *   by then mentions the pricing page in half a clause, if at all.
 *
 * THE SHAPE. Level 0 summarises a window of raw turns. Level 1 summarises a run
 * of level 0s, level 2 a run of level 1s. Retrieval takes the highest level
 * that covers the conversation and drills into the lower levels only where the
 * question lands, which is what makes an old conversation searchable rather
 * than merely small.
 *
 * WHAT IS NOT HERE. No model call, no database, no prompt. This decides WHICH
 * spans need summarising and WHICH summaries answer a question; the summariser
 * job does the work and stores it. That split is what lets the roll-up rules be
 * tested without a provider — the same reason `router.js` is a separate file.
 */

/** Turns per level-0 window. */
const WINDOW = 6;
/** Lower-level summaries per roll-up. */
const FANOUT = 4;
/** Above this the hierarchy stops growing; a chat is not a corpus. */
const MAX_LEVEL = 3;

/**
 * WHICH SPANS ARE MISSING, given the turns so far and the summaries that exist.
 *
 * ONLY COMPLETE WINDOWS ARE SUMMARISED. A partial window would be summarised
 * again on the next turn and again on the one after, which is a model call per
 * turn for a summary that keeps changing — the cost of the current rewrite-in-
 * place design, moved rather than removed. The tail of the conversation is
 * already in the prompt as raw turns; it does not need a summary yet.
 *
 * @param {number} turnCount               how many turns the chat has
 * @param {Array<{level: number, from_turn: number, to_turn: number}>} existing
 * @returns {Array<{level: number, from: number, to: number, sources: object[]}>}
 */
function pendingSpans(turnCount, existing = []) {
  const have = new Set(existing.map((s) => `${s.level}:${s.from_turn}:${s.to_turn}`));
  const out = [];

  for (let from = 0; from + WINDOW <= turnCount; from += WINDOW) {
    const key = `0:${from}:${from + WINDOW}`;
    if (!have.has(key)) out.push({ level: 0, from, to: from + WINDOW, sources: [] });
  }

  for (let level = 1; level <= MAX_LEVEL; level += 1) {
    const below = [...existing, ...out]
      .filter((s) => (s.level ?? 0) === level - 1)
      .map((s) => ({ level: level - 1, from: s.from ?? s.from_turn, to: s.to ?? s.to_turn }))
      .sort((a, b) => a.from - b.from);

    for (let i = 0; i + FANOUT <= below.length; i += FANOUT) {
      const group = below.slice(i, i + FANOUT);
      const from = group[0].from;
      const to = group[group.length - 1].to;
      if (!have.has(`${level}:${from}:${to}`)) out.push({ level, from, to, sources: group });
    }
  }

  return out;
}

/**
 * WHICH SUMMARIES TO READ for a question, newest-first within a budget.
 *
 * THE RECENT TAIL IS RAW AND IS NOT THIS FUNCTION'S BUSINESS. The prompt
 * already carries the last few turns verbatim; re-reading a summary of them
 * spends budget to say less than the caller already has.
 *
 * THE REST IS COVERED AT THE HIGHEST LEVEL AVAILABLE, so that an old
 * conversation costs a few hundred tokens rather than a few thousand, and the
 * relevance ranking — which the caller supplies, because it needs an embedding
 * — decides which of those get drilled into.
 *
 * @param {object} params
 * @param {Array} params.summaries      rows from chat_summaries
 * @param {number} params.turnCount
 * @param {number} [params.rawTail]     how many recent turns are already in the prompt
 * @param {number} [params.budget]      how many summaries to return
 * @param {(row: any) => number} [params.score]  relevance, higher is better
 */
function selectSummaries({ summaries = [], turnCount = 0, rawTail = 6, budget = 4, score = null } = {}) {
  const covered = Math.max(0, turnCount - rawTail);
  const candidates = summaries.filter((s) => s.from_turn < covered);
  if (!candidates.length) return [];

  /* HIGHEST LEVEL FIRST, and then drop anything a chosen summary already
   * contains. Returning a level-1 summary and the level-0s inside it is the
   * same content twice, which is the cost this hierarchy exists to avoid. */
  const byLevel = [...candidates].sort((a, b) => b.level - a.level
    || (score ? score(b) - score(a) : b.from_turn - a.from_turn));

  const chosen = [];
  for (const row of byLevel) {
    if (chosen.length >= budget) break;
    const containedByChosen = chosen.some((c) => c.level > row.level
      && c.from_turn <= row.from_turn && c.to_turn >= row.to_turn);
    if (containedByChosen) continue;
    chosen.push(row);
  }

  /* Returned in conversation order. A model handed the middle of a chat before
   * its beginning reconstructs the order itself, badly. */
  return chosen.sort((a, b) => a.from_turn - b.from_turn);
}

/**
 * The turns a level-0 span needs, as an index range into the chat's history.
 * Half-open, matching the CHECK constraint in migration 021.
 */
function spanTurns(span, turns = []) {
  return turns.slice(span.from, span.to);
}

module.exports = { pendingSpans, selectSummaries, spanTurns, WINDOW, FANOUT, MAX_LEVEL };

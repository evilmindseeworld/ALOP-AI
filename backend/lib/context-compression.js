'use strict';

/**
 * Relevance-budgeted conversation context.
 *
 * The client sends a bounded transcript, but the same transcript is copied to
 * every council seat and can still be tens of thousands of characters. A
 * character ceiling is a transport guard, not a prompt budget: it does not
 * account for the summary, profile blocks, router instructions, or the fact
 * that a seven-seat council pays for the context seven times.
 *
 * This module is deliberately deterministic and provider-free. It keeps the
 * newest turns for continuity, selects older turns whose words overlap the
 * current question, and never changes message roles or chronology. The
 * existing conversation summary remains the semantic memory for turns that do
 * not fit. No user text is promoted to a system message here.
 */

const CONTEXT_LIMITS = Object.freeze({
  simple: Object.freeze({ maxChars: 6_000, maxMessages: 6, tailTurns: 2 }),
  moderate: Object.freeze({ maxChars: 12_000, maxMessages: 10, tailTurns: 3 }),
  complex: Object.freeze({ maxChars: 30_000, maxMessages: 14, tailTurns: 4 }),
  generation: Object.freeze({ maxChars: 30_000, maxMessages: 14, tailTurns: 4 }),
});

const DEFAULT_LIMITS = Object.freeze({ maxChars: 12_000, maxMessages: 10, tailTurns: 3 });

// High-frequency words carry almost no retrieval signal. The list is small on
// purpose: false negatives only cost a relevance opportunity, while keeping a
// stopword list that tries to encode every language would create a new router.
const STOP_WORDS = new Set([
  'a', 'about', 'after', 'again', 'all', 'an', 'and', 'are', 'as', 'at', 'be',
  'because', 'but', 'by', 'can', 'could', 'do', 'for', 'from', 'how', 'i',
  'if', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'our', 'please',
  'that', 'the', 'their', 'them', 'there', 'these', 'they', 'this', 'to',
  'use', 'was', 'we', 'what', 'when', 'where', 'which', 'who', 'why', 'with',
  'would', 'you', 'your',
]);

const WORD_RE = /[\p{L}\p{N}]{2,}/gu;
const CLIP_MARKER = '\n[...context clipped...]\n';

const asPositiveInt = (value, fallback) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

const normaliseTerm = (value) => String(value || '').normalize('NFKC').toLowerCase();

/**
 * @param {unknown} text
 * @returns {Set<string>}
 */
function terms(text) {
  const out = new Set();
  const raw = normaliseTerm(text).match(WORD_RE) || [];
  for (const word of raw) if (!STOP_WORDS.has(word)) out.add(word);
  return out;
}

const copyMessage = (message, content = message.content) => ({
  role: message.role,
  content,
});

/** Preserve both ends of a long turn so code, names, and conclusions survive. */
function clipText(text, maxChars) {
  const value = String(text || '');
  if (value.length <= maxChars) return value;
  const limit = Math.max(1, Number(maxChars) || 1);
  if (limit <= CLIP_MARKER.length + 2) return value.slice(0, limit);
  const available = limit - CLIP_MARKER.length;
  const head = Math.ceil(available / 2);
  const tail = Math.floor(available / 2);
  return `${value.slice(0, head)}${CLIP_MARKER}${value.slice(-tail)}`;
}

const messageChars = (messages) => messages.reduce((sum, message) => sum + message.content.length, 0);

/** Group a user message with the assistant reply that follows it. */
function toTurns(messages) {
  const turns = [];
  for (let i = 0; i < messages.length;) {
    const group = [messages[i]];
    i += 1;
    if (group[0].role === 'user' && messages[i]?.role === 'assistant') {
      group.push(messages[i]);
      i += 1;
    }
    turns.push({ index: turns.length, messages: group });
  }
  return turns;
}

function turnScore(turn, queryTerms, position, total) {
  if (!queryTerms.size) return 0;
  const userTerms = terms(turn.messages.filter((message) => message.role === 'user').map((message) => message.content).join(' '));
  const allTerms = terms(turn.messages.map((message) => message.content).join(' '));
  let overlap = 0;
  let userOverlap = 0;
  for (const term of queryTerms) {
    if (allTerms.has(term)) overlap += 1;
    if (userTerms.has(term)) userOverlap += 1;
  }
  if (!overlap) return 0;
  // Relevance dominates recency, but a tie goes to the newer turn. User text
  // gets a small extra weight because it is the subject, not a paraphrase.
  const recency = total > 1 ? position / (total - 1) : 1;
  return overlap * 10 + userOverlap * 2 + recency;
}

/** Fit one complete turn into a remaining character/message budget. */
function fitTurn(turn, remainingChars, remainingMessages) {
  if (remainingChars <= 0 || remainingMessages <= 0) return [];
  // If only one message fits, keep the user's question rather than an orphan
  // assistant reply. The normal profiles leave room for complete pairs; this
  // rule protects callers that deliberately pass a very small custom budget.
  const source = turn.messages.slice(0, remainingMessages);
  const out = [];
  let charsLeft = remainingChars;
  for (let i = 0; i < source.length; i += 1) {
    const messagesLeft = source.length - i;
    const allocation = Math.min(charsLeft, Math.max(1, Math.floor(charsLeft / messagesLeft)));
    if (allocation <= 0) break;
    const content = clipText(source[i].content, allocation);
    if (!content) continue;
    out.push(copyMessage(source[i], content));
    charsLeft -= content.length;
  }
  return out;
}

function normaliseLimits({ complexity, maxChars, maxMessages, tailTurns } = {}) {
  const base = CONTEXT_LIMITS[complexity] || DEFAULT_LIMITS;
  return {
    maxChars: asPositiveInt(maxChars, base.maxChars),
    maxMessages: asPositiveInt(maxMessages, base.maxMessages),
    tailTurns: asPositiveInt(tailTurns, base.tailTurns),
  };
}

/**
 * @param {Array<{role: string, content: string}>} rawMessages already
 *   sanitised by lib/history.js in the request path.
 * @param {string} question current user turn used only for local ranking.
 * @param {object} [options]
 * @returns {{messages: Array<{role: string, content: string}>, stats: object}}
 */
function compressConversationContext(rawMessages, question, options = {}) {
  const source = Array.isArray(rawMessages)
    ? rawMessages.filter((message) =>
      message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string' && message.content,
    ).map((message) => copyMessage(message))
    : [];
  const limits = normaliseLimits(options);
  const originalChars = messageChars(source);

  if (!source.length) {
    return {
      messages: [],
      stats: {
        compressed: false,
        originalMessages: 0,
        retainedMessages: 0,
        originalChars: 0,
        retainedChars: 0,
        droppedMessages: 0,
        relevantTurns: 0,
        maxChars: limits.maxChars,
        maxMessages: limits.maxMessages,
      },
    };
  }

  const turns = toTurns(source);
  const tailStart = Math.max(0, turns.length - limits.tailTurns);
  const queryTerms = terms(question);
  const rankedOlder = turns
    .slice(0, tailStart)
    .map((turn) => ({ turn, score: turnScore(turn, queryTerms, turn.index, turns.length) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.turn.index - a.turn.index);

  const selected = new Map();
  let charsLeft = limits.maxChars;
  let messagesLeft = limits.maxMessages;

  // Add the tail newest-first, then restore the original order at the end.
  for (let i = turns.length - 1; i >= tailStart; i -= 1) {
    const fitted = fitTurn(turns[i], charsLeft, messagesLeft);
    if (!fitted.length) break;
    selected.set(i, fitted);
    charsLeft -= messageChars(fitted);
    messagesLeft -= fitted.length;
  }

  // Relevance can pull an older turn through the window even when the tail is
  // full. A whole turn is preferred; clipping is only used when it is the last
  // available space, and the caller can see that in the numeric telemetry.
  for (const { turn } of rankedOlder) {
    if (selected.has(turn.index) || charsLeft <= 0 || messagesLeft <= 0) continue;
    const fitted = fitTurn(turn, charsLeft, messagesLeft);
    if (!fitted.length) continue;
    selected.set(turn.index, fitted);
    charsLeft -= messageChars(fitted);
    messagesLeft -= fitted.length;
  }

  // If the question has no useful lexical terms, keep one more recent older
  // turn when there is room. This keeps short follow-ups from losing all
  // antecedent context while still respecting the explicit budget.
  for (let i = tailStart - 1; i >= 0 && charsLeft > 0 && messagesLeft > 0; i -= 1) {
    if (selected.has(i)) continue;
    const fitted = fitTurn(turns[i], charsLeft, messagesLeft);
    if (!fitted.length) continue;
    selected.set(i, fitted);
    charsLeft -= messageChars(fitted);
    messagesLeft -= fitted.length;
    break;
  }

  const messages = [...selected.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([, fitted]) => fitted);
  const retainedChars = messageChars(messages);
  const retainedMessages = messages.length;
  const relevantTurns = rankedOlder.filter(({ turn }) => selected.has(turn.index)).length;

  return {
    messages,
    stats: {
      compressed: retainedMessages !== source.length || retainedChars !== originalChars,
      originalMessages: source.length,
      retainedMessages,
      originalChars,
      retainedChars,
      droppedMessages: Math.max(0, source.length - retainedMessages),
      relevantTurns,
      maxChars: limits.maxChars,
      maxMessages: limits.maxMessages,
    },
  };
}

module.exports = {
  CONTEXT_LIMITS,
  DEFAULT_LIMITS,
  compressConversationContext,
  clipText,
  terms,
};

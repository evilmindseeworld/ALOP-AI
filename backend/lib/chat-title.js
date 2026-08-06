/**
 * Naming a conversation.
 *
 * The sidebar used to show the first six words of whatever you typed, which is
 * the failure mode the research on chat history calls out by name: titles with
 * no information scent. "How do I get my", "Can you help me with", "Hi I wanted
 * to ask" — every one of those is a different conversation and they all look
 * identical in a list. Retrieval then depends on remembering your own wording,
 * which is exactly the thing people cannot do a week later.
 *
 * A model writes the title instead. The cost is one FAST_MODEL call of about
 * twenty tokens, once, on the first message of a chat.
 *
 * WHAT THIS FILE IS AND IS NOT. It is the prompt and the sanitiser — the parts
 * that can be called with a string and checked. The model call itself lives in
 * server.js, because it needs the shared client. The sanitiser is the important
 * half: a title comes back from a language model, goes straight into the
 * sidebar, and is the one piece of model output in this app rendered as a label
 * rather than as prose. It is treated as untrusted input.
 */

/**
 * Kept deliberately blunt. Every clause exists because a model did the opposite
 * at least once:
 *   - "no quotes" because models like wrapping titles in them
 *   - "no final period" because a full stop in a sidebar row looks like a typo
 *   - "not a sentence" because otherwise it echoes the question back, which is
 *     the six-word slice again with extra latency
 *   - "answer nothing" because question in / answer out is the default
 *     behaviour of the thing being asked
 */
const TITLE_PROMPT =
  "You name conversations. Reply with a title of 2 to 5 words for the message that follows. " +
  "It must be a noun phrase describing the TOPIC, not a sentence, not a question, and not an answer. " +
  "No quotation marks. No final period. No prefix such as 'Title:'. Answer nothing else.";

/** Hard ceiling. The sidebar row ellipsises well before this. */
const MAX_TITLE_CHARS = 48;

/** Below this a title carries no more than the fallback would. */
const MIN_TITLE_CHARS = 2;

/**
 * Strip C0 controls and DEL, by code point rather than by character class.
 *
 * Deliberately NOT a regex range. The first draft wrote that class with the
 * bytes typed literally instead of escaped, which did two things: it made this
 * source file binary to `grep`, and the class read as "space through hyphen" —
 * so it deleted every space in every title. That is a bug which presents as a
 * styling problem and hides inside a regex. Comparing numbers cannot misread
 * itself the same way.
 */
const stripControl = (s) => {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c >= 0x20 && c !== 0x7f) out += ch;
  }
  return out;
};

/**
 * A model wrote this. Treat it as input.
 *
 * @param {unknown} raw whatever the model returned.
 * @returns {string|null} a usable title, or null when the caller should keep
 *   whatever it already had. Null rather than a default string, because the
 *   caller already HAS a reasonable local title and this function has no
 *   business inventing a worse one.
 */
function sanitizeTitle(raw) {
  if (typeof raw !== "string") return null;

  let t = raw
    // Models return multi-line answers when they ignore the prompt. Only the
    // first line can possibly be a title.
    .split("\n")[0]
    .trim()
    // "Title: Foo" / "Chat title - Foo"
    .replace(/^(chat\s+)?title\s*[:\-–—]\s*/i, "")
    // Surrounding quotes of every kind, including the smart ones.
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "")
    // Markdown emphasis, in case it arrives styled.
    .replace(/^[*_#\s]+|[*_\s]+$/g, "")
    .trim()
    // A trailing full stop reads as a typo in a list. Question and exclamation
    // marks survive — "Why the build fails?" is a legitimate title.
    .replace(/\.+$/, "")
    .trim();

  t = stripControl(t);
  // Collapse internal whitespace, including anything the line split missed.
  t = t.replace(/\s+/g, " ").trim();

  if (t.length < MIN_TITLE_CHARS) return null;
  // Must contain something readable. "!!!" and "---" clear the length check and
  // are not names. Unicode property escapes rather than A-Za-z0-9, because this
  // product answers in Arabic, Chinese, Japanese, Korean and Russian, and an
  // ASCII test would reject every title in all five.
  if (!/[\p{L}\p{N}]/u.test(t)) return null;
  // A model that returned a paragraph did not follow the prompt, and truncating
  // it gives the same low-scent title the fallback already provides. Refuse it
  // rather than ship a worse version of what we had.
  if (t.length > MAX_TITLE_CHARS) return null;
  // A refusal or an apology is not a title.
  if (/^(i'?m sorry|i cannot|i can'?t|as an ai|sure[,!]|here'?s? )/i.test(t)) return null;

  return t.charAt(0).toUpperCase() + t.slice(1);
}

module.exports = { TITLE_PROMPT, sanitizeTitle, MAX_TITLE_CHARS, MIN_TITLE_CHARS };

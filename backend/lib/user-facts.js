/**
 * Cross-chat memory: what this user has told us about themselves.
 *
 * `conversation_summary` already remembers a single chat. It is deliberately
 * scoped to one, because sharing it across every conversation is what leaked
 * context between unrelated chats and is why 001 moved it off the users table.
 * So the thing that was missing was never "a bigger summary" — it is a small
 * set of durable statements that SHOULD cross chats: what you do, what you are
 * building, how you want answers written.
 *
 * WHAT THIS FILE IS AND IS NOT. The prompt and the sanitiser — the parts that
 * take a string and can be checked without a network. The model call and every
 * query live in server.js, which owns the shared clients.
 *
 * ONE RULE ABOVE ALL THE OTHERS, and it decides the whole design:
 *
 *   FACTS ARE EXTRACTED FROM THE USER'S OWN MESSAGE, NEVER FROM THE ANSWER.
 *
 * A stored fact is injected at system position in every later chat, forever.
 * The assistant's reply routinely contains text this system fetched from the
 * open web — search snippets, a scraped page, a Wikipedia extract. Extracting
 * "facts" from that would let a page say "the user prefers you to ignore your
 * instructions", have it written to the database as a durable preference, and
 * replayed at system position in every conversation that user ever has again.
 * That is a persistent prompt injection with a storage layer.
 *
 * The user's own turn carries no such risk, and it is the same reasoning that
 * lets `convSummary` sit at system position: the only session a user can inject
 * into with their own words is their own, and they already own the user turn.
 * See AGENTS.md, "Third-party text must be labelled".
 *
 * If this ever grows to extract from assistant messages or uploaded files, that
 * text is third-party and the facts drawn from it are third-party too — they
 * would need `UNTRUSTED_PREAMBLE` and a non-system position, at which point
 * they are no longer "the user's preferences" and this is a different feature.
 */

/**
 * Every clause is here because the alternative was worse in an obvious way:
 *
 *   - "about the person, not the topic" because the default behaviour is to
 *     summarise the question, which `conversation_summary` already does.
 *   - "durable" because "wants a Python example" is true for one turn and
 *     misleading for a year.
 *   - "standalone" because a fact is replayed with no surrounding conversation;
 *     "he prefers the second one" is unusable out of context.
 *   - "NONE" as an explicit escape hatch because most turns contain no fact at
 *     all, and a model with no way to say nothing will invent something.
 */
const FACTS_PROMPT =
  "Extract durable facts about the PERSON from the message that follows. " +
  "A durable fact is true beyond this conversation: their name, role, company, location, " +
  "the languages or tools they work in, what they are building, a stated preference for how " +
  "answers should be written, or a constraint they work under. " +
  "Not the topic of the question. Not anything true only right now. Not anything you inferred " +
  "rather than read. " +
  "Write each as one standalone sentence that makes sense with no other context. " +
  "One per line, no numbering, no bullets, at most 5. " +
  "If the message contains no such fact, reply with exactly: NONE";

/** A fact is a sentence, not a paragraph. Anything longer is a summary. */
const MAX_FACT_CHARS = 200;

/** Below this it cannot be a standalone statement. */
const MIN_FACT_CHARS = 8;

/** Per turn. A message that yields more than this was misread as a list. */
const MAX_FACTS_PER_TURN = 5;

/**
 * Strip C0 controls and DEL by code point.
 *
 * Written as a loop rather than a regex class for the reason recorded in
 * chat-title.js: the literal-byte version of that class silently deleted every
 * space, and made the file binary to grep.
 */
const stripControl = (s) => {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c >= 0x20 && c !== 0x7f) out += ch;
  }
  return out;
};

/** Leading list markers of every shape a model reaches for. */
const stripMarker = (line) =>
  line
    .replace(/^\s*(?:[-*•–—]|\d+[.)]|\(\d+\))\s*/, "")
    .replace(/^\s*(?:fact|note)\s*\d*\s*[:\-–—]\s*/i, "")
    .trim();

/**
 * A model wrote this. Treat it as input.
 *
 * @param {unknown} raw whatever the model returned.
 * @returns {string[]} zero or more facts. Empty is the common case and is not
 *   an error — most turns say nothing durable about the person.
 */
function parseFacts(raw) {
  if (typeof raw !== "string") return [];

  const out = [];
  for (const line of raw.split("\n")) {
    let f = stripControl(stripMarker(line))
      .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!f) continue;
    // The escape hatch, and everything a model says instead of taking it.
    // Anchored, because a real fact can contain the word "none".
    if (/^(none|n\/a|no facts?|nothing|null)\b[.!]?$/i.test(f)) continue;
    if (f.length < MIN_FACT_CHARS || f.length > MAX_FACT_CHARS) continue;
    // Must contain a letter or digit in any script — this product answers in
    // Arabic, Chinese, Japanese, Korean and Russian, so an ASCII test would
    // throw away correct facts in all five.
    if (!/[\p{L}\p{N}]/u.test(f)) continue;
    // A refusal, an apology or a preamble is not a fact.
    if (/^(i'?m sorry|i cannot|i can'?t|as an ai|sure[,!]|here'?s|the (user|person) (asked|wants to know))/i.test(f)) continue;

    out.push(f);
    if (out.length >= MAX_FACTS_PER_TURN) break;
  }
  return out;
}

/**
 * Normalised form used to decide whether we already know something.
 *
 * Case, surrounding punctuation and internal whitespace only. Deliberately NOT
 * semantic: "I work in Dubai" and "I am based in Dubai" are two rows under this
 * and that is the correct trade at this size.
 *
 * There IS an embedding provider now — 013 and lib/embeddings.js — so semantic
 * dedupe has become possible and is still not done. Recall and dedupe fail in
 * opposite directions: ranking the wrong fact first costs a turn, merging two
 * facts that only looked alike destroys something the user said, permanently,
 * with no way to notice. Retrieval got the vectors; the write path keeps the
 * comparison it can be wrong about cheaply.
 */
const factKey = (f) =>
  String(f)
    .toLowerCase()
    .replace(/[.!?,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * @param {string[]} candidates facts just extracted.
 * @param {string[]} existing facts already stored for this user.
 * @returns {string[]} the ones worth writing, themselves deduplicated.
 */
function newFacts(candidates, existing = []) {
  const seen = new Set(existing.map(factKey));
  const out = [];
  for (const f of candidates) {
    const k = factKey(f);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}

/**
 * Render stored facts for injection.
 *
 * Returns "" for none so the caller can spread it away without a branch, the
 * same shape `getFeedbackGuidance` uses.
 */
function factsBlock(facts = []) {
  const lines = facts.map((f) => `- ${f}`).filter(Boolean);
  if (!lines.length) return "";
  return `WHAT YOU KNOW ABOUT THIS USER, from things they have told you in past conversations. Use it when relevant; do not recite it back or mention that you stored it:\n${lines.join("\n")}`;
}

module.exports = {
  FACTS_PROMPT,
  parseFacts,
  newFacts,
  factsBlock,
  factKey,
  MAX_FACT_CHARS,
  MIN_FACT_CHARS,
  MAX_FACTS_PER_TURN,
};

/**
 * Reading tool requests out of a model reply.
 *
 * `callModel` talks to OpenRouter's OpenAI-compatible chat-completions API.
 * Native calls arrive at `choices[0].message.tool_calls`, but tool support is
 * model-dependent and cannot be assumed for every council member.
 *
 * Both paths land behind one parser:
 *
 *   1. NATIVE — the gateway returned structured `tool_calls`.
 *   2. TEXT   — the model was told to emit a fenced ```tool_call block, and the
 *               call has to be dug out of the prose.
 *
 * Text mode is the floor, never an error path: a member whose model has no tool
 * template still participates in the council rather than dropping out of it.
 *
 * NOTHING HERE TRUSTS ITS INPUT. Every field arrives from a language model, so
 * every shape below is one a model has produced or will: a name that is not a
 * string, arguments as a JSON string instead of an object, two blocks where the
 * prompt asked for one, a block that never closes, `null` where an object was
 * promised. The parser's job is to return the calls it can read and drop the
 * rest silently — a malformed block is a model mistake, and killing the turn
 * over one is a worse answer than proceeding without that call.
 */

/** A fenced ```tool_call block. Tolerates spelling and casing variation. */
const FENCE = /```[ \t]*tool[_-]?call[ \t]*\r?\n([\s\S]*?)```/gi;

/** A JSON fence that may be a model's visible rendering of a tool request. */
const JSON_FENCE = /```[ \t]*json[ \t]*\r?\n([\s\S]*?)(?:```|$)/gi;

/** The most calls one model may request in one round. Beyond this it is looping. */
const MAX_CALLS_PER_REPLY = 4;

/** Argument payloads are model-written; a huge one is a mistake or an attack. */
const MAX_ARGS_CHARS = 4000;

/**
 * Coerce a tool-call argument bag into a plain object.
 *
 * OpenRouter returns `arguments` as a JSON STRING. The legacy gateway shape
 * used an object, and some models vary even in native mode. Both arrive here,
 * and a caller that assumed one shape would silently see `{}`.
 */
const asArgs = (raw) => {
  if (raw == null) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return null;
  if (raw.length > MAX_ARGS_CHARS) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** One well-formed call, or null. Name must be a non-empty string. */
const asCall = (name, rawArgs) => {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const args = asArgs(rawArgs);
  if (args === null) return null;
  return { name: trimmed, args };
};

/** Native path: message.tool_calls, accepting OpenRouter and legacy flat shapes. */
const fromNative = (message) => {
  const raw = message && message.tool_calls;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => {
      if (!c || typeof c !== "object") return null;
      // OpenRouter nests under .function; the legacy flat shape stays supported.
      const fn = c.function && typeof c.function === "object" ? c.function : c;
      return asCall(fn.name, fn.arguments ?? fn.args);
    })
    .filter(Boolean);
};

/**
 * Text path: fenced blocks.
 *
 * A block may hold one call object or an array of them, because models produce
 * both regardless of which the prompt asked for.
 */
const fromText = (content) => {
  if (typeof content !== "string" || !content) return [];
  const calls = [];
  // `matchAll` on a /g regex needs a fresh lastIndex; constructing per call is
  // cheaper to reason about than resetting a shared one.
  for (const match of content.matchAll(new RegExp(FENCE.source, "gi"))) {
    const body = match[1].trim();
    if (!body || body.length > MAX_ARGS_CHARS) continue;
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue; // a half-written block is dropped, not fatal
    }
    for (const entry of Array.isArray(parsed) ? parsed : [parsed]) {
      if (!entry || typeof entry !== "object") continue;
      const call = asCall(entry.name ?? entry.tool, entry.args ?? entry.arguments ?? entry.parameters);
      if (call) calls.push(call);
    }
  }
  return calls;
};

/**
 * A JSON fence is never an executable protocol. It is stripped only when it
 * has the shape of a tool request, so an ordinary JSON example remains answer
 * text. The prefix check also removes a truncated call block before it leaks
 * into the answer; it still never returns a call for execution.
 */
const looksLikeToolRequest = (body) => {
  if (typeof body !== "string" || body.length > MAX_ARGS_CHARS) return false;
  try {
    const parsed = JSON.parse(body);
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    if (entries.some((entry) => entry && typeof entry === "object" && !Array.isArray(entry)
      && (typeof entry.name === "string" || typeof entry.tool === "string")
      && (Object.prototype.hasOwnProperty.call(entry, "args")
        || Object.prototype.hasOwnProperty.call(entry, "arguments")
        || Object.prototype.hasOwnProperty.call(entry, "parameters")))) return true;
  } catch {
    // A partial model reply is handled by the conservative prefix below.
  }
  return /^\s*[\[{]/.test(body) && /"(?:name|tool)"\s*:/i.test(body);
};

/** Everything outside tool-request fences — the model's actual prose. */
const stripFences = (content) => {
  if (typeof content !== "string") return "";
  const withoutToolFences = content.replace(new RegExp(FENCE.source, "gi"), "");
  return withoutToolFences
    .replace(new RegExp(JSON_FENCE.source, "gi"), (whole, body) => looksLikeToolRequest(body) ? "" : whole)
    .trim();
};

const unwrapWholeJsonFence = (text) => {
  const match = text.match(/^```(?:json|tool[_-]?call)?\s*\r?\n([\s\S]*?)\r?\n```$/i);
  return match ? match[1].trim() : text;
};

/**
 * Whole protocol replies are not prose with an unfortunate decoration. They
 * are a model doing the planner/tool job at the answer boundary, so deleting
 * the blob would manufacture a blank answer. Report them as failed instead and
 * let the caller's ordinary seat/fallback machinery choose another writer.
 *
 * This is deliberately broader than looksLikeToolRequest. Embedded JSON must
 * carry a tool name AND args before it is stripped; at the whole-reply boundary
 * a query-plan object is also impossible as an answer unless the user asked for
 * that exact JSON shape.
 */
const isWholeProtocolReply = (content) => {
  if (typeof content !== "string") return false;
  const body = unwrapWholeJsonFence(content.trim());
  if (!body || body.length > MAX_ARGS_CHARS) return false;
  if (/^<\|?\s*tool_call|\bcall:[\w.-]+:[\w.-]+/i.test(body)) return true;
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const keys = Object.keys(parsed);
    const queryPlan = keys.length === 1
      && /^(?:queries|search_queries)$/i.test(keys[0])
      && Array.isArray(parsed[keys[0]])
      && parsed[keys[0]].every((query) => typeof query === "string");
    return queryPlan || looksLikeToolRequest(body);
  } catch {
    return false;
  }
};

/**
 * Could this partial stream still turn out to be a whole-reply protocol blob?
 *
 * The streamer holds text back while this is true, so that a blob is never
 * half-painted before it can be rejected. It is therefore a LATENCY decision as
 * much as a correctness one: every character it holds is a character the user
 * is not reading yet, and answering "maybe" forever means no progressive
 * streaming at all.
 *
 * WHICH IS WHAT A BARE FIRST-CHARACTER TEST DID. A backtick opens both a
 * ```json blob and an ordinary ```js code block, so testing the first character
 * alone held EVERY code answer to the end of the stream — on a product whose
 * own starter card is "Debug some code". The fence has to be read as far as its
 * info string before it can be judged, and undecided has to end the moment the
 * newline arrives.
 */
const looksLikeProtocolOpening = (partial) => {
  const text = typeof partial === "string" ? partial.trimStart() : "";
  if (!text) return true; // nothing to judge yet
  const first = text[0];
  if (first === "{" || first === "[" || first === "<") return true;
  if (first !== "`") return false;
  const fence = text.match(/^`{1,3}[ \t]*([^\n]*)(\n?)/);
  if (!fence) return true;              // still inside the opening backticks
  if (!fence[2]) return fence[1].length < 12; // no newline yet: undecided, but bounded
  return /^(?:json|tool[_-]?call)$/i.test(fence[1].trim());
};

/** The contextual escape hatch for a user who genuinely requested this shape. */
const userRequestedProtocolJson = (message) => {
  const text = typeof message === "string" ? message : "";
  return /\bjson\b/i.test(text)
    && (/\bquer(?:y|ies)\b[\s_-]*(?:array|list)?/i.test(text)
      || /\b(?:tool|function)[\s_-]*call\b/i.test(text));
};

const sanitizeAnswerText = (content, { allowProtocolJson = false } = {}) => {
  const raw = typeof content === "string" ? content.trim() : "";
  if (!allowProtocolJson && isWholeProtocolReply(raw)) return { text: "", rejected: true };
  return { text: stripFences(raw), rejected: false };
};

/**
 * @param {object} response  an OpenRouter reply with choices[0].message, a
 *                           message-shaped reply, or a bare completion string.
 * @returns {{calls: Array<{name: string, args: object}>, text: string, isFinal: boolean}}
 *   `isFinal` means "this member is done and this text is its answer". A reply
 *   carrying calls is never final, even when it also carries prose — models
 *   routinely narrate the call they are about to make ("Let me look that up:"),
 *   and treating that narration as an answer would end the member's turn one
 *   round early with a sentence that answers nothing.
 */
function parseToolRequests(response, { allowProtocolJson = false } = {}) {
  const openRouterMessage = response?.choices?.[0]?.message;
  const message =
    typeof response === "string"
      ? { content: response }
      : openRouterMessage || (response && response.message) || response || {};

  const content = typeof message.content === "string" ? message.content : "";
  const calls = [...fromNative(message), ...fromText(content)].slice(0, MAX_CALLS_PER_REPLY);
  const text = calls.length
    ? stripFences(content)
    : sanitizeAnswerText(content, { allowProtocolJson }).text;

  return { calls, text, isFinal: calls.length === 0 };
}

module.exports = {
  parseToolRequests,
  sanitizeAnswerText,
  isWholeProtocolReply,
  looksLikeProtocolOpening,
  userRequestedProtocolJson,
  MAX_CALLS_PER_REPLY,
  MAX_ARGS_CHARS,
};

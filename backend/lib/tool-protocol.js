/**
 * Reading tool requests out of a model reply.
 *
 * `callModel` talks to an Ollama-shaped gateway. Ollama's /api/chat accepts a
 * `tools` array and answers with `message.tool_calls`, but that support is per
 * model, and these are custom model names on a hosted gateway — so it cannot
 * be assumed for any given council member.
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

/** A fenced ```tool_call block. Tolerates ```tool_call, ```tool-call, ```json-ish casing. */
const FENCE = /```[ \t]*tool[_-]?call[ \t]*\r?\n([\s\S]*?)```/gi;

/** The most calls one model may request in one round. Beyond this it is looping. */
const MAX_CALLS_PER_REPLY = 4;

/** Argument payloads are model-written; a huge one is a mistake or an attack. */
const MAX_ARGS_CHARS = 4000;

/**
 * Coerce a tool-call argument bag into a plain object.
 *
 * Ollama returns `arguments` as an object. OpenAI-shaped gateways return it as
 * a JSON STRING. Some models emit a string even in native mode. All three
 * arrive here, and a caller that assumed one shape would silently see `{}`.
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

/** Native path: message.tool_calls, in either the Ollama or OpenAI shape. */
const fromNative = (message) => {
  const raw = message && message.tool_calls;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => {
      if (!c || typeof c !== "object") return null;
      // Ollama nests under .function; some gateways put name/arguments flat.
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

/** Everything outside the fenced blocks — the model's actual prose. */
const stripFences = (content) =>
  typeof content === "string" ? content.replace(new RegExp(FENCE.source, "gi"), "").trim() : "";

/**
 * @param {object} response  a gateway reply: { message?: {content, tool_calls} }
 *                           or a bare string, which is what callModel returns today.
 * @returns {{calls: Array<{name: string, args: object}>, text: string, isFinal: boolean}}
 *   `isFinal` means "this member is done and this text is its answer". A reply
 *   carrying calls is never final, even when it also carries prose — models
 *   routinely narrate the call they are about to make ("Let me look that up:"),
 *   and treating that narration as an answer would end the member's turn one
 *   round early with a sentence that answers nothing.
 */
function parseToolRequests(response) {
  const message =
    typeof response === "string"
      ? { content: response }
      : (response && response.message) || response || {};

  const content = typeof message.content === "string" ? message.content : "";
  const calls = [...fromNative(message), ...fromText(content)].slice(0, MAX_CALLS_PER_REPLY);
  const text = calls.length ? stripFences(content) : content.trim();

  return { calls, text, isFinal: calls.length === 0 };
}

module.exports = { parseToolRequests, MAX_CALLS_PER_REPLY, MAX_ARGS_CHARS };

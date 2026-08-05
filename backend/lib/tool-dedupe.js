/**
 * One canonical key per tool call, so the same request from four members costs
 * one execution.
 *
 * This is where the design's saving actually lives. Seven pro members asked the
 * same question will phrase the resulting search near-identically, and the
 * whole point of "propose → dedupe → broadcast" is that the union is executed
 * once and the results go to everyone. A key that misses a duplicate does not
 * break anything visibly — it just quietly costs a real API call and a slice of
 * the 25s budget, which is the kind of regression nobody notices.
 *
 * So the key has to survive every way two models can say the same thing:
 *
 *   - key order:      {query:"a",n:2} and {n:2,query:"a"}
 *   - whitespace:     "OLED  burn-in\n" and "oled burn-in"
 *   - case:           models capitalise search queries inconsistently
 *   - nesting:        objects inside objects, ordered differently
 *
 * and must NOT collapse things that are genuinely different:
 *
 *   - different tools with identical args
 *   - "a b" and "ab"        (whitespace COLLAPSES, it does not vanish)
 *   - {a:"1"} and {a:1}     (a string and a number are different arguments)
 */

/** Whitespace runs collapse to one space; the ends are trimmed; case folds. */
const normaliseString = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * A stable, type-preserving serialisation.
 *
 * JSON.stringify alone is not enough: it preserves insertion order, so two
 * objects with the same entries in a different order produce different strings.
 * Keys are therefore sorted at every depth.
 *
 * Types are tagged (`s:`, `n:`, `b:`) so that the string "1" and the number 1
 * cannot collide — `{limit:"1"}` and `{limit:1}` are different arguments and a
 * tool may well treat them differently.
 */
const canonical = (value) => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  switch (typeof value) {
    case "string":
      return "s:" + normaliseString(value);
    case "number":
      return "n:" + (Number.isFinite(value) ? String(value) : "nan");
    case "boolean":
      return "b:" + value;
    case "undefined":
      return "undef";
    case "object": {
      const keys = Object.keys(value).sort();
      return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
    }
    default:
      return "?";
  }
};

/** The dedupe key for one call. Equal keys mean one execution. */
function callKey(call) {
  if (!call || typeof call.name !== "string") return "invalid";
  // The tool name is NOT case-folded past a trim+lowercase of its own: two
  // different tools with identical arguments must never share a key.
  return normaliseString(call.name) + "|" + canonical(call.args || {});
}

/**
 * Union the calls proposed across every member of a round.
 *
 * @param {Array<{member?: string, calls: Array<{name, args}>}>} proposals
 * @param {number} limit  hard ceiling on unique calls (the turn's remaining budget)
 * @returns {{unique: Array<{key, name, args, requestedBy: string[]}>, dropped: number}}
 *   `requestedBy` is kept because a truncated round has to be able to say which
 *   member's request was cut, and because it is the only way to see in a log
 *   that the dedupe is earning its place.
 */
function dedupeCalls(proposals, limit = Infinity) {
  const byKey = new Map();
  let dropped = 0;

  for (const proposal of proposals || []) {
    if (!proposal) continue;
    const member = proposal.member || "unknown";
    for (const call of proposal.calls || []) {
      const key = callKey(call);
      if (key === "invalid") continue;

      const existing = byKey.get(key);
      if (existing) {
        // Same call, another member. No new execution; record the interest.
        if (!existing.requestedBy.includes(member)) existing.requestedBy.push(member);
        continue;
      }
      // The ceiling is applied to UNIQUE calls, after dedupe — a round where
      // every member asks the same thing must not be counted as N calls and
      // truncated for it.
      if (byKey.size >= limit) {
        dropped++;
        continue;
      }
      byKey.set(key, { key, name: call.name, args: call.args || {}, requestedBy: [member] });
    }
  }

  return { unique: [...byKey.values()], dropped };
}

module.exports = { callKey, dedupeCalls };

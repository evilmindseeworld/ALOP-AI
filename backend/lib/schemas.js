'use strict';

/**
 * The four shapes that cross a trust boundary inside a turn, and a validator
 * small enough that nobody is tempted to skip it.
 *
 * WHY NOT A LIBRARY. Every one of these is produced by a MODEL or read back out
 * of Postgres, so the failure they guard against is not a typo in our own code —
 * it is a provider returning something almost right. `ajv` and `zod` both do
 * that job well and both are a dependency on the answer path for a hundred
 * lines of checking. This file is those hundred lines.
 *
 * WHY NOT "it parsed, so it is fine". Each of these four had a real failure
 * shape already recorded in this repository:
 *
 *   - ROUTE_PLAN: a model answering the question instead of planning the search,
 *     so an ANSWER went to the search providers as a query (see
 *     lib/search-plan.js). The parser drops those shapes; the schema is what
 *     stops a NEW one reaching the providers un-noticed.
 *   - TOOL_CALL: `message.tool_calls` used to be collapsed to `''` one function
 *     before anything could read it (see lib/model-reply.js). Ids and arguments
 *     are load-bearing — a tool result can only be returned against the id that
 *     asked for it — so the shape is asserted rather than assumed.
 *   - EVIDENCE_RECORD: a claim with no source, no date and no confidence is
 *     indistinguishable from a claim with all three once it is inside prose.
 *   - FINAL_ANSWER_META: what gets written to the turn ledger. A ledger row that
 *     can be missing its own operation id is not a ledger.
 *
 * STRICTNESS IS THE POINT. `validate` REJECTS unknown keys rather than passing
 * them through: an unknown key on a model-produced object is either a provider
 * change worth knowing about or a prompt-injection attempt, and silently
 * carrying it into a database row is how one becomes the other. Use
 * `coerce` when the extra keys are known to be ours and simply unwanted.
 */

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/* ---- field checkers -------------------------------------------------- */

const T = {
  bool: () => ({ name: 'boolean', check: (v) => typeof v === 'boolean' }),
  string: ({ max = 10_000, min = 0, pattern = null } = {}) => ({
    name: 'string',
    check: (v) => typeof v === 'string' && v.length >= min && v.length <= max && (!pattern || pattern.test(v)),
  }),
  number: ({ min = -Infinity, max = Infinity, integer = false } = {}) => ({
    name: 'number',
    check: (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max && (!integer || Number.isInteger(v)),
  }),
  enum: (values) => ({
    name: `enum(${values.join('|')})`,
    check: (v) => values.includes(v),
  }),
  object: () => ({ name: 'object', check: isPlainObject }),
  arrayOf: (inner, { max = 100 } = {}) => ({
    name: `array<${inner.name}>`,
    check: (v) => Array.isArray(v) && v.length <= max && v.every((item) => inner.check(item)),
  }),
  /** Explicit null is a VALUE here, never a missing field. */
  nullable: (inner) => ({ name: `${inner.name}|null`, check: (v) => v === null || inner.check(v) }),
};

/* ---- the validator ---------------------------------------------------- */

/**
 * @param {{name: string, fields: object, optional?: string[]}} schema
 * @param {unknown} value
 * @returns {{ok: boolean, value: object|null, errors: string[]}}
 */
function validate(schema, value) {
  const errors = [];
  if (!isPlainObject(value)) {
    return { ok: false, value: null, errors: [`${schema.name}: expected an object`] };
  }
  const optional = new Set(schema.optional || []);
  const out = {};
  for (const [key, type] of Object.entries(schema.fields)) {
    if (!(key in value)) {
      if (!optional.has(key)) errors.push(`${schema.name}.${key}: missing`);
      continue;
    }
    if (!type.check(value[key])) {
      errors.push(`${schema.name}.${key}: expected ${type.name}`);
      continue;
    }
    out[key] = value[key];
  }
  for (const key of Object.keys(value)) {
    if (!(key in schema.fields)) errors.push(`${schema.name}.${key}: unknown field`);
  }
  return errors.length ? { ok: false, value: null, errors } : { ok: true, value: out, errors: [] };
}

/**
 * Validate, but drop unknown keys instead of failing on them.
 *
 * For objects WE built and merely want narrowed to the contract before they are
 * persisted. Never for a model's output — see the header.
 */
function coerce(schema, value) {
  if (!isPlainObject(value)) return validate(schema, value);
  const known = {};
  for (const key of Object.keys(schema.fields)) if (key in value) known[key] = value[key];
  return validate(schema, known);
}

/** Throwing form, for places where a bad value is a bug rather than an input. */
function assertValid(schema, value) {
  const result = validate(schema, value);
  if (!result.ok) {
    const error = new Error(`${schema.name} failed validation: ${result.errors.join('; ')}`);
    error.code = 'SCHEMA_INVALID';
    error.schema = schema.name;
    error.errors = result.errors;
    throw error;
  }
  return result.value;
}

/* ---- the four shapes -------------------------------------------------- */

/** What the router decided. Exactly one of the three branches is live. */
const ROUTE_PLAN = {
  name: 'RoutePlan',
  fields: {
    memory: T.bool(),
    queries: T.nullable(T.arrayOf(T.string({ min: 1, max: 200 }), { max: 2 })),
  },
  optional: [],
};

/** One tool request, however the model expressed it. */
const TOOL_CALL = {
  name: 'ToolCall',
  fields: {
    /* Never generated here. The provider's own id is the only handle a tool
     * RESULT can be returned against, and a substitute id silently detaches the
     * result from the request. `fence` calls carry null, which is honest: a
     * fenced call has no id and the loop matches those positionally. */
    id: T.nullable(T.string({ min: 1, max: 200 })),
    name: T.string({ min: 1, max: 100 }),
    args: T.object(),
    source: T.enum(['native', 'fence']),
  },
  /* `id` is ABSENT, not null, on a fenced call. The two spellings are not
   * interchangeable to the round-trip code — `if (call.id)` is what decides
   * whether a result is addressed to an id or matched positionally — so the
   * schema accepts absence rather than forcing a null that would then have to
   * be un-forced at every read site. */
  optional: ['id'],
};

/**
 * One externally verifiable claim and what backs it.
 *
 * `sourceDate` is the date the SOURCE carries, not the date it was fetched —
 * they differ by exactly the amount that matters when deciding freshness, and
 * conflating them is how a five-year-old page reads as today's news.
 */
const EVIDENCE_RECORD = {
  name: 'EvidenceRecord',
  fields: {
    claim: T.string({ min: 1, max: 2000 }),
    sourceUrl: T.nullable(T.string({ min: 1, max: 2048 })),
    sourceId: T.string({ min: 1, max: 200 }),
    sourceDate: T.nullable(T.string({ min: 4, max: 40 })),
    fetchedAt: T.number({ min: 0 }),
    /* 'fresh' | 'dated' | 'stale' | 'unknown' — a judgement about sourceDate
     * against the question's freshness window, made once, at record time. */
    freshness: T.enum(['fresh', 'dated', 'stale', 'unknown']),
    confidence: T.number({ min: 0, max: 1 }),
    /* Which retrieval produced it, so a contradiction can be traced back to the
     * provider that supplied each side of it. */
    via: T.string({ min: 1, max: 60 }),
  },
  optional: ['sourceDate'],
};

/** What the turn ledger stores about the answer it just wrote. */
const FINAL_ANSWER_META = {
  name: 'FinalAnswerMeta',
  fields: {
    operationId: T.string({ min: 1, max: 100 }),
    turnId: T.string({ min: 1, max: 100 }),
    model: T.nullable(T.string({ min: 1, max: 200 })),
    /* 'content' when the model wrote an answer, 'reasoning' when the answer was
     * rescued from excluded thinking (see lib/reasoning-rescue.js), 'cache'
     * when nothing was generated at all. The three are priced, trusted and
     * cached differently and used to be indistinguishable. */
    textSource: T.enum(['content', 'reasoning', 'cache', 'local', 'none']),
    category: T.string({ min: 1, max: 60 }),
    citations: T.arrayOf(T.string({ min: 1, max: 2048 }), { max: 50 }),
    evidenceIds: T.arrayOf(T.string({ min: 1, max: 100 }), { max: 200 }),
    confidence: T.nullable(T.number({ min: 0, max: 1 })),
    charCount: T.number({ min: 0, integer: true }),
  },
  optional: ['confidence'],
};

/**
 * The OTHER thing a `turns.meta` row can be: the operational record of a turn
 * that reached `turnLedger.begin`, built by lib/turn-reliability-meta.js.
 *
 * A SECOND SCHEMA RATHER THAN OPTIONAL FIELDS ON THE ONE ABOVE. FINAL_ANSWER_META
 * defends an invariant its own header states -- a ledger row that can be missing
 * its own operation id is not a ledger -- and loosening those five fields to
 * optional so one bag could carry both records would retire that invariant to
 * save a schema. The two are different records that happen to share a column.
 *
 * `reliability` is checked only for being an object here. Its shape is enforced
 * where it is built, by an allow-list that names every field and re-types every
 * value; a second field-by-field copy of that list would be a second thing to
 * keep in step, and the first one to fall behind.
 */
const TURN_RELIABILITY_META = {
  name: 'TurnReliabilityMeta',
  fields: {
    reliability: T.object(),
  },
  optional: [],
};

/**
 * The user-safe process record shares the existing turns.meta JSONB column
 * with reliability. Nested fields are already narrowed by the explicit
 * serializer in lib/turn-provenance-meta.js; this outer schema prevents an
 * arbitrary top-level bag from reaching the ledger.
 */
const TURN_PROVENANCE_META = {
  name: 'TurnProvenanceMeta',
  fields: {
    provenance: T.object(),
    reliability: T.object(),
  },
  optional: ['reliability'],
};

module.exports = {
  T,
  validate,
  coerce,
  assertValid,
  ROUTE_PLAN,
  TOOL_CALL,
  EVIDENCE_RECORD,
  FINAL_ANSWER_META,
  TURN_RELIABILITY_META,
  TURN_PROVENANCE_META,
};

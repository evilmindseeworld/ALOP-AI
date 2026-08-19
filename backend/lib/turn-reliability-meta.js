'use strict';

/**
 * THE OPERATIONAL RECORD OF ONE TURN, NARROWED TO WHAT A QUERY CAN USE.
 *
 * WHY THIS EXISTS AT ALL. Every measurement in this file was already being
 * taken — `lib/turn-telemetry.js` collects it for the whole turn — and then
 * thrown away, because the one `turnLedger.finish(...)` that closes the row
 * passed no `meta`. The only durable copy was `audit_logs.metadata`, which is
 * the wrong surface for three reasons that cannot be fixed by writing more into
 * it: it is written at most once per turn behind the audit latch, so its
 * coverage is whichever branch fired first; `metadata.seats` is a number in
 * historical rows and an array in newer ones, so no query can read both; and it
 * is user-visible through `audit_owner_read`. History there is not rewritten
 * and its RLS is not touched. `turns.meta.reliability` is the new surface.
 *
 * WHAT IT COVERS, EXACTLY. Every turn that reached `turnLedger.begin(...)`.
 * A request refused before that — a bad prompt, a blown ceiling, an auth
 * failure — has no `turns` row to carry meta, and that is deliberate and
 * unchanged. Do not read a rate out of this table as a rate over incoming
 * requests.
 *
 * AN ALLOW-LIST, NOT A SPREAD, AND THAT IS THE WHOLE DESIGN.
 *
 * The snapshot is a live object that other code adds fields to; `audit_logs`
 * also takes an `extra` bag that callers fill by hand. Spreading either into a
 * database column means the next person to add a field to telemetry decides,
 * without knowing it, what gets persisted forever. Every field below is named
 * here on purpose, every value is re-typed on the way out, and anything not
 * named is dropped. That is what makes it impossible for a prompt, an answer, a
 * draft, a provider body, an error string or a key to reach the column: not a
 * denylist of the things we thought of, but the absence of any path for an
 * unnamed field at all.
 *
 * WHAT IS DELIBERATELY ABSENT, because telemetry does not capture it today and
 * inventing a null field would be a claim that it does:
 *   - `complexity` and `councilRelease` (release reason / ms) live only in the
 *     audit row's hand-built `extra`, and are out of scope in the `finally`.
 *   - a seat's provider, attempt count and cut reason: `recordSeat` stores
 *     `{phase, round, model, ms, outcome}` and nothing else.
 *   - `finishReason`: `lib/model-reply.js` parses it, nothing records it.
 * Add the recorder first, then a field here, then bump `SCHEMA_VERSION`.
 *
 * BOUNDING. `recordProviderAttempt` and `recordStreamTiming` are capped inside
 * the recorder; `recordSeat` is NOT, so this file caps seats. A turn that
 * somehow logged a thousand seat records must not write a thousand-element
 * array into a row on the path that answers a user.
 */

/** Bump when a field changes meaning. Queries filter on it. */
const SCHEMA_VERSION = 1;

/* ponytail: a local persistence cap, not a council constant, because there is
 * no canonical one — `maxSeats` is derived per turn from the roster length in
 * lib/adaptive-routing.js and lib/progressive-council.js. 24 is several times
 * the largest real roster and still covers a turn that ran a search council, a
 * tool council and a plain council in sequence, each of which files its own
 * seat records. Raise it if a real turn is ever seen truncated. */
const MAX_SEAT_RECORDS = 24;

/** HTTP statuses a gateway can return, plus the recorder's 'none'. */
const MAX_STATUS_KEYS = 24;

/** Long enough for `vendor/model-name:free`, short enough to never be prose. */
const MAX_ID_CHARS = 120;

/** A classification, never a provider message. */
const MAX_REASON_CHARS = 60;

/**
 * A short identifier, or null.
 *
 * Everything that flows through here is a model id, a provider name, an
 * outcome or a classification — all of them ours or a gateway's short token.
 * Clipping is the backstop for the day one of those sources starts echoing the
 * request it refused.
 */
const id = (value, max = MAX_ID_CHARS) => (typeof value === 'string' && value ? value.slice(0, max) : null);

/**
 * A finite non-negative number, or null. Never a string, never NaN.
 *
 * ABSENT STAYS ABSENT. `Number(null)` is 0 and 0 is finite, so a null
 * `msToFirstByte` would come back as "answered instantly" -- the same trap
 * `recordStreamTiming` documents for `msToFirstToken`, and the same wrong
 * direction: it drags a percentile down instead of leaving it uncomputed.
 */
const ms = (value) => {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

/** A finite non-negative count. Absent reads as 0, which is honest for a count. */
const count = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** An HTTP status, or null. `recordStreamTiming` stores null when none arrived. */
const status = (value) => (Number.isFinite(value) ? Math.round(value) : null);

/**
 * `byStatus`, narrowed to status-shaped keys with non-negative counts.
 *
 * The recorder already builds this from `String(row.status)` or the literal
 * 'none', so in practice it is already clean. It is re-checked here because
 * this is the boundary at which a key becomes a column: an object with
 * arbitrary keys is exactly the shape that carries an injected string, and a
 * bounded key count is what stops it growing.
 */
function safeByStatus(source) {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  let kept = 0;
  for (const [key, value] of Object.entries(source)) {
    if (kept >= MAX_STATUS_KEYS) break;
    if (key !== 'none' && !/^[1-5][0-9]{2}$/.test(key)) continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) continue;
    out[key] = Math.round(n);
    kept += 1;
  }
  return out;
}

/** Synthesis runs under three phase names; all three are the same stage. */
const isSynthesisPhase = (phase) => typeof phase === 'string' && /synthesis$/.test(phase);

/**
 * Fold the router's provider attempts into one lifecycle record.
 *
 * The LAST attempt is the one that decided the turn — the earlier ones are
 * retries — so its model, status and outcome are the ones worth keeping, while
 * `attempts` and `durationMs` are the whole chain.
 */
function routerLifecycle(detail) {
  const rows = detail.filter((row) => row && row.phase === 'router');
  if (rows.length === 0) return null;
  const last = rows[rows.length - 1];
  return {
    model: id(last.model),
    provider: id(last.provider),
    status: status(last.status),
    outcome: id(last.outcome, MAX_REASON_CHARS),
    attempts: rows.length,
    durationMs: rows.reduce((n, row) => n + count(row.ms), 0),
  };
}

/**
 * The synthesis stage, assembled from the three recorders that each hold a
 * piece of it.
 *
 * `streamTimings` has the stream lifecycle, `providerAttempts.detail` has how
 * many physical requests it took, `usage.byPhase.synthesis` has the tokens and
 * `synthesisModel` is the rung that actually wrote the answer. Null when the
 * turn never got as far as synthesising — a cache hit, a greeting, an abort
 * during the council — because a zeroed object would read as a synthesis that
 * took no time.
 */
function synthesisLifecycle(snapshot, detail) {
  const timings = (Array.isArray(snapshot.streamTimings) ? snapshot.streamTimings : [])
    .filter((row) => row && isSynthesisPhase(row.phase));
  const attempts = detail.filter((row) => row && isSynthesisPhase(row.phase));
  const model = id(snapshot.synthesisModel) || id(timings[timings.length - 1]?.model);
  if (timings.length === 0 && attempts.length === 0 && !model) return null;

  const last = timings[timings.length - 1] || null;
  const usage = snapshot.usage && snapshot.usage.byPhase ? snapshot.usage.byPhase.synthesis : null;
  return {
    model,
    provider: id(last?.provider) || id(attempts[attempts.length - 1]?.provider),
    status: status(last?.status ?? attempts[attempts.length - 1]?.status),
    outcome: id(last?.outcome ?? attempts[attempts.length - 1]?.outcome, MAX_REASON_CHARS),
    attempts: attempts.length,
    /* The stream split at the two boundaries that tell a queued provider from a
     * slow one. `msToFirstToken` stays null when the stream emitted no content:
     * 0 would read as an instant answer, which is the opposite of what it was. */
    streamOpenMs: ms(last?.streamOpenMs),
    msToFirstToken: last && last.msToFirstToken != null ? ms(last.msToFirstToken) : null,
    streamBodyMs: ms(last?.streamBodyMs),
    streamTotalMs: ms(last?.streamTotalMs),
    /* Wall time for the whole stage, including any rungs before the last. */
    durationMs: ms(snapshot.synthesisMs),
    completionTokens: usage ? count(usage.completionTokens) : null,
    completed: last ? Boolean(last.completed) : null,
    aborted: last ? Boolean(last.aborted) : null,
    /* WHICH abort. `turn_deadline` means the budget is binding; `client` means
     * the user left and nothing is wrong. One number for both hides the first. */
    abortReason: id(last?.abortReason, MAX_REASON_CHARS),
  };
}

/**
 * Build the versioned reliability namespace for one finished turn.
 *
 * @param {object} snapshot the FINAL `telemetry.snapshot(...)`, taken at the
 *        close of the turn — not one carried from an earlier branch, or
 *        everything recorded after that branch is missing.
 * @returns {{reliability: object}} ready to hand to `turnLedger.finish`.
 */
function buildTurnReliabilityMeta(snapshot) {
  const s = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const attempts = s.providerAttempts && typeof s.providerAttempts === 'object' ? s.providerAttempts : {};
  const detail = Array.isArray(attempts.detail) ? attempts.detail : [];

  /* ALWAYS AN ARRAY. `audit_logs.metadata.seats` is a number in some historical
   * rows and an array in others, and that single inconsistency is why no query
   * could ever read the whole table. The count lives in its own field so the
   * two can never trade places. */
  const allSeats = Array.isArray(s.seats) ? s.seats : [];
  const seats = allSeats.slice(0, MAX_SEAT_RECORDS).map((seat) => ({
    model: id(seat && seat.model),
    phase: id(seat && seat.phase, MAX_REASON_CHARS),
    round: count(seat && seat.round),
    durationMs: count(seat && seat.ms),
    outcome: id(seat && seat.outcome, MAX_REASON_CHARS),
    /* DERIVED, and named so it cannot be confused with something the recorder
     * stores. `answered` is the only seat outcome whose draft reached the
     * synthesis; `quorum`, `timed_out`, `aborted`, `empty`, `skipped` and
     * `failed` all mean the seat was paid for and not used. */
    usable: (seat && seat.outcome) === 'answered',
  }));

  return {
    reliability: {
      schemaVersion: SCHEMA_VERSION,
      /* Which branch of the route this turn took, from the snapshot call at the
       * close — 'council', 'settle', 'aborted' and so on. */
      category: id(s.category, MAX_REASON_CHARS) || 'unknown',
      turnMs: count(s.turnMs),
      msToFirstByte: ms(s.msToFirstByte),
      aborted: Boolean(s.aborted),
      /* Why it stopped, when it did. `client_disconnected` and a deadline are
       * different problems with different fixes and used to be one flag. */
      abortReason: id(s.cancellation && s.cancellation.reason, MAX_REASON_CHARS),
      providerAttempts: {
        total: count(attempts.total),
        ok: count(attempts.ok),
        failed: count(attempts.failed),
        retries: count(attempts.retries),
        /* The field the whole exercise turned on: a 429 wants pacing and a 5xx
         * wants nothing, and `byOutcome` collapsed both to `http_error`. */
        byStatus: safeByStatus(attempts.byStatus),
        truncatedDetail: Boolean(attempts.truncatedDetail),
      },
      router: routerLifecycle(detail),
      council: {
        seatCount: allSeats.length,
        usableCount: allSeats.filter((seat) => seat && seat.outcome === 'answered').length,
        /* True when this row's `seats` array is shorter than `seatCount`, so a
         * query can tell a small council from a truncated record. */
        seatsTruncated: allSeats.length > MAX_SEAT_RECORDS,
      },
      seats,
      synthesis: synthesisLifecycle(s, detail),
    },
  };
}

module.exports = {
  buildTurnReliabilityMeta,
  SCHEMA_VERSION,
  MAX_SEAT_RECORDS,
  MAX_STATUS_KEYS,
};

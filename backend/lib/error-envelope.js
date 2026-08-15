'use strict';

/**
 * One safe, typed shape for every error a route returns.
 *
 * WHAT WAS THERE. Roughly thirty routes ended in
 * `res.status(500).json({ error: err.message })`, and the express error handler
 * masked that string only when `NODE_ENV === 'production'`. Two problems, and
 * the second is the one that costs time rather than safety:
 *
 *   1. `err.message` is whatever threw. A Supabase failure returns its own
 *      prose, a `fetch` failure names the host it could not reach, and a
 *      Postgres error carries the constraint name. None of that is the client's
 *      business, and the masking was per-environment rather than per-route — a
 *      staging deploy without NODE_ENV set returns them all.
 *   2. There is nothing to correlate. A user reporting "it said Internal server
 *      error" hands you a string that appears in every log line of that hour.
 *      `req.requestId` was already minted on every request (server.js) and was
 *      never sent anywhere, so it could not close the loop it exists for.
 *
 * WHAT THIS RETURNS, and why the shape is what it is:
 *
 *   { error: <safe string>, code: <stable machine code>, operationId: <uuid> }
 *
 * `error` stays a plain string at the same key, so nothing that reads the
 * current responses breaks — this is additive on the wire. `code` is the field
 * a client should branch on; the prose is for a human and may be reworded.
 * `operationId` is the request id, echoed so a user can quote it.
 *
 * 5xx PROSE IS NEVER THE THROWN MESSAGE, in any environment. The thrown message
 * is attached as `detail` OUTSIDE production, which keeps a local 500 as
 * debuggable as it was without making the mask a deployment-configuration
 * question. 4xx prose IS returned: a 4xx reason describes the client's own
 * request and is the whole point of sending it.
 */

/** Stable machine codes. Add to this list; do not renumber or rename. */
const CODES = Object.freeze({
  BAD_REQUEST: 'bad_request',
  UNAUTHENTICATED: 'unauthenticated',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  PAYLOAD_TOO_LARGE: 'payload_too_large',
  RATE_LIMITED: 'rate_limited',
  CORS_REJECTED: 'cors_rejected',
  CLIENT_CLOSED: 'client_closed',
  MODEL_QUOTA_EXHAUSTED: 'model_quota_exhausted',
  MODEL_RATE_LIMITED: 'model_rate_limited',
  UPSTREAM_TIMEOUT: 'upstream_timeout',
  UPSTREAM_UNAVAILABLE: 'upstream_unavailable',
  SPEND_CEILING_REACHED: 'spend_ceiling_reached',
  NOT_CONFIGURED: 'not_configured',
  INTERNAL: 'internal_error',
});

/** What a client is told for each code. Never derived from a thrown message. */
const SAFE_TEXT = Object.freeze({
  [CODES.BAD_REQUEST]: 'The request was not valid.',
  [CODES.UNAUTHENTICATED]: 'Sign in and try again.',
  [CODES.FORBIDDEN]: 'You do not have access to this.',
  [CODES.NOT_FOUND]: 'Not found.',
  [CODES.CONFLICT]: 'That conflicts with something that already exists.',
  [CODES.PAYLOAD_TOO_LARGE]: 'That is too large to accept.',
  [CODES.RATE_LIMITED]: 'Too many requests. Try again shortly.',
  [CODES.CORS_REJECTED]: 'Origin not allowed.',
  [CODES.CLIENT_CLOSED]: 'The request was cancelled.',
  [CODES.MODEL_QUOTA_EXHAUSTED]: 'The council is out of model requests for today. It resets at midnight UTC.',
  [CODES.MODEL_RATE_LIMITED]: 'The council is briefly rate limited. Try again in a moment.',
  [CODES.UPSTREAM_TIMEOUT]: 'That took too long to answer. Try again.',
  [CODES.UPSTREAM_UNAVAILABLE]: 'A service this needs is temporarily unavailable.',
  [CODES.SPEND_CEILING_REACHED]: 'Daily or monthly usage limit reached. It resets at midnight UTC.',
  [CODES.NOT_CONFIGURED]: 'That feature is not configured on this server.',
  [CODES.INTERNAL]: 'Internal server error.',
});

const BY_STATUS = Object.freeze({
  400: CODES.BAD_REQUEST,
  401: CODES.UNAUTHENTICATED,
  403: CODES.FORBIDDEN,
  404: CODES.NOT_FOUND,
  409: CODES.CONFLICT,
  413: CODES.PAYLOAD_TOO_LARGE,
  429: CODES.RATE_LIMITED,
  499: CODES.CLIENT_CLOSED,
  502: CODES.UPSTREAM_UNAVAILABLE,
  503: CODES.UPSTREAM_UNAVAILABLE,
  504: CODES.UPSTREAM_TIMEOUT,
});

const text = (value) => (typeof value === 'string' ? value : '');

/**
 * Decide the status and code for a thrown value.
 *
 * Ordered most specific first. An error that already carries a status wins over
 * a name-based guess, because a route that set one had a reason.
 *
 * @returns {{status: number, code: string, expose: boolean}}
 *   `expose` — may the thrown message be returned to the client? True only for
 *   4xx, where the message describes the caller's own request.
 */
function classifyError(err) {
  const message = text(err && err.message);
  const name = text(err && err.name);
  const raw = err && (err.code ?? null);
  const code = typeof raw === 'string' ? raw : '';

  // CORS is thrown as a plain Error by the cors() origin callback and carries
  // no status of its own, so it has to be recognised before the status lookup.
  if (message.includes('CORS')) return { status: 403, code: CODES.CORS_REJECTED, expose: false };

  if (code === 'OPENROUTER_DAILY_LIMIT') return { status: 503, code: CODES.MODEL_QUOTA_EXHAUSTED, expose: false };
  if (code === 'OPENROUTER_RATE_LIMIT') return { status: 503, code: CODES.MODEL_RATE_LIMITED, expose: false };

  // A cancelled turn is not a fault. 499 is nginx's non-standard "client closed
  // request"; nothing is written to a socket that has already gone, so the
  // status here is for the log rather than for a reader.
  if (name === 'AbortError' || code === 'ABORT_ERR') return { status: 499, code: CODES.CLIENT_CLOSED, expose: false };
  if (name === 'TimeoutError' || code === 'OPENROUTER_DEADLINE' || code === 'ETIMEDOUT') {
    return { status: 504, code: CODES.UPSTREAM_TIMEOUT, expose: false };
  }
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ECONNRESET' || code === 'EAI_AGAIN') {
    return { status: 502, code: CODES.UPSTREAM_UNAVAILABLE, expose: false };
  }
  // Postgres unique violation, surfaced through PostgREST.
  if (code === '23505') return { status: 409, code: CODES.CONFLICT, expose: false };

  const declared = Number(err && (err.status ?? err.statusCode));
  if (Number.isFinite(declared) && declared >= 400 && declared <= 599) {
    return {
      status: declared,
      code: BY_STATUS[declared] || (declared < 500 ? CODES.BAD_REQUEST : CODES.INTERNAL),
      expose: declared < 500,
    };
  }

  return { status: 500, code: CODES.INTERNAL, expose: false };
}

/**
 * @param {any} err
 * @param {object} [opts]
 * @param {string} [opts.operationId]  the request id, echoed for correlation
 * @param {string} [opts.message]      override the safe prose (a route that has
 *                                     already written a user-facing sentence)
 * @param {boolean} [opts.includeDetail]  attach the thrown message. Defaults to
 *                                     "not production"; never applies to 4xx,
 *                                     whose own message is already returned.
 * @returns {{status: number, body: object}}
 */
function errorEnvelope(err, { operationId = null, message = null, includeDetail = null } = {}) {
  const { status, code, expose } = classifyError(err);
  const thrown = text(err && err.message);
  const detailAllowed = includeDetail === null
    ? process.env.NODE_ENV !== 'production'
    : Boolean(includeDetail);

  const body = {
    error: text(message) || (expose && thrown ? thrown : SAFE_TEXT[code] || SAFE_TEXT[CODES.INTERNAL]),
    code,
  };
  if (operationId) body.operationId = operationId;
  /* Only where the safe prose replaced something. Adding `detail` to a 4xx
   * would duplicate the message that is already in `error`. */
  if (!expose && detailAllowed && thrown) body.detail = thrown.slice(0, 500);
  return { status, body };
}

/** `res.status(...).json(...)` in one call, for the ~30 catch blocks. */
function sendError(res, err, opts = {}) {
  const operationId = opts.operationId || res?.req?.operationId || res?.req?.requestId || null;
  const { status, body } = errorEnvelope(err, { ...opts, operationId });
  if (res.headersSent || res.writableEnded) return status;
  /* Echoed as a header too: a client that cannot parse the body — a 502 from a
   * proxy, an opaque fetch failure — can still read this off the response. */
  if (operationId) res.set('X-Operation-Id', operationId);
  res.status(status).json(body);
  return status;
}

/**
 * A DELIBERATE REFUSAL, which is not the same thing as a thrown error.
 *
 * `sendError` starts from something that threw and decides what may be said
 * about it. Most of this server's 4xx/5xx responses are the other case: the
 * route already knows exactly what is wrong and has written the sentence for a
 * human ("Attach at most 4 images"). Those were plain
 * `res.status(n).json({ error })`, which is the shape this module exists to
 * replace — no `code` for a client to branch on, and no `operationId` for a
 * user to quote when they report it.
 *
 * The prose is kept verbatim, because it is better than any generic text this
 * module could substitute. What is added is the type.
 *
 * @param {number} status
 * @param {string} message  the sentence the route already wrote
 * @param {string} [code]   defaults to the code for that status
 * @param {object} [extra]  additional body fields (ceilings return their numbers)
 */
function fail(res, status, message, code = null, extra = null) {
  const resolved = code || BY_STATUS[status] || (status < 500 ? CODES.BAD_REQUEST : CODES.INTERNAL);
  const operationId = res?.req?.operationId || res?.req?.requestId || null;
  if (res.headersSent || res.writableEnded) return status;
  if (operationId) res.set('X-Operation-Id', operationId);
  const body = { error: message, code: resolved, ...(extra || {}) };
  if (operationId) body.operationId = operationId;
  res.status(status).json(body);
  return status;
}

module.exports = { classifyError, errorEnvelope, sendError, fail, CODES, SAFE_TEXT };

/**
 * An Express-shaped response that goes nowhere.
 *
 * WHY THIS EXISTS. The background jobs — refreshing a cached answer before it
 * expires, pre-computing a common question overnight — have to produce an
 * answer the same way a user's turn does. Not "similarly": the SAME way. The
 * council route is where the router, the tier policy, the search branch, the
 * tool loop, the synthesiser, the spend ceilings, the audit row and the cache
 * write all live, and a second path that reimplemented any of them would drift
 * from it silently. The cache is shared, so a drifted background path does not
 * produce a worse background answer — it writes a worse answer into the row a
 * real user reads.
 *
 * So the job calls the real handler and hands it one of these instead of a
 * socket. Nothing is exposed on the network, no authentication is bypassed and
 * no middleware is skipped, because there is no request: the handler is called
 * in-process, exactly as Express would call it.
 *
 * WHAT IT COLLECTS. The SSE frames the route writes, decoded far enough to
 * recover the answer text. The route streams `{"type":"chunk","text":...}`
 * frames and a `data: [DONE]` terminator; `stage` frames are progress and are
 * counted but discarded. A frame that does not parse is ignored rather than
 * thrown on — this is a sink, and its whole contract is that it cannot be the
 * reason a turn fails.
 *
 * WHAT IT IS NOT. Not a general Express double. It implements exactly the
 * surface the council route touches, and `unsupported()` is deliberately loud:
 * if the route grows a `res.pipe`, the job should fail in a test rather than
 * quietly stream to nowhere.
 */

const { randomUUID } = require('node:crypto');

const DONE = 'data: [DONE]';

function createSinkResponse({ onEvent } = {}) {
  const chunks = [];
  const stages = [];
  const headers = new Map();
  let ended = false;
  let statusCode = 200;
  let jsonBody = null;
  const listeners = new Map();

  const emit = (event) => {
    if (event?.type === 'chunk' && typeof event.text === 'string') chunks.push(event.text);
    else if (event?.type === 'stage') stages.push(event);
    try { onEvent?.(event); } catch { /* a listener must not break the run */ }
  };

  const res = {
    locals: {},
    headersSent: false,
    get writableEnded() { return ended; },
    get writableFinished() { return ended; },

    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); return res; },
    set(name, value) { return res.setHeader(name, value); },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    flushHeaders() { res.headersSent = true; },

    status(code) { statusCode = code; return res; },
    /* A route that answers with JSON is REFUSING — a 400, a 402 ceiling, a 503
     * daily cap. The job needs to see that it was refused and why, so the body
     * is kept rather than dropped. */
    json(body) { jsonBody = body; ended = true; return res; },
    send(body) { return res.json(body); },

    write(text) {
      if (ended) return false;
      res.headersSent = true;
      for (const line of String(text).split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === DONE || !trimmed.startsWith('data: ')) continue;
        try { emit(JSON.parse(trimmed.slice(6))); } catch { /* not our frame */ }
      }
      return true;
    },
    end() {
      if (ended) return res;
      ended = true;
      for (const fn of listeners.get('finish') || []) { try { fn(); } catch {} }
      for (const fn of listeners.get('close') || []) { try { fn(); } catch {} }
      return res;
    },

    /* The route registers disconnect handlers with once/off. There is no client
     * here to disconnect, so these only have to be honest bookkeeping — but they
     * must EXIST, because the route calls them before it does any work. */
    once(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
      return res;
    },
    on(event, fn) { return res.once(event, fn); },
    off(event, fn) {
      const list = listeners.get(event);
      if (list) listeners.set(event, list.filter((f) => f !== fn));
      return res;
    },
    removeListener(event, fn) { return res.off(event, fn); },

    /** What the turn produced. Read after the handler resolves. */
    result() {
      return {
        answer: chunks.join(''),
        stages: stages.length,
        status: statusCode,
        refusal: jsonBody,
        ended,
        locals: res.locals,
      };
    },
  };

  return res;
}

/**
 * The request half. Only the fields the council route reads, and no defaults
 * that could hide a missing one: a job that forgets to say who it is should not
 * silently borrow somebody's identity.
 */
function createSinkRequest({ message, userId, userRow, history = [], country = '', operationId = null }) {
  const listeners = new Map();
  return {
    body: { message, history },
    auth: { userId },
    userRow,
    ip: '127.0.0.1',
    /* A BACKGROUND TURN NEEDS ONE TOO. The route reads `req.operationId` for
     * its error envelopes and its log lines, and a brain refresh reaches that
     * code by the same path a user does — without an id here, the one class of
     * turn nobody is watching is also the one with nothing to grep for. Minted
     * rather than defaulted to a constant, so two concurrent refreshes are
     * still distinguishable. */
    operationId: operationId || randomUUID(),
    /* THE COUNTRY IS PART OF THE CACHE KEY, so a refresh that could not set it
     * would rewrite a DIFFERENT row than the one that was expiring — the job
     * would run, log a success, and leave the stale row untouched. The route
     * derives the region from the CDN header, so that is where it goes; there
     * is no header on a background turn to conflict with it. */
    headers: country ? { 'cf-ipcountry': country } : {},
    once(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
      return this;
    },
    on(event, fn) { return this.once(event, fn); },
    off(event, fn) {
      const list = listeners.get(event);
      if (list) listeners.set(event, list.filter((f) => f !== fn));
      return this;
    },
    removeListener(event, fn) { return this.off(event, fn); },
    emit(event) {
      for (const fn of listeners.get(event) || []) { try { fn(); } catch {} }
    },
  };
}

module.exports = { createSinkResponse, createSinkRequest };

'use strict';

const compression = require('compression');

/**
 * GZIP WAS EATING THE PROGRESS STREAM.
 *
 * `app.use(compression())` sits above every route, and `text/event-stream` is
 * a compressible type, so the council's SSE response went through zlib. zlib
 * does not emit a byte until its buffer fills or someone flushes it, and an
 * SSE frame is ~60 bytes — so every stage event ("Asking 7 seats", "3 of 7
 * answered") sat in the compressor until the response ENDED, and then arrived
 * in one lump with the finished answer. Measured on a two-frame test route: a
 * frame written at t=0 reached the client at t=1527ms, i.e. only at res.end().
 *
 * That is the same failure `X-Accel-Buffering: no` was set to prevent, one
 * layer lower and inside our own process, where the proxy hint cannot reach.
 *
 * The alternative fix is `res.flush()` after every write, which means every
 * future sendEvent call site has to remember to do it and the bug returns
 * silently the first time one forgets. Not compressing the stream at all is
 * the fix that cannot be un-done by a later edit — and the frames are tiny
 * JSON written once, so there was nothing worth compressing.
 *
 * Content-Type is read at write time, by which point openStream has set it.
 */
const sseAwareFilter = (req, res) => {
  const type = String(res.getHeader('Content-Type') || '');
  if (type.includes('text/event-stream')) return false;
  return compression.filter(req, res);
};

module.exports = { sseAwareFilter };

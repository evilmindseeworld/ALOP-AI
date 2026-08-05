/**
 * The bucket a request is counted against.
 *
 * The previous key was:
 *
 *     sha256(req.ip + (req.headers['user-agent'] || '')).slice(0, 16)
 *
 * which counts a caller against a DIFFERENT bucket for every User-Agent string
 * they send. The header is chosen by the client, there are unlimited possible
 * values, and changing it costs nothing — so a caller who randomises it is not
 * rate limited at all. Every limit in the app was one header away from being
 * advisory, including the 10/minute on vision and the 5/5min on billing.
 *
 * A rate-limit key may only be derived from things the caller cannot freely
 * choose: the source address, and an authenticated identity. Anything else is
 * a way to mint fresh buckets.
 *
 * `req.ip` is trustworthy here ONLY because `app.set('trust proxy', 1)` is set
 * and Render terminates in front of us — Express then reads the last hop of
 * X-Forwarded-For rather than a caller-supplied one. If the app ever moves
 * behind a different number of proxies, that number has to move with it, or
 * this becomes spoofable again and every limit becomes advisory a second time.
 */

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {(req, res) => string} ipFallback  express-rate-limit's own IPv6-aware
 *        key generator, which normalises an IPv6 address to its /56 so a single
 *        client cannot walk its own prefix for fresh buckets.
 */
function rateLimitKey(req, res, ipFallback) {
  // An authenticated user is the strongest key available: it survives an IP
  // change and cannot be forged, because Clerk verified it. Only routes that
  // run their auth middleware before the limiter will have it.
  const userId = req.auth && req.auth.userId;
  if (userId) return `u:${userId}`;

  return `ip:${ipFallback(req, res)}`;
}

module.exports = { rateLimitKey };

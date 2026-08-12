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
/**
 * `req.auth` IS A FUNCTION IN @clerk/express 2.x, NOT AN OBJECT, and reading
 * `.userId` off it silently yields `undefined`.
 *
 * This is the whole reason the per-user keying never worked. The codebase says
 * in several places that the limiters key on `u:<userId>` now — lib/spend.js's
 * header says it as settled fact — and every one of those claims was false:
 * `clerkMiddleware` assigns `brandRequestAuth((opts) => requestState.toAuth(opts))`
 * (node_modules/@clerk/express/dist/index.js:211), so `req.auth.userId` is a
 * property lookup on a function object. It is always undefined, the fallback
 * always fires, and every limit has been keyed on IP the entire time — which is
 * precisely the defect the change was written to fix.
 *
 * IT PASSED ITS TEST BECAUSE THE TEST BUILT THE WRONG SHAPE. The fixture passed
 * a plain `{ auth: { userId } }`, which no Clerk version produces here. A fake
 * that shares an interface with nothing real proves nothing, and the test now
 * uses the installed `brandRequestAuth` so it cannot drift from the library
 * again.
 *
 * Both shapes are accepted rather than only the current one: `requireAuth`
 * REPLACES the function with a resolved auth object later in the chain
 * (server.js), so a limiter mounted after it legitimately sees an object. A key
 * generator that handled only one shape would be wrong for half the routes.
 *
 * The call is wrapped because `req.auth()` throws when the request carries no
 * session, and an unauthenticated caller must fall through to the IP key rather
 * than take the whole limiter down with a 500.
 */
function clerkUserId(req) {
  const auth = req && req.auth;
  if (!auth) return null;
  if (typeof auth === 'function') {
    try {
      return auth()?.userId || null;
    } catch {
      return null;
    }
  }
  return auth.userId || null;
}

function rateLimitKey(req, res, ipFallback) {
  // An authenticated user is the strongest key available: it survives an IP
  // change and cannot be forged, because Clerk verified it. Only routes that
  // run their auth middleware before the limiter will have it.
  const userId = clerkUserId(req);
  if (userId) return `u:${userId}`;

  return `ip:${ipFallback(req, res)}`;
}

module.exports = { rateLimitKey, clerkUserId };

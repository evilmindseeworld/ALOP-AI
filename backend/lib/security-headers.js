'use strict';

/**
 * The helmet options, lifted out of `server.js` so they can be asserted through
 * a real request instead of by reading the source.
 *
 * WHY THIS FILE EXISTS. Two of these options were wrong, and one of them was
 * wrong SILENTLY — the kind of defect a source grep confirms rather than
 * catches, because the source says the right word and the wire says something
 * else. A header contract has to be checked at the wire.
 *
 * ---
 *
 * `xFrameOptions` TOOK A STRING AND HELMET IGNORED IT.
 *
 * `xFrameOptions: 'DENY'` is not the option shape helmet 8 accepts, and helmet
 * does not complain: it falls through to its own default, which is SAMEORIGIN.
 * Reproduced locally against helmet 8.3.0 —
 *
 *   default (no option)              X-Frame-Options = SAMEORIGIN
 *   xFrameOptions: 'DENY'            X-Frame-Options = SAMEORIGIN
 *   xFrameOptions: { action: 'deny' } X-Frame-Options = DENY
 *
 * — and confirmed on the deployed backend, which was serving SAMEORIGIN while
 * this codebase read as if it were serving DENY. Impact is small in practice
 * because `frame-ancestors 'none'` in the CSP below covers every browser that
 * matters, and the two are redundant on purpose. But a line that states an
 * intent it does not carry out is worse than a missing line, because it stops
 * anyone from looking again.
 *
 * ---
 *
 * `script-src` IS NOW 'none', WHERE IT USED TO CARRY 'unsafe-inline'.
 *
 * This CSP travels on API responses. The backend serves JSON and SSE: zero HTML
 * routes, zero `<script>` tags anywhere in `server.js`, no `express.static`, no
 * `sendFile`. So the old `script-src 'self' 'unsafe-inline' https://*.clerk.com`
 * was permission for a thing that does not exist — dead until the day some
 * route returns HTML, at which point it is live and nobody re-reads a CSP that
 * was already there. Express's own error handler already returns HTML.
 *
 * IT IS NOT THE CSP THAT WAS SUSPECTED, and that correction is the useful part.
 * The `'unsafe-inline'` was found by reading this file and assumed to be
 * governing the app's scripts. It never was. The document CSP is set by
 * `frontend/vercel.json` on the Vercel response, and measured on the live site
 * it is already clean:
 *
 *   script-src 'self' https://clerk.alop-ai.com https://challenges.cloudflare.com
 *
 * No `'unsafe-inline'`, no nonce, and no violations: loaded on production with
 * a `securitypolicyviolation` listener attached, Clerk initialised and the app
 * rendered with zero reports. The page ships exactly one inline block, a
 * `application/ld+json` data block, which is not executable and which
 * `script-src` does not govern. Clerk arrives as an external script from an
 * allowlisted origin, so it needs neither the inline permission nor a nonce.
 *
 * If a backend HTML route is ever added, raise this to `'self'` deliberately
 * and say why — do not restore `'unsafe-inline'`.
 */
const helmetOptions = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", process.env.FRONTEND_URL, 'https://*.clerk.com', 'https://*.stripe.com'],
      scriptSrc: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'https://image.pollinations.ai'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      frameAncestors: ["'none'"],
      formAction: ["'self'", 'https://*.stripe.com'],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xContentTypeOptions: true,
  xFrameOptions: { action: 'deny' },
  xPermittedCrossDomainPolicies: 'none',
};

module.exports = { helmetOptions };

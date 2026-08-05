/**
 * Which Origins may talk to this API.
 *
 * This replaces a substring test that was wrong in two independent ways:
 *
 *     if (origin.toLowerCase().includes('.vercel.app')) return allow;
 *
 *   1. `includes` is not a host check. `https://vercel-app.attacker.com` does
 *      not contain the string, but `https://x.vercel.app.attacker.com` does,
 *      and so does `https://attacker.com/?x=.vercel.app`. Anyone could pick a
 *      hostname that satisfies it.
 *   2. Even a correct `.vercel.app` suffix test allows EVERY deployment on
 *      Vercel, by anyone. The CORS config sets `credentials: true`, so that is
 *      a standing invitation for any vercel.app page to make authenticated
 *      cross-origin calls and read the replies.
 *
 * The fix is to parse the Origin and compare its HOST — never the raw string —
 * against an explicit allowlist. A URL parser resolves userinfo (`https://
 * good.example@evil.com`), ports, case and encoding the same way the browser
 * did when it wrote the header; substring matching resolves none of them.
 *
 * Suffixes must be written with their leading dot (`.foo.vercel.app`) so that
 * a suffix can never match the bare parent domain, and `evilfoo.vercel.app`
 * can never satisfy a rule meant for `foo.vercel.app`.
 */

/** Hosts that may be served over plain http. Everything else must be https. */
const INSECURE_OK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The host of a URL string, lowercased, or null if it will not parse. */
const hostOf = (value) => {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
};

/**
 * @param {string|undefined} origin  the request's Origin header
 * @param {object} opts
 * @param {string[]} opts.exact      full origins allowed outright (FRONTEND_URL)
 * @param {string[]} opts.suffixes   host suffixes, each starting with "."
 * @param {boolean}  opts.allowAll   development escape hatch
 * @returns {boolean}
 */
function isOriginAllowed(origin, { exact = [], suffixes = [], allowAll = false } = {}) {
  // Same-origin requests, curl, and server-to-server calls send no Origin at
  // all. Rejecting those would break the health check and every webhook; CORS
  // is a browser mechanism and has nothing to say about them.
  if (!origin) return true;
  if (allowAll) return true;

  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  const host = url.host.toLowerCase();
  const hostname = url.hostname.toLowerCase();

  // A `null` Origin is sent by sandboxed iframes and by some file:// contexts.
  // It is not a host and must never be matched by a suffix rule.
  if (origin === "null" || !host) return false;

  if (url.protocol !== "https:" && !INSECURE_OK.has(hostname)) return false;

  // Credentials in the Origin are never sent by a real browser. Their presence
  // means the value was hand-made, and the only reason to hand-make one is to
  // put a trusted host on the left of an @.
  if (url.username || url.password) return false;

  if (exact.some((allowed) => hostOf(allowed) === host)) return true;

  return suffixes.some((suffix) => {
    const s = suffix.toLowerCase();
    // A suffix without its dot would let `evil-alop-ai.vercel.app` satisfy a
    // rule written for `alop-ai.vercel.app`.
    if (!s.startsWith(".")) return false;
    return host.endsWith(s);
  });
}

/**
 * Read the allowlist out of the environment.
 *
 * Defaults to FRONTEND_URL alone. Preview deployments need
 * ALLOWED_ORIGIN_SUFFIXES set explicitly — an unset variable must never widen
 * access, because the whole class of bug being fixed here is a default that
 * was wider than anyone realised.
 */
function originPolicyFromEnv(env = process.env) {
  return {
    exact: env.FRONTEND_URL ? [env.FRONTEND_URL] : [],
    suffixes: (env.ALLOWED_ORIGIN_SUFFIXES || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    allowAll: env.NODE_ENV === "development",
  };
}

module.exports = { isOriginAllowed, originPolicyFromEnv };

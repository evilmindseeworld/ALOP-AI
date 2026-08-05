/**
 * Who may reach the admin console.
 *
 * `is_admin` is not enough. It is a database column: anyone who can write to
 * the users table — a SQL injection anywhere, a leaked service-role key, a
 * future admin-management screen with a bug — can grant it. The console reads
 * process state and audit history, so the bar for reaching it should be higher
 * than the bar for reaching the admin panel.
 *
 * FOUR CONDITIONS, ALL REQUIRED. They are deliberately of different KINDS, so
 * that compromising one does not imply the others:
 *
 *   1. A valid Clerk session          — something you logged into
 *   2. is_admin on the user row       — something the database says
 *   3. Clerk id in TERMINAL_ADMINS    — something only a deploy can change
 *   4. A matching TERMINAL_SECRET     — something you type, held nowhere
 *
 * (3) is the one that makes it yours. A second admin, or a newly-flipped
 * is_admin flag, still fails it: the allowlist lives in the environment, so
 * changing it requires access to Render, not to the database.
 *
 * (4) is the one that survives a stolen session. A hijacked cookie or a leaked
 * token satisfies 1-3 and stops here, because the secret is never stored in the
 * browser — it is typed per session and held in memory.
 *
 * FAILS CLOSED. If TERMINAL_ADMINS or TERMINAL_SECRET is unset, the console is
 * disabled outright rather than falling back to is_admin. An unconfigured
 * security control must never be an open one, and the most likely way this
 * feature gets dangerous is someone deploying it before setting the variables.
 */

/** Constant-time compare, so a wrong secret cannot be found a byte at a time. */
function safeEqual(a, b) {
  const x = typeof a === "string" ? a : "";
  const y = typeof b === "string" ? b : "";
  // Lengths are compared without an early return; an early one leaks the
  // length, which is a real if slow oracle.
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length, 1);
  for (let i = 0; i < n; i++) diff |= x.charCodeAt(i % (x.length || 1)) ^ y.charCodeAt(i % (y.length || 1));
  return diff === 0 && x.length === y.length && x.length > 0;
}

/** Comma-separated Clerk user ids. */
const parseAdmins = (raw) =>
  (typeof raw === "string" ? raw : "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * @returns {{enabled: boolean, reason?: string}}
 */
function terminalConfig(env = process.env) {
  const admins = parseAdmins(env.TERMINAL_ADMINS);
  const secret = typeof env.TERMINAL_SECRET === "string" ? env.TERMINAL_SECRET : "";

  if (!admins.length) return { enabled: false, reason: "TERMINAL_ADMINS is not set" };
  // A short secret is worse than none, because it looks configured. 24 is
  // arbitrary but well past anything guessable at the rate limit below.
  if (secret.length < 24) return { enabled: false, reason: "TERMINAL_SECRET is missing or shorter than 24 characters" };
  return { enabled: true, admins, secret };
}

/**
 * @param {object} input
 * @param {string} input.clerkUserId  from the verified session
 * @param {boolean} input.isAdmin     from the users row
 * @param {string} input.secret       from the request header
 * @returns {{allowed: boolean, reason: string}}
 *   `reason` is for the AUDIT LOG, not for the caller. Telling a rejected
 *   caller which of the four conditions they failed is a map of the lock.
 */
function checkTerminalAccess({ clerkUserId, isAdmin, secret } = {}, env = process.env) {
  const cfg = terminalConfig(env);
  if (!cfg.enabled) return { allowed: false, reason: `disabled: ${cfg.reason}` };
  if (!clerkUserId) return { allowed: false, reason: "no session" };
  if (!isAdmin) return { allowed: false, reason: "not an admin" };
  if (!cfg.admins.includes(clerkUserId)) return { allowed: false, reason: "not in TERMINAL_ADMINS" };
  if (!safeEqual(secret, cfg.secret)) return { allowed: false, reason: "bad secret" };
  return { allowed: true, reason: "ok" };
}

module.exports = { checkTerminalAccess, terminalConfig, safeEqual, parseAdmins };

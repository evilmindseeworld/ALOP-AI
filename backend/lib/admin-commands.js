/**
 * The admin diagnostics console.
 *
 * READ THIS BEFORE ADDING A COMMAND.
 *
 * This is not a shell, and the naming matters because the difference is the
 * entire security design. There is NO subprocess here — no `exec`, no `spawn`,
 * no `execFile`, no shell string, and no argument that reaches a binary. Every
 * command below is a function that reads process state or runs one fixed
 * database query.
 *
 * The reason is the threat model. This process holds SUPABASE_SERVICE_ROLE_KEY,
 * STRIPE_SECRET_KEY, CLERK_SECRET_KEY and OLLAMA_API_KEY in memory. Any command
 * execution at all is a path to those, and the strongest mitigation is not to
 * sanitise the path but to not have one. An allowlist of BINARIES still takes
 * user input; an allowlist of NAMED OPERATIONS takes an identifier from a
 * closed set and nothing else. There is no string to inject into because there
 * is no string.
 *
 * So the API accepts a command ID, never a command. `run("health")` — never
 * `run("df -h")`. Arguments are not accepted, not parsed, and not ignored:
 * there is nowhere to put them.
 *
 * IF YOU NEED A REAL SHELL LATER, it does not go here. It goes in a disposable
 * sandbox with no network and no environment, per the design doc's run_code
 * section, and this file stays as it is.
 *
 * SECOND RULE: NOTHING HERE RETURNS A SECRET. Configuration is reported as
 * presence booleans. A command that returned an env VALUE would turn the
 * strongest credential in the system into an HTTP response, which is the exact
 * outcome every layer above this is built to prevent.
 */

const REDACTED = "set";
const ABSENT = "not set";

/** Env vars worth knowing the state of. VALUES ARE NEVER READ, only presence. */
const TRACKED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CLERK_SECRET_KEY",
  "CLERK_PUBLISHABLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_MONTHLY",
  "STRIPE_PRICE_YEARLY",
  "GOOGLE_API_KEY",
  "SENTRY_DSN",
  "OLLAMA_HOST",
  "OLLAMA_API_KEY",
  "BRAVE_API_KEY",
  "TAVILY_API_KEY",
  "GOOGLE_SEARCH_API_KEY",
  "GOOGLE_CSE_ID",
  "JINA_API_KEY",
  "FRONTEND_URL",
  "ALLOWED_ORIGINS",
  "COUNCIL_TOOLS",
  "RATE_LIMIT_STORE",
];

/**
 * Env vars whose VALUE is safe to show because it is not a credential — a mode
 * flag or a public URL. Every one of these is a deliberate, individual
 * decision, which is why it is a list and not a pattern like /_KEY$/. A pattern
 * is a rule someone will accidentally satisfy.
 */
const SHOWABLE = new Set(["COUNCIL_TOOLS", "RATE_LIMIT_STORE", "FRONTEND_URL", "ALLOWED_ORIGINS", "OLLAMA_HOST"]);

const fmtBytes = (n) => `${Math.round(n / 1024 / 1024)} MB`;
const fmtDuration = (s) => {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(" ");
};

/**
 * @param {object} deps
 * @param {object} deps.supabase   the service-role client
 * @param {object} [deps.env]      defaults to process.env
 * @param {object} [deps.proc]     defaults to the real process, for tests
 */
function buildCommands({ supabase, env = process.env, proc = process } = {}) {
  const commands = {
    health: {
      summary: "Process uptime, memory and versions",
      run: async () => {
        const mem = proc.memoryUsage();
        return {
          uptime: fmtDuration(proc.uptime()),
          node: proc.version,
          pid: proc.pid,
          rss: fmtBytes(mem.rss),
          heapUsed: fmtBytes(mem.heapUsed),
          // A single instance is an assumption the rate limiter depends on —
          // see lib/pg-rate-limit-store.js. Worth being able to check.
          rateLimitStore: env.RATE_LIMIT_STORE === "postgres" ? "postgres (shared)" : "memory (per process)",
        };
      },
    },

    config: {
      summary: "Which environment variables are set (never their values)",
      run: async () => {
        const out = {};
        for (const key of TRACKED_ENV) {
          const present = Boolean(env[key]);
          // A showable variable reveals its value; everything else reveals only
          // that it exists. There is no branch here that reads a credential.
          out[key] = present ? (SHOWABLE.has(key) ? env[key] : REDACTED) : ABSENT;
        }
        return out;
      },
    },

    schema: {
      summary: "Which migrations have landed, by checking for what they created",
      run: async () => {
        // Each migration is identified by an object it creates. Counting rows
        // rather than reading them: a count cannot leak content.
        const checks = {
          "001 feedback_notes": "feedback_notes",
          "002 stripe_events": "stripe_events",
          "003 chat_files": "chat_files",
          "004 rate_limits": "rate_limits",
        };
        const out = {};
        for (const [label, table] of Object.entries(checks)) {
          const { error, count } = await supabase.from(table).select("*", { count: "exact", head: true });
          out[label] = error ? `MISSING (${error.message.slice(0, 80)})` : `applied — ${count ?? 0} rows`;
        }
        return out;
      },
    },

    usage: {
      summary: "Row counts for the main tables",
      run: async () => {
        const out = {};
        for (const table of ["users", "chats", "chat_files", "feedback_notes", "audit_logs"]) {
          const { error, count } = await supabase.from(table).select("*", { count: "exact", head: true });
          out[table] = error ? `unavailable (${error.message.slice(0, 60)})` : count ?? 0;
        }
        return out;
      },
    },

    /**
     * The domain-cutover preflight.
     *
     * Moving to a custom domain touches four systems that must agree, and the
     * failure mode when they do not is silent to the server and total for the
     * user: the browser gets a CORS refusal, the app renders, and every request
     * fails. Nothing in the backend logs looks wrong, because from its side
     * refusing a disallowed origin IS working correctly.
     *
     * This puts all four in one answer so they can be compared at a glance
     * instead of remembered.
     */
    origins: {
      summary: "CORS allowlist and Clerk instance — the domain-cutover preflight",
      run: async () => {
        const exact = [env.FRONTEND_URL, ...(env.ALLOWED_ORIGINS || "").split(",")]
          .map((s) => (s || "").trim())
          .filter(Boolean);
        const pk = env.CLERK_PUBLISHABLE_KEY || "";
        return {
          FRONTEND_URL: env.FRONTEND_URL || ABSENT,
          ALLOWED_ORIGINS: env.ALLOWED_ORIGINS || ABSENT,
          acceptedOrigins: exact,
          // Only the PREFIX, never the key. pk_ keys are public by design, but
          // "public by design" is not a reason to start echoing credentials
          // out of an endpoint whose whole purpose is not doing that.
          clerkInstance: pk.startsWith("pk_live_")
            ? "PRODUCTION"
            : pk.startsWith("pk_test_")
              ? "DEVELOPMENT — capped at 100 users, shows a dev banner"
              : ABSENT,
          stripeMode: (env.STRIPE_SECRET_KEY || "").startsWith("sk_live_")
            ? "LIVE"
            : (env.STRIPE_SECRET_KEY || "").startsWith("sk_test_")
              ? "TEST"
              : ABSENT,
          // The mismatch that actually bites. Everything else can be read off;
          // this is the one worth stating as a conclusion.
          warning:
            pk.startsWith("pk_live_") && !exact.some((o) => !o.includes(".vercel.app"))
              ? "Clerk is on a production instance but no custom-domain origin is allowed — the app will load and every API call will fail CORS."
              : null,
        };
      },
    },

    audit: {
      summary: "The 20 most recent audit entries",
      run: async () => {
        const { data, error } = await supabase
          .from("audit_logs")
          .select("action,created_at,ip_address,metadata")
          .order("created_at", { ascending: false })
          .limit(20);
        if (error) return { error: error.message };
        return (data || []).map((r) => ({
          at: r.created_at,
          action: r.action,
          ip: r.ip_address || "—",
          // Metadata is written by this codebase, not by users, but it is
          // stringified and clipped rather than passed through: an audit view
          // that renders arbitrary nested objects is a place for surprises.
          detail: JSON.stringify(r.metadata || {}).slice(0, 160),
        }));
      },
    },
  };

  return {
    /** The menu, for the client to render. Never includes an input field. */
    list: () => Object.entries(commands).map(([id, c]) => ({ id, summary: c.summary })),

    has: (id) => Object.prototype.hasOwnProperty.call(commands, id),

    /**
     * Run one command by id.
     *
     * `hasOwnProperty` rather than `commands[id]` — a bare lookup would resolve
     * "constructor" and "__proto__" to functions off Object.prototype, and
     * calling one of those is a strange way to find out your allowlist was not
     * one.
     */
    run: async (id, { timeoutMs = 8000 } = {}) => {
      if (typeof id !== "string" || !Object.prototype.hasOwnProperty.call(commands, id)) {
        return { ok: false, error: `No such command. Available: ${Object.keys(commands).join(", ")}.` };
      }
      try {
        const result = await Promise.race([
          commands[id].run(),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs).unref?.()),
        ]);
        return { ok: true, id, result };
      } catch (err) {
        return { ok: false, id, error: err.message };
      }
    },
  };
}

module.exports = { buildCommands, TRACKED_ENV, SHOWABLE };

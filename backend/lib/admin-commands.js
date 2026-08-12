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
 * STRIPE_SECRET_KEY, CLERK_SECRET_KEY and OPENROUTER_API_KEY in memory. Any command
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
  "OPENROUTER_HOST",
  "OPENROUTER_API_KEY",
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
const SHOWABLE = new Set(["COUNCIL_TOOLS", "RATE_LIMIT_STORE", "FRONTEND_URL", "ALLOWED_ORIGINS", "OPENROUTER_HOST"]);

const fmtBytes = (n) => `${Math.round(n / 1024 / 1024)} MB`;
const fmtDuration = (s) => {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(" ");
};

const numericValues = (values) => (values || [])
  .filter((value) => value !== null && value !== undefined && value !== "")
  .map(Number)
  .filter(Number.isFinite)
  .sort((a, b) => a - b);

const percentile = (values, p = 0.5) => {
  const sorted = numericValues(values);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null;
};

const readTotal = (reads) => {
  const values = Object.values(reads || {});
  return values.length ? values.reduce((n, read) => n + (Number(read?.ms) || 0), 0) : null;
};

const seatPercentile = (rows, p) => {
  const byModel = {};
  for (const row of rows || []) {
    for (const seat of Array.isArray(row.seats) ? row.seats : []) {
      if (!seat?.model || seat.ms === null || seat.ms === undefined) continue;
      (byModel[seat.model] ||= []).push(seat.ms);
    }
  }
  return Object.fromEntries(Object.entries(byModel).map(([model, values]) => [model, percentile(values, p)]));
};

const slowestSeatCounts = (rows) => {
  const counts = {};
  for (const row of rows || []) {
    const seats = (Array.isArray(row.seats) ? row.seats : []).filter((seat) => seat?.model && Number.isFinite(Number(seat.ms)));
    if (!seats.length) continue;
    const slowest = seats.reduce((a, b) => Number(b.ms) > Number(a.ms) ? b : a);
    counts[slowest.model] = (counts[slowest.model] || 0) + 1;
  }
  return counts;
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

    /**
     * Where does a council turn spend its wall clock?
     *
     * The numbers that answer that used to exist only in stdout, which meant
     * reading them required the Render dashboard on a large screen, and they
     * rolled off with log retention. They are audit rows now, so this
     * aggregates them.
     *
     * For legacy tool rows the number that matters is callsPerMember. For new
     * council_turn rows the phase and seat percentiles answer the p90 question
     * directly: context, router, tools, synthesis, or one named straggler.
     */
    council: {
      summary: "Council timing over the last 200 turns — phases, seat tails, ceilings, fallbacks",
      run: async () => {
        const { data, error } = await supabase
          .from("audit_logs")
          .select("action,metadata,created_at")
          .in("action", ["council.tools", "council"])
          .order("created_at", { ascending: false })
          // `council` also contains memory, greeting and search audit rows, so
          // read a little more than the report needs before filtering those
          // branches out below.
          .limit(500);
        if (error) return { error: error.message };

        // `council` is also used by the fast memory/greeting/search branches.
        // Only the structured turn rows belong in this report; old
        // `council.tools` rows remain useful while the new shape rolls out.
        const turnRows = (data || [])
          .filter((r) => r.action === "council.tools" || r.metadata?.telemetry === "council_turn")
          .slice(0, 200);
        /* ABANDONED TURNS COUNT, BUT NOT IN THE DURATIONS.
         *
         * `server.js` now writes a row for a turn the client walked away from,
         * because a p90 computed only over turns that finished is a p90 over
         * the population guaranteed not to contain the problem. But an
         * abandoned turn's `turnMs` is a CENSORED observation — the turn was
         * still running, so the number is a lower bound on a duration nobody
         * ever measured. Averaging those in would make every percentile here
         * improve as MORE users gave up, which is the failure this row was
         * added to prevent, inverted.
         *
         * So they are counted and reported as a rate, and the percentiles are
         * taken over completed turns only. Seat and tool records from an
         * abandoned turn are real measurements of real calls, but they are left
         * out too: the seats that had not answered yet are absent rather than
         * slow, so a seat percentile over these rows is biased toward whichever
         * seats happen to be fast. */
        const allRows = turnRows.map((r) => r.metadata || {});
        const abandoned = allRows.filter((r) => r.aborted);
        const rows = allRows.filter((r) => !r.aborted);
        const abandonedRate = allRows.length
          ? `${abandoned.length} of ${allRows.length}`
          : "0 of 0";
        if (!rows.length) {
          return {
            turns: 0,
            abandonedTurns: abandonedRate,
            note: abandoned.length
              ? `No turn ran to completion. All ${abandoned.length} recorded turns were abandoned by the client mid-flight, which is a finding rather than an absence of data — every user so far has given up before an answer landed.`
              : "No tool-loop turns recorded yet. Either COUNCIL_TOOLS is not 1, or every question so far was routed to memory, search or a greeting before reaching the council.",
          };
        }

        const sum = (f) => rows.reduce((n, r) => n + (Number(f(r)) || 0), 0);
        const uniqueCalls = sum((r) => r.uniqueCalls);
        const members = sum((r) => r.members);
        const tools = {};
        for (const r of rows) for (const [k, v] of Object.entries(r.tools || {})) tools[k] = (tools[k] || 0) + v;

        const fellBack = rows.filter((r) => r.fellBack).length;
        const truncated = rows.filter((r) => r.truncated || r.ceiling?.hit).length;

        // How long the user waited before the first character appeared. The
        // median matters more than the mean here: one cold start at 22s drags
        // an average somewhere no real request ever was.
        const waits = numericValues(rows.map((r) => r.msToFirstByte));
        const pct = (p) => percentile(waits, p);

        return {
          turns: rows.length,
          since: turnRows[turnRows.length - 1]?.created_at || null,
          msToFirstByteMedian: pct(0.5),
          msToFirstByteP90: pct(0.9),
          msToFirstByteWorst: waits.length ? waits[waits.length - 1] : null,
          turnMsMedian: percentile(rows.map((r) => r.turnMs)),
          turnMsP90: percentile(rows.map((r) => r.turnMs), 0.9),
          contextMsMedian: percentile(rows.map((r) => r.contextMs)),
          contextMsP90: percentile(rows.map((r) => r.contextMs), 0.9),
          routerMsMedian: percentile(rows.map((r) => readTotal(r.routerReads))),
          routerMsP90: percentile(rows.map((r) => readTotal(r.routerReads)), 0.9),
          synthesisMsMedian: percentile(rows.map((r) => r.synthesisMs)),
          synthesisMsP90: percentile(rows.map((r) => r.synthesisMs), 0.9),
          toolMsMedian: percentile(rows.map((r) => r.toolMs)),
          toolMsP90: percentile(rows.map((r) => r.toolMs), 0.9),
          seatMsP90ByModel: seatPercentile(rows, 0.9),
          slowestSeatByModel: slowestSeatCounts(rows),
          postCouncilFallbacks: rows.filter((r) => r.fallbackCouncil?.used).length,
          postCouncilFallbackMsP90: percentile(rows.map((r) => r.fallbackCouncil?.durationMs), 0.9),
          avgRounds: +(sum((r) => r.rounds) / rows.length).toFixed(2),
          avgUniqueCalls: +(uniqueCalls / rows.length).toFixed(2),
          // < 0.4 is the dedupe working. Near 1.0 means it is not.
          callsPerMember: members ? +(uniqueCalls / members).toFixed(2) : 0,
          toolsUsed: tools,
          fellBackToPlainCouncil: `${fellBack} of ${rows.length}`,
          hitACeiling: `${truncated} of ${rows.length}`,
          // Out of every percentile above, on purpose — see the note where
          // these are split. The rate is the signal; the durations are not.
          abandonedTurns: abandonedRate,
          abandonedAfterMsMedian: percentile(abandoned.map((r) => r.turnMs)),
          verdict:
            abandoned.length > allRows.length / 5
              ? `ONE TURN IN ${Math.round(allRows.length / Math.max(1, abandoned.length))} IS ABANDONED. Read that before any timing below it: the percentiles here describe only the turns people waited out, and the ones they did not are the slow ones by definition.`
              : !uniqueCalls
              ? "No tool was ever called. Models are answering directly — check a [PROBE] line, or the questions genuinely needed no research."
              : members && uniqueCalls / members > 0.7
                ? "DEDUPE IS NOT EARNING ITS PLACE: members are asking for different things almost every time. Tighten the prompt toward shared phrasing."
                : fellBack > rows.length / 4
                  ? "Falling back to the plain council often. The loop is running and producing nothing usable."
                  : "Healthy.",
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

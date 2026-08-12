# The admin console

**It is not a shell.** That distinction is the security design, not a caveat.

There is no `exec`, no `spawn`, no `execFile`, no shell string and no argument
that reaches a binary anywhere in it. Every command is a JavaScript function
that reads process state or runs one fixed database query, and the HTTP API
accepts a **command id from a closed set** — never a command.

## Why not a real shell

This process holds `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`,
`CLERK_SECRET_KEY` and `OPENROUTER_API_KEY` in memory. Any command execution is a
path to all four. The strongest mitigation is not to sanitise that path but to
not have one.

An allowlist of *binaries* still takes user input, and every escape in that
design is a bug in the sanitiser. An allowlist of *named operations* takes an
identifier and nothing else — there is no string to inject into because there is
no string.

If a real shell is needed later it does **not** go here. It goes in a disposable
sandbox with no network and no environment, per the `run_code` section of
`docs/superpowers/specs/2026-07-31-council-tool-calling-design.md`, and this file
stays as it is.

## Turning it on

Two variables in Render. **Until both are set the console is disabled**, and the
boot log says so.

```
TERMINAL_ADMINS=user_2abc...        # your Clerk user id, comma-separated for more
TERMINAL_SECRET=<48+ random chars>  # generate it, store it in a password manager
```

Generate the secret with something you trust, e.g.

```bash
node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"
```

Your Clerk user id is on your user's page in the Clerk dashboard, and it is the
same value the app sends as `req.auth.userId`.

Confirm at boot:

```
[BOOT] admin console -> ENABLED for 1 allowlisted admin(s)
```

## The four conditions

All required, and deliberately of different **kinds** so that compromising one
does not imply the others.

| | Condition | What it defends against |
|---|---|---|
| 1 | A valid Clerk session | Anonymous access |
| 2 | `is_admin` on the user row | A signed-in ordinary user |
| 3 | Clerk id in `TERMINAL_ADMINS` | **Another admin**, or an `is_admin` flag flipped by anything that can write to the database |
| 4 | `x-terminal-secret` header matches | **A stolen session** — a hijacked cookie satisfies 1–3 and stops here |

(3) is what makes the console one person's. `is_admin` is a database column, and
anything that can write to that table can grant it — a SQL injection, a leaked
service-role key, a future admin-management screen with a bug. `TERMINAL_ADMINS`
lives in the environment: changing it requires access to Render, not to Postgres.

(4) is what survives credential theft. The secret is never stored in the browser
— you type it per session and it is held in memory.

**It fails closed.** If either variable is unset, or the secret is shorter than
24 characters, the console is disabled outright rather than relaxing to
`is_admin`. A short secret counts as unconfigured *because it looks configured*.

## What a refusal tells you

Nothing. Every failure returns the same `403 {"error":"Not available."}`
whichever condition missed.

The specific reason goes to `audit_logs` only. Distinguishing "not an admin"
from "bad secret" in the response hands an attacker a map of the lock and tells
them exactly how far they have got.

**Every attempt is audited before the reply** — allowed as `terminal.access`,
refused as `terminal.denied`, with the reason, the Clerk id, the requested
command, the user agent and the IP.

Rate limit: **10 requests per minute**, far tighter than the admin floor of 60.
The secret is the only guessable credential in the chain and this makes guessing
it arithmetically hopeless.

## Commands

| id | what it does |
|---|---|
| `health` | Uptime, memory, Node version, pid, which rate-limit store is active |
| `config` | Which environment variables are **set** — never their values |
| `origins` | CORS allowlist and Clerk instance — the domain-cutover preflight |
| `council` | Tool-loop health over the last 200 turns |
| `schema` | Which migrations have landed, by checking for what each created |
| `usage` | Row counts for the main tables |
| `audit` | The 20 most recent audit entries |

### Reading `council`

```json
{
  "turns": 3,
  "avgRounds": 2,
  "avgUniqueCalls": 2,
  "callsPerMember": 0.29,
  "toolsUsed": { "web_search": 5, "read_url": 1 },
  "fellBackToPlainCouncil": "0 of 3",
  "hitACeiling": "1 of 3",
  "verdict": "Healthy."
}
```

**`callsPerMember` is the number that matters.** The whole tool-calling design
rests on seven members' overlapping requests collapsing into a handful of
unique calls. Near **0.3** means the dedupe is doing its job. Near **1.0** means
every member asked for something different, nothing collapsed, and the loop is
paying for seven searches to do one member's worth of research — the prompt
needs to push harder toward shared phrasing.

`verdict` says which of those it is, so the judgement is not left to memory.

These come from `audit_logs`, not from stdout. That is deliberate: the same
numbers used to exist only in Render's log stream, which meant reading them
needed a large screen and they rolled off with retention.

`config` reports presence as `set` / `not set`. A short list of variables show
their actual value — `COUNCIL_TOOLS`, `RATE_LIMIT_STORE`, `FRONTEND_URL`,
`ALLOWED_ORIGINS`, `OPENROUTER_HOST` — and that is a **list, not a pattern**. A rule
like "hide anything matching `_KEY$`" is a rule something eventually satisfies
without meaning to; a list has to be edited deliberately.

`OPENROUTER_HOST` is showable because it has one correct public default:
`https://openrouter.ai/api/v1/chat/completions`. `OPENROUTER_API_KEY` is never
showable.

A test asserts no name on the showable list matches
`SECRET|_KEY$|TOKEN|PASSWORD|DSN`.

## Using it

```bash
curl -s https://alop-ai.onrender.com/api/admin/console \
  -H "Authorization: Bearer $CLERK_TOKEN" \
  -H "x-terminal-secret: $TERMINAL_SECRET"

curl -s -X POST https://alop-ai.onrender.com/api/admin/console \
  -H "Authorization: Bearer $CLERK_TOKEN" \
  -H "x-terminal-secret: $TERMINAL_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"command":"config"}'
```

There is no UI yet. That is deliberate for now: a browser UI would have to hold
the secret somewhere, and "somewhere in the browser" is exactly what condition
(4) exists to avoid. If it gets one, the secret should be prompted for per
session and kept in memory only — never `localStorage`, never a cookie.

## Adding a command

1. Add it to `commands` in `lib/admin-commands.js`. It takes **no arguments**.
2. If it touches the database, use a count or a bounded `limit`.
3. If it could return a credential, it does not go in.
4. Add a test. `admin-commands.test.js` already asserts prototype keys
   (`constructor`, `__proto__`, `toString`) are not commands — a bare
   `commands[id]` lookup resolves those to real functions.

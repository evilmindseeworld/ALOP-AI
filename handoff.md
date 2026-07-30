# ALOP-AI — Session Handoff

**Written:** 2026-07-30
**Repo:** `C:\Users\LENOVO\Documents\AI-Classroom` — `evilmindseeworld/ALOP-AI` (**PUBLIC**)
**Why this exists:** the session hit its usage limit (resets **3:30am Asia/Dubai**) and killed two
code-review agents mid-run. This is the state to resume from.

---

## Goals

The original ask was: *"fix everything improve ui implement features better improve design and
sign in and ai smartness."* That spans multiple independent subsystems, so it was decomposed into
four slices, to be built in this order:

| Slice | Scope | Status |
|---|---|---|
| **A — Phantom features** | Features the UI advertised that did nothing | **Complete, pushed, unmerged** |
| **C — Visual design** | `App.css` is 2,892 lines with **202 `!important`** | Not started |
| **B — AI smartness** | Council quality, history window, search citations | Not started |
| **D — Sign-in** | Polish; it's the healthiest code in the repo (58 lines) | Not started |

Ordering rationale: A first because it was the only category actively deceiving users and it
contained the unreachable revenue path. **C must come before any visual redesign** — layering new
design over 202 `!important` declarations guarantees a repeat of the eight-commit z-index war
(`302b5aa`, `1c48887`, `611a39e`, `76b9d7f`, and now `bf0647b`/`c00a0ce`).

---

## Current state

**Branch `slice-a-phantom-features` is pushed but NOT merged.** `main` is untouched, so nothing
has deployed. Merging `main` is what triggers Render + Vercel.

```
c00a0ce  fix: set earring z-index to 4 — above chat window, below menus   <-- NOT MINE
bf0647b  fix: set earring z-index to 4 — above chat window, below menus   <-- NOT MINE (duplicate)
5e4e988  docs: PR description for slice A
b4a6079  feat: make the Pro plan reachable
7628e75  feat: add GET /api/billing/prices
62c734a  feat: camera capture and image upload actually work
cc6f303  feat: the council can see attached images
b9cf6be  fix: make pin/favorite toggles persist; delete three uncalled endpoints
4ecb4e1  fix: persist pin/favorite, and add a backend test harness
418ea9f  docs: spec and plan for slice A (phantom features)
```

**Tests: 50 passing** (29 backend `node:test`, 21 frontend Vitest) as of `5e4e988`.
The backend had **no test framework at all** before this work; it has one now.

### Anomalies to resolve before merging

1. **`bf0647b` and `c00a0ce` are not mine** and are duplicates of each other — same message, same
   intent, two commits. They landed on the branch after I pushed `5e4e988`. They re-touch earring
   z-index, the exact thing slice C is meant to fix properly. **Verify what they contain and
   whether both are wanted** before merge.
2. **`frontend/src/__tests__/Earring.test.jsx` has 38 uncommitted insertions / 23 deletions.**
   Origin unknown. Decide whether to keep.
3. **HEAD is currently on `main`, not the feature branch.** A code-review subagent checked out
   despite being told the review was read-only. Nothing was lost — `5e4e988` is a confirmed
   ancestor of the remote tip — but re-checkout before resuming:
   `git checkout slice-a-phantom-features`

### PR is not open yet

`gh` CLI is **not installed** on this machine, so the PR could not be created programmatically.
Either install it (`winget install GitHub.cli` then `gh auth login`) or use:

`https://github.com/evilmindseeworld/ALOP-AI/compare/main...slice-a-phantom-features?expand=1`

A ready-to-paste PR body is committed at `docs/superpowers/PR-slice-a.md`.

---

## Active files

**Created:**
- `backend/lib/chat-update.js` — pure `buildChatUpdate()` + `sanitizeString()`
- `backend/lib/chat-update.test.js` — 15 tests
- `backend/lib/data-url.js` — `parseDataUrl()`, parses image MIME from data URLs
- `backend/lib/data-url.test.js` — 14 tests
- `frontend/src/__tests__/InputBar.test.jsx` — 9 tests
- `frontend/src/__tests__/formatPrice.test.jsx` — 8 tests
- `docs/superpowers/specs/2026-07-30-phantom-features-design.md` — the spec
- `docs/superpowers/plans/2026-07-30-phantom-features-plan.md` — the plan
- `docs/superpowers/PR-slice-a.md` — PR body

**Modified:**
- `backend/server.js` — 717 → ~624 lines then +40 for billing. Vision in `/api/council`,
  `GET /api/billing/prices`, three endpoints deleted, `buildChatUpdate` wired in
- `backend/package.json` — added `"test": "node --test \"lib/**/*.test.js\""`
- `frontend/src/App.jsx` — attachment state, upgrade UI, `?payment=` handling, optimistic toggles
- `frontend/src/App.css` — +169 lines (attachment preview, plan grid, upgrade button)
- `frontend/package.json` — added `@testing-library/user-event` (dev)

---

## Changes made (slice A)

| Was | Now |
|---|---|
| Pin/Favorite vanished on reload | Persisted via `PUT /api/chats/:id` |
| Camera drew a frame and **discarded the blob** | `toDataURL`, attaches properly |
| Upload said *"disabled in Council mode"* | Downscales to 1568px and attaches |
| Council couldn't see images | Gemini describes it; MIME **parsed**, not hardcoded |
| No way to become Pro | Upgrade panel with real Stripe prices |
| `?payment=success` read by nothing | Toast + plan re-poll absorbing webhook lag |
| `/api/quick`, `/api/vision`, `/api/image` | Deleted — 93 lines, zero callers |

### Bugs found during implementation (not in the original spec)

- **`updated_at` was bumped unconditionally.** The sidebar sorts on it, so the naive pin fix would
  have yanked chats to the top of the list just for being pinned. Now bumps only when `messages`
  change. This is why `buildChatUpdate` was extracted and tested.
- **`/image` created two chat rows.** `createChat()` ran before the image-request check, and
  `generateImage` calls it again from a closure still holding the stale `activeChatId`. Fixed by
  reordering.

### Deliberate deviations from the plan

1. **Tests could not live in `server.js`.** The plan said guard `app.listen` with
   `require.main === module`, but line ~52 calls `process.exit(1)` when env vars are missing —
   importing it kills the test runner. Logic moved to `backend/lib/` instead.
2. **No SSE `status`/`notice` frames.** Writing an early frame flushes headers, and every council
   branch then calls `res.setHeader`, which throws once headers are sent. Vision failures return a
   normal 400/502/503 *before* the stream opens.
3. **Attachment bytes are never persisted** — only a `hasImage` flag. A data URL is megabytes and a
   row holds up to 200 messages.

---

## Failed attempts

- **Code review never completed.** Two agents were dispatched and both died on the session limit:
  a `general-purpose` reviewer on `384ec72..5e4e988`, and the `/code-review` skill agent.
  **Slice A has had zero external review.** Re-run after the limit resets.
- **One reviewer moved HEAD to `main`** despite an explicit read-only instruction, and edited
  `Earring.test.jsx`. No commits were lost, but treat review agents as capable of mutating the tree.
- **`gh` CLI not installed** — PR could not be opened programmatically.
- **`node --test lib/`** (directory form) fails on Node 26 with `MODULE_NOT_FOUND`. The working
  form is a quoted glob so Node globs rather than the shell: `node --test "lib/**/*.test.js"`.
- **Earlier session wrongly concluded "Render did not auto-deploy."** It does — it just takes
  **over 5 minutes** (measured: 11 polls at 30s ≈ 5.5 min). Do not conclude otherwise before 10 min.
- **`pkill` does not work on Windows.** Use PowerShell `Get-Process node | Stop-Process -Force`,
  then confirm with `Get-NetTCPConnection -LocalPort <port>`. A stale process answering on an old
  port has already caused one misdiagnosis.

---

## Next steps

### Blocked on the user — cannot be done from here

1. **Run the Supabase migration.** `backend/migrations/001_per_chat_memory.sql` has **never run**.
   `feedback_notes` returns `PGRST205`; `chats.conversation_summary` returns `42703`. Until then
   per-chat memory and feedback-learning are inert (they now fail honestly rather than silently).
   The local `.env` has no DB connection string or Management API token, so DDL is impossible from
   here. Editor: `https://supabase.com/dashboard/project/tbjvnqwgnkiynqypswmb/sql/new`
2. **Set a rotated `SENTRY_DSN` in Render.** Error reporting is off until then. The old DSN is in
   this public repo's git history — rotate, don't reuse.
3. **Confirm two Render env vars** that could not be probed without a valid token:
   - `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY` — if unset, `/api/billing/prices` 503s and the
     upgrade path hides itself. No broken checkout, but no revenue.
   - `GOOGLE_API_KEY` — if unset, attaching an image returns a clear 503 instead of vision.

   Already confirmed present in Render: `CLERK_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`,
   `STRIPE_WEBHOOK_SECRET`.

### Immediate technical

4. `git checkout slice-a-phantom-features` — HEAD is currently on `main`.
5. Resolve the two unexplained z-index commits and the uncommitted `Earring.test.jsx` diff.
6. **Re-run code review on slice A** — it has had none.
7. Open the PR.

### Slice C progress (2026-07-30, later session)

Committed on `slice-a-phantom-features`: `9189b6c`, `3c21236`, `5fad287`, `7db1a66`.

- **z-index war ended.** Documented `--z-*` scale; all bare numbers replaced.
  `zIndexOrder.test.js` asserts the order and was verified against two
  deliberate regressions. See `docs/FRONTEND.md` §1.
- **Tailwind installed additively**, Preflight excluded, palette + stacking
  scale bridged to the existing CSS variables. `docs/FRONTEND.md` §2.
- **Stop generation** — did not exist. Adding it exposed a latent soft-lock:
  the AbortError branch never reset `status`, so any user-initiated stop would
  have disabled the composer permanently. Also persisted the partial answer
  instead of discarding it.
- **Empty-state starters, regenerate, export to Markdown, scroll-to-bottom.**
- **Ctrl+K command palette** with chat search (which did not exist at all).
  Fixed a dropped-first-keystroke bug from deferring focus through rAF.
- `docs/FRONTEND.md` written.

**Tests: 4 → 110** (29 backend, 81 frontend).

Still open in slice C: ~202 `!important` in `App.css`, the 1.13 MB bundle with
no code splitting, and `App.jsx` at ~800 lines.

### Plugin installs — results

| Requested | Result |
|---|---|
| `frontend-design@claude-plugins-official` | **Already installed** (user scope) |
| `21st-dev/claude-code-plugin` | **Installed** as marketplace `21st` + plugin `21st@21st`. Its MCP server (`https://21st.dev/api/mcp`) **needs authentication** before use. |
| `nextlevelbuilder/ui-ux-pro-max-skill` | **Installed** as marketplace + plugin `ui-ux-pro-max`. Adds skills: `ui-ux-pro-max`, `ui-styling`, `design-system`, `brand`, `slides`, `banner-design`. **See Python blocker below.** |
| `davideast/stitch-mcp` | Not a plugin marketplace. Added as an MCP server from npm (`npx -y stitch-mcp`, v1.3.2). **Fails to connect** — `MCP error -32000: Connection closed`, almost certainly missing credentials/env. |
| `Graphify-Labs/graphify` | **Failed** — no `.claude-plugin/marketplace.json`. Not a Claude plugin. Determine what it actually is before retrying. |
| `shadcn-ui/ui` | **Not a Claude plugin** — it's the component library itself. See note below. |

**`ui-ux-pro-max` + Python: resolved.** Python 3.12.10 is installed at
`C:\Users\LENOVO\AppData\Local\Programs\Python\Python312\python.exe`. It is **not** on the
Git-Bash PATH — `python`/`python3` both fail there — but `py` works from PowerShell. Invoke the
skill's scripts via `py` or the absolute path.

### Second batch of installs (12 repos)

Added as marketplaces and installed — 22 plugins total:
`superpowers@superpowers-dev`, `document-skills` / `example-skills` / `claude-api`
`@anthropic-agent-skills`, `obsidian@obsidian-skills`, `ponytail@ponytail`,
`codex@openai-codex`, `caveman@caveman`, `agent-browser@agent-browser`,
`claude-obsidian@agricidaniel-claude-obsidian`, and all 12 `@claude-for-legal` plugins.

Three were not marketplaces and were installed by their real mechanism instead:

| Repo | What it actually is | Installed to |
|---|---|---|
| `garrytan/gstack` | Agent Skill (router + suite) | `~/.claude/skills/gstack/` |
| `PleasePrompto/notebooklm-skill` | Agent Skill | `~/.claude/skills/notebooklm/` |
| `wynandw87/claude-code-perplexity-mcp` | MCP server (TypeScript) | Built to `~/.claude/mcp-servers/perplexity/dist/index.js` |

**Perplexity MCP needs a key before it will connect.** Not registered yet, deliberately — adding
it without one produces a dead server. One line once you have a key:

```
claude mcp add -s user Perplexity -e "PERPLEXITY_API_KEY=<key>" -- node "C:\Users\LENOVO\.claude\mcp-servers\perplexity\dist\index.js"
```

**`stitch` MCP is registered but failing** (`-32000: Connection closed`) — same cause, missing
credentials. Either supply them or remove it: `claude mcp remove stitch`.

**Note on `caveman@caveman`:** it is installed and its stated purpose is to cut output tokens ~65%
by replying in clipped prose. It only takes effect when invoked, but be aware of what it does
before running it — it will noticeably degrade explanation quality.

**shadcn/ui is not a drop-in here.** It requires Tailwind + Radix; the ALOP-AI frontend has
**neither** — `frontend/package.json` has no `tailwindcss`, no `@radix-ui`, no
`class-variance-authority`. The app is plain CSS (`App.css`, 2,892 lines). Adopting shadcn means
introducing Tailwind and migrating styling — a real slice C architectural decision, not an install.
Cloning the shadcn monorepo into the home directory would achieve nothing. The `21st` plugin and
the `ui-styling` skill both already cover installing individual shadcn components via
`npx shadcn@latest`, which is the normal path once Tailwind exists.

### Worth knowing: the Supabase migration may be unblockable

`claude mcp list` shows **`plugin:supabase:supabase` configured but "Needs authentication."**
If that is authenticated, the migration in step 1 above could be run directly rather than pasted
into the dashboard by hand. This has blocked memory and feedback-learning for two sessions —
authenticating it is probably the single highest-value five minutes available.

### Then

9. Slice C (CSS foundation), then B (AI smartness), then D (sign-in polish).

---

## Reference

- **Known-good verification commands**
  - `cd backend && npm test` → 29 passing
  - `cd frontend && npm test` → 21 passing; `npm run build` → clean (1.12 MB bundle, warns >500 kB)
- **Zero-cost prod probing.** Middleware order makes some endpoints self-describing without
  spending a model call: `requireStripe` runs *before* `requireAuth` on
  `/api/create-checkout-session`, so **503 = Stripe unconfigured, 401 = configured**.
- **Production health:** `https://alop-ai.onrender.com/health`

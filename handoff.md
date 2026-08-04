# ALOP-AI — Session Handoff

**Written:** 2026-08-05
**Repo:** `C:\Users\LENOVO\Documents\AI-Classroom` — `evilmindseeworld/ALOP-AI`
(**PUBLIC** — never commit a secret, and treat anything already in history as
compromised)
**Branch:** `main`, HEAD `8568ede`, **pushed**. Working tree clean apart from an
untracked `.claude/`.

**Verified this session, not assumed:**

| | |
|---|---|
| Frontend tests | **391 passing**, 29 files |
| Backend tests | **51 passing** |
| `npm run build` | clean, no chunk-size warnings, CSS 86.72 kB |
| Production frontend | **live and on HEAD** — see below |
| Production backend | live, Stripe configured |

---

## The frontend URL, which three handoffs said was recorded nowhere

**`https://alop-ai-omega.vercel.app`**

Vercel project `alop-ai`. **The project and team ids are in
`.vercel/repo.json`**, which is gitignored — deliberately not copied here, since
this repo is public. There is no `.vercel/project.json`, which is why every
previous look for a URL came back empty: the tooling reads that file, and the
ids live in the other one. Two more domains also serve it:
`alop-ai-evilmindseeworlds-projects.vercel.app` and
`alop-ai-git-main-evilmindseeworlds-projects.vercel.app`.

**It is deployed and it is on HEAD.** Not inferred — the deployed stylesheet is
`assets/index-PUAoFKub.css`, 86,724 bytes, and a local `npm run build` of HEAD
emits `assets/index-PUAoFKub.css` at 86.72 kB. Vite's hash is content-derived,
so an identical hash is an identical file. It also contains `.upgrade-label`,
which only exists in HEAD, and `.skip-link`, which only exists since `650d6a6`.

The previous handoff's "the Vercel deploy was **not** verified" is now resolved
and should not be re-litigated.

### Backend

`https://alop-ai.onrender.com` — `/health` returns `{"status":"ok","time":...}`.
`POST /api/create-checkout-session` returns **401**, which by the middleware
order below means **Stripe is configured**.

---

## Where the frontend overhaul got to

`docs/superpowers/specs/2026-07-31-frontend-overhaul-design.md` defines seven
sections. Six landed on 2026-07-31, one commit each, each with its cascade
baseline regenerated deliberately and the diff summarised in the message.

| § | | Commit | Tests after |
|---|---|---|---|
| §1 | Shell: one frame with hairlines, replacing three floating cards | `bc67854` | 347 |
| §2 | Sidebar: search, a 56px rail, keyboard nav, account block | `a67b5d2` | 369 |
| §3 | Transcript: the question stops shouting over the answer | `da9cc26` | 380 |
| §4 | Composer: paste and drop an image, tooltips on every control | `e4cf88d` | 388 |
| §5 | Motion: the ornament reports that the council is working | `650d6a6` | 391 |
| §6 | Accessibility: a skip link, tooltips that supplement `aria-label` | `650d6a6` | 391 |
| §7 | **Documentation and verification** | — | **not done** |

**§7 is the one thing left in the overhaul, and it is a real gap, not a
formality.** `docs/FRONTEND.md` lines 83–87 still document a fifteen-file
stylesheet manifest that includes `skeuomorphism` and `obsidian` — both deleted
in `680679a`. There are fifteen files in `frontend/src/styles/`, but not those
fifteen. FRONTEND.md is described in that same file as "the real handoff" for
anyone touching the frontend, so it is the first thing a newcomer reads and it
is currently wrong about the layer order.

§7 also asks for the gallery to carry every new primitive and be screenshotted
at 1440, 768 and 390.

Also on `main` from that day: `894ffce`, an SSRF guard for the council's
`read_url` tool, and two design docs — the overhaul spec above and
`2026-07-31-council-tool-calling-design.md`.

---

## `8568ede` — audited, and it is fine

The HEAD commit is `fix: uncommitted UI overhaul changes from interrupted
session`, with **an empty body and a 2,900-line cascade-baseline diff**. That
combination is exactly what the overhaul spec forbids: *"a section whose diff
contains something unexplained does not get committed."* So it was checked
rather than trusted, and the result is recorded here so nobody has to check it
again.

It is legitimate. Stripping the element indices out of both sides of the
baseline leaves **130 changed lines**, not 2,900:

```bash
B=frontend/src/__tests__/__snapshots__/cascade.baseline.txt
git show 8568ede^:$B | sed -E 's/\[[0-9]+\]//' > /tmp/before.txt
git show  8568ede:$B | sed -E 's/\[[0-9]+\]//' > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt
```

The 130 lines are two new `span.upgrade-label` elements — one per theme — with
their inherited declarations, plus the element count moving 712 → 714. **Every
other line moved because inserting an element renumbers every element after
it.** Nothing else in the cascade changed.

What the commit actually does: at the mobile breakpoint, Upgrade goes icon-only
so the chat title keeps the space. The baseline's third environment records
`.upgrade-btn { width: 40px; padding: 0; justify-content: center }` and
`.upgrade-label { display: none }`, so the new rules are under guard.

**Lesson worth keeping: an index-renumbering diff in the cascade baseline looks
identical to a catastrophic one.** Strip the indices before reading it. That
one `sed` turns an unreviewable 2,900-line diff into a 130-line one.

---

## Open, ranked

### 1. `backend/lib/url-guard.js` protects nothing yet

22 tests, all passing, and **`server.js` does not import it**. That is by design
— its commit message says it lands "first, alone, with nothing depending on it
yet", ahead of the council tool loop. But until that loop ships, the guard is
dead code, and the thing it exists to stop (`read_url` fetching
`169.254.169.254` on a model's say-so) is not yet reachable either. Both facts
have to stay true together: **if `read_url` ever gets wired up, the guard goes
in on the same commit.**

The design is in `docs/superpowers/specs/2026-07-31-council-tool-calling-design.md`
— propose → dedupe → broadcast, ceilings of 3 rounds / 8 unique calls / 8s per
call / 25s total.

### 2. `frontend/src/.env` is dead config

```
frontend/src/.env:  VITE_API_URL=http://localhost:3000
frontend/src/lib/api.js:  import.meta.env.VITE_API_BASE || "http://localhost:3000"
```

Two independent reasons it cannot work: Vite loads env files from the **project
root** (`frontend/`), never from `src/`, and the variable is named `VITE_API_URL`
while the code reads `VITE_API_BASE`.

**Production is unaffected** — the deployed bundle contains
`https://alop-ai.onrender.com`, so Vercel supplies `VITE_API_BASE` from its own
project settings. The cost is local: the file looks like the place to point the
frontend at a different backend, and editing it does nothing. Delete it, or move
it to `frontend/.env` with the right name.

### 3. No CI

`.github/` contains `copilot-instructions.md` and no workflows. 391 frontend
tests, 51 backend tests and a clean build run only when someone remembers. The
repo has a remote and the suites take seconds — this is one workflow file.

### 4. Blocked on the owner

- **Rotate and set `SENTRY_DSN` in Render.** Error reporting is off until then.
  The old DSN is in this public repo's history — rotate, do not reuse.
- **Confirm `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY`.** If unset,
  `/api/billing/prices` 503s and the upgrade path hides itself. No broken
  checkout, but no revenue either.
- **Confirm `GOOGLE_API_KEY`.** If unset, attaching an image returns a clear 503
  instead of vision.
- Confirmed present as of 2026-07-30: `CLERK_PUBLISHABLE_KEY`,
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- **`gh auth login`.** `gh` is installed at `C:\Program Files\GitHub CLI\gh.exe`
  but is not authenticated, so `gh pr create` fails. Plain `git push` works —
  that credential lives in Windows Credential Manager, and reading it back is
  blocked by the permission classifier. Opening a PR needs the owner.

### 5. Never exercised in a browser

**Dictation and regenerate** were both fixed in `1ec77a0` and are covered by
tests, but neither has been used in the real app since. Voice input had never
worked in this app's history, so nobody has ever seen it succeed.

### 6. Then

Slice B (AI smartness), then D (sign-in polish).

---

## Reference

**Read `docs/FRONTEND.md` before touching the frontend** — stacking scale,
stylesheet split and why import order *is* the cascade, how the snapshot works
and how to read a diff, the two Tailwind traps, the component map. Note §7
above: its stylesheet manifest is out of date.

```bash
cd frontend && npm test -- --run     # 391
cd backend  && npm test              # 51
cd frontend && npm run build         # clean, watch for chunk-size warnings

# Regenerate the cascade baseline ONLY when a rendering change is intended,
# and say what moved in the commit message:
UPDATE_CASCADE_BASELINE=1 npx vitest run src/__tests__/cssSnapshot.test.js

# Style gallery: npm run dev, then /gallery.html. Dev server only.
```

- **Reading a cascade-baseline diff:** strip `[0-9]+` indices from both sides
  first, or an inserted element reads as a total rewrite. See `8568ede` above.
- **Zero-cost production probing.** Middleware order makes some endpoints
  self-describing: `requireStripe` runs *before* `requireAuth` on
  `/api/create-checkout-session`, so **503 = Stripe unconfigured, 401 =
  configured**.
- **Render auto-deploys on merge to `main`**, but takes **over 5 minutes**
  (measured ~5.5 min, 11 polls at 30s). A session once concluded at 10 minutes
  that it had failed, and was wrong. Do not conclude anything before 10.
- **Supabase DDL works from here**, contrary to an older note. The service-role
  key cannot do it (PostgREST JWT), but the Management API takes arbitrary SQL
  with a personal token from
  `https://supabase.com/dashboard/account/tokens`:
  `POST https://api.supabase.com/v1/projects/<ref>/database/query`.
  `backend/scripts/run-migration.mjs` wraps it and verifies its own work. It
  derives the project ref from `SUPABASE_URL` in `backend/.env`, or takes
  `SUPABASE_PROJECT_REF` directly — the ref is deliberately not written here,
  because this repo is public and naming a project invites probing of its API
  host.
  `001_per_chat_memory.sql` applied and verified 2026-07-30; per-chat memory and
  feedback-learning are live.
- **`pkill` does not work on Windows.** Use
  `Get-Process node | Stop-Process -Force`, then confirm with
  `Get-NetTCPConnection -LocalPort <port>`. A stale process answering on the old
  port has already caused one misdiagnosis here.
- **`node --test lib/`** fails on Node 26 with `MODULE_NOT_FOUND`. Use the
  quoted glob: `node --test "lib/**/*.test.js"`.

---

## Closed since the last handoff

Do not re-open these; each was checked this session.

- **The Vercel deploy is verified.** URL above, byte-identical to a local build
  of HEAD.
- **`.app-root *` is gone.** `base.css` now carries only a comment recording
  what it was and why it went. Every transition is declared by the thing it
  animates.
- **`8568ede`'s unexplained baseline diff is explained.** 130 real lines.
- The slice-C CSS work (195 `!important` → 3, `App.css` 3,375 lines → a 31-line
  manifest plus 15 files, `App.jsx` 975 → ~520) is merged via
  [PR #1](https://github.com/evilmindseeworld/ALOP-AI/pull/1) and superseded by
  the overhaul above.

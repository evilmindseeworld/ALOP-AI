# ALOP-AI — Session Handoff

**Written:** 2026-07-31
**Repo:** `C:\Users\LENOVO\Documents\AI-Classroom` — `evilmindseeworld/ALOP-AI` (**PUBLIC**)
**Branch:** `css-cleanup-panel-extraction`, 17 commits ahead of `main`, not yet pushed.

---

## Where slice C got to

Slices A and the first half of C are on `main` and deployed. This branch
finishes C: the CSS foundation and the component extraction.

| | Before | After |
|---|---|---|
| `!important` | 195 | **3** |
| `App.css` | 3,375 lines, one file | **31-line manifest + 15 files** |
| Duplicate top-level selectors | 63 | 16 |
| `FIX:` sections | 7 | 0 |
| Dead rules | 64 | 0 |
| `App.jsx` | 975 lines | **~520**, composition only |
| Frontend tests | 89 | **279** |

`npm run build` is clean. The app bundle is unchanged in size; Radix sits in
its own chunk.

---

## What this actually fixed, beyond the counts

The refactor was guarded by a cascade snapshot (`docs/FRONTEND.md` §3), which
made it possible to prove most commits changed nothing. Three did change
things, all of them bugs the `!important` had been hiding:

1. **User and assistant avatars rendered identically.** `.dark .avatar` forced
   a grey gradient over `.msg-row.user .avatar` (pink) and
   `.msg-row.assistant .avatar` (emerald). Both were designed, written, and
   never once displayed.
2. **The stop button had no danger colour**, and the send button lost its
   gradient on hover.
3. **The typing indicator's stagger was dead** — a forced `animation` shorthand
   resets `animation-delay` with force, so all three dots bounced in unison —
   and `prefers-reduced-motion` never reached them for the same reason.

Roughly a dozen interactive states were restored in total; each is named in the
commit that restored it.

**Separately: every Tailwind padding and margin utility in the project was
silently dead** and had been since Tailwind was installed. Utilities were
layered, `base.css` has an unlayered `* { margin: 0; padding: 0 }`, and
unlayered beats layered regardless of specificity. Colour and size utilities
worked, so nothing looked obviously wrong until shadcn buttons rendered with
clipped labels. See `docs/FRONTEND.md` §4.

---

## Read this before touching the frontend

`docs/FRONTEND.md` is rewritten and is the real handoff. It covers the stacking
scale, the stylesheet split and why the import order is the cascade, how the
snapshot works and how to read a diff, the two Tailwind traps, the component
map, and the known gaps.

---

## Next steps

### Blocked on the user

1. **Set a rotated `SENTRY_DSN` in Render.** Error reporting is off until then.
   The old DSN is in this public repo's history — rotate, do not reuse.
2. **Confirm two Render env vars:**
   - `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY` — if unset,
     `/api/billing/prices` 503s and the upgrade path hides itself. No broken
     checkout, but no revenue either.
   - `GOOGLE_API_KEY` — if unset, attaching an image returns a clear 503
     instead of vision.

   Confirmed present already: `CLERK_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`,
   `STRIPE_WEBHOOK_SECRET`.

### Immediate technical

3. **Open the PR for this branch.** `gh` is still not installed; either
   `winget install GitHub.cli` or use
   `https://github.com/evilmindseeworld/ALOP-AI/compare/main...css-cleanup-panel-extraction?expand=1`.
4. **Remove `.app-root *`.** It sets a transition on every element in the app
   at the same specificity as each component's own rule, winning on source
   order alone. It is the reason 16 duplicate selectors could not be merged.
   Deliberately left: it is a behaviour change, not a refactor.
5. **Slice B (AI smartness)**, then D (sign-in polish).

---

## Reference

- **Regenerate the cascade baseline deliberately** — only when a rendering
  change is intended, and say so in the commit:
  `UPDATE_CASCADE_BASELINE=1 npx vitest run src/__tests__/cssSnapshot.test.js`
- **Style gallery:** `npm run dev`, then `/gallery.html`. Dev server only.
- **Verification:** `cd frontend && npm test` → 279; `cd backend && npm test` →
  29; `npm run build` → clean.
- **Zero-cost prod probing.** Middleware order makes some endpoints
  self-describing: `requireStripe` runs *before* `requireAuth` on
  `/api/create-checkout-session`, so **503 = Stripe unconfigured, 401 =
  configured**.
- **Production health:** `https://alop-ai.onrender.com/health`
- **Render auto-deploys on merge to `main`**, but takes **over 5 minutes**
  (measured: ~5.5 min). Do not conclude it failed before 10.
- **`pkill` does not work on Windows.** Use
  `Get-Process node | Stop-Process -Force`, then confirm with
  `Get-NetTCPConnection -LocalPort <port>`.
- **`node --test lib/`** fails on Node 26 with `MODULE_NOT_FOUND`. Use the
  quoted glob: `node --test "lib/**/*.test.js"`.

---

## Superseded

The plugin-install inventory, the Supabase migration notes and the slice A
anomalies from the previous handoff are all resolved and have been dropped.
The migration is applied and verified; slice A is merged.

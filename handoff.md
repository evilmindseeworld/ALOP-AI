# ALOP-AI — Session Handoff

**Written:** 2026-07-31
**Repo:** `C:\Users\LENOVO\Documents\AI-Classroom` — `evilmindseeworld/ALOP-AI` (**PUBLIC**)
**Branch:** `css-cleanup-panel-extraction` — reviewed, merged to `main`, deployed.

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
| Frontend tests | 89 | **283** |

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

## What the code review of the extraction turned up

Two bugs, both the same shape — a value read from a closure that a later step
had already invalidated. Both are fixed and covered by tests.

1. **Regenerate grew the transcript instead of replacing its tail.**
   `regenerateLast` truncated the messages and then called `send()`, but that
   `send` was captured on the same render and still held the pre-truncation
   copy. The answer it had just deleted came back, with the question duplicated
   underneath. `send()` now takes the base messages to append to.
2. **Dictation reached the screen and nothing else.** The transcript was written
   with `el.value += text`, which passes through React's value tracker — the
   tracker records the assignment, then sees no change when the input event
   arrives and skips `onChange`. The words appeared, the composer's state never
   learned about them, and Send posted an empty message. `lib/dom.js` goes
   through the prototype setter, which is what makes the event reach React.
   Voice input has never once worked in this app; it does now.

Everything else in the extraction held up: the hooks, the palette, the panels
and the billing flow were read end to end and no third issue survived checking.

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

3. **Remove `.app-root *`.** It sets a transition on every element in the app
   at the same specificity as each component's own rule, winning on source
   order alone. It is the reason 16 duplicate selectors could not be merged.
   Deliberately left: it is a behaviour change, not a refactor.
4. **Check dictation and regenerate against the real app.** Both are fixed and
   tested, but neither has been exercised in a browser since — voice input in
   particular has never worked, so nobody has seen it succeed.
5. **Slice B (AI smartness)**, then D (sign-in polish).

---

## Reference

- **Regenerate the cascade baseline deliberately** — only when a rendering
  change is intended, and say so in the commit:
  `UPDATE_CASCADE_BASELINE=1 npx vitest run src/__tests__/cssSnapshot.test.js`
- **Style gallery:** `npm run dev`, then `/gallery.html`. Dev server only.
- **Verification:** `cd frontend && npm test` → 283; `cd backend && npm test` →
  29; `npm run build` → clean.
- **`gh` is installed now** (`C:\Program Files\GitHub CLI\gh.exe`). The previous
  handoff's "gh is not installed, use the compare URL" note is stale.
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

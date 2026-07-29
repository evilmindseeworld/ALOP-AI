# Slice A — Every feature the UI advertises should actually work

Spec: `docs/superpowers/specs/2026-07-30-phantom-features-design.md`
Plan: `docs/superpowers/plans/2026-07-30-phantom-features-plan.md`

Five features rendered in the UI did nothing. That is worse than a missing
feature: the interface made a promise and quietly broke it.

## What was broken

| Feature | What the user saw | What actually happened |
|---|---|---|
| Pin / Favorite | Toggles, list re-sorts | `PUT /api/chats/:id` destructured only `{ messages, title }`. Never persisted. |
| Camera | Full capture UI | `c.toBlob((b) => { stopCamera(); })` — the blob was **discarded**. |
| Image upload | Picker filtered to images | Immediately toasted "File upload disabled in Council mode". |
| Pro plan | Header advertises "7 models" | `create-checkout-session` had **zero callers**. No way to become Pro. |
| `/api/quick`, `/api/vision`, `/api/image` | — | Zero callers. Dead code. |

## What changed

**Pin/Favorite persist.** `PUT` now accepts both fields. The non-obvious part:
the route set `updated_at` unconditionally and the sidebar sorts on it, so the
naive fix would have yanked a chat to the top of the list purely for being
pinned. `updated_at` now bumps only when `messages` change.

**Camera and upload work.** `capturePhoto` uses `toDataURL` — the call the
overlay's screen capture already made. Uploads downscale to 1568px so the 8 MB
backend ceiling is never reached rather than reached and reported.

**The council can see images.** `/api/council` accepts an image, describes it
via Gemini and passes the description through `contextMsgs`. Two deliberate
differences from the overlay's implementation it is modelled on:

- MIME is parsed from the payload, not hardcoded to `image/png`. Screenshots
  are PNG so the overlay never noticed, but an uploaded JPEG was being
  described to Gemini under the wrong type.
- Failures are returned, not swallowed. The overlay skips vision silently and
  answers as though nothing were attached — indistinguishable to the user from
  having looked and seen nothing.

The memory-bypass and greeting branches are skipped when an image is present:
both build their own message arrays and never read `contextMsgs`.

**Pro is reachable.** New `GET /api/billing/prices` reads real Stripe Price
objects so the paywall can never advertise a figure that differs from the
charge. Missing price IDs return 503, not 500 — the server is healthy, this
deployment just cannot sell anything, and the UI hides the upgrade path rather
than rendering a checkout that would fail. Also handles `?payment=success`,
which Stripe has been redirecting to all along with nothing reading it; the
plan re-fetch polls briefly because the webhook can land after the redirect.

**Dead code removed.** 93 lines. `ALOP-Overlay.ahk` references no endpoints.

## Bugs found while implementing

- `updated_at` bumping would have broken sidebar ordering (above).
- `createChat()` ran *before* the image-request check, while `generateImage`
  calls it again from a closure that still sees the old `activeChatId` — so
  `/image` on a fresh session created **two** chat rows.

## Tests

The backend had **no test script and no framework**. It now uses `node:test`
(built in, zero new dependencies). Rules that needed testing moved to
`backend/lib/`, because `server.js` calls `process.exit(1)` at import time when
env vars are missing, which makes it untestable by construction.

**4 tests → 50** (29 backend, 21 frontend).

## Deployment notes

Neither blocks merge; both degrade gracefully, but both decide whether the new
features work in production on day one:

- **`STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY`** — if unset, the prices
  endpoint 503s and the upgrade path hides itself. `STRIPE_SECRET_KEY` and
  `STRIPE_WEBHOOK_SECRET` are confirmed present in Render.
- **`GOOGLE_API_KEY`** — if unset, attaching an image returns a clear 503
  rather than silently ignoring it.

# Slice A — Every feature the UI advertises should actually work

**Date:** 2026-07-30
**Status:** Approved (Sections 1–2 reviewed; Section 3 written from the same design pass)

## Problem

ALOP-AI renders several features that do nothing. This is worse than missing
features: the interface makes a promise and then quietly breaks it.

| Feature | What the user sees | What actually happens |
|---|---|---|
| Pin / Favorite | Toggles, and the list re-sorts | `PUT /api/chats/:id` destructures only `{ messages, title }`. Never persisted; lost on reload. |
| Camera | Full capture UI with a Capture button | `capturePhoto` sizes the canvas, draws the frame, then `c.toBlob((b) => { stopCamera(); })` — the blob is discarded. |
| Image upload | File picker filtered to images | Immediately toasts "File upload disabled in Council mode". |
| Pro plan | Header advertises "7 models" vs "4 models" | `create-checkout-session` and `create-portal-session` have zero frontend callers. There is no way to become Pro. |
| `/api/quick`, `/api/vision`, `/api/image` | — | Zero callers. Dead backend code. |

Two supporting facts established by probing production:

- `POST /api/create-checkout-session` returns **401, not 503**. Since
  `requireStripe` runs *before* `requireAuth`, this proves `STRIPE_ENABLED` is
  true — both `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set in Render.
  **Billing is fully live on the backend; only the UI is missing.**
- The checkout `success_url` is `${FRONTEND_URL}/?payment=success`, but
  `App.jsx` only ever reads the `desktop` query param. A completed payment
  currently returns the user to an unchanged page with no confirmation.

## Scope

**In:** the five rows above.
**Out:** the CSS/design overhaul (slice C), council answer quality (slice B),
sign-in polish (slice D), and the unrun Supabase migration — which this slice
does **not** depend on (see Section 1).

## Section 1 — Persistence and dead code

### Pin / Favorite

`GET /api/chats` already selects `pinned,favorite` and production loads chats
without error, so **both columns already exist**. No migration required; this
slice is unblocked by the outstanding `001_per_chat_memory.sql`.

`PUT /api/chats/:id` accepts `pinned` and `favorite`, coerced with `Boolean()`.

**The trap:** the route sets `updated_at: new Date().toISOString()`
unconditionally, and `sortedChats` uses `updated_at` as its final tiebreaker.
The naive fix therefore makes pinning a chat yank it to the top of the list as
if you had just posted in it. `updated_at` must bump **only when `messages`
change**. Pinning is not activity.

To make any of this testable, the payload construction moves out of the route
body into a pure `buildChatUpdate(body)` function. This is the only refactor in
the slice, and only because we are already editing that expression.

Frontend `togglePinChat` / `toggleFavoriteChat` become optimistic: flip local
state immediately, call the API, revert and toast on failure.

### Dead code

Delete `/api/quick`, `/api/vision`, and `/api/image`. Each has zero frontend
callers; `ALOP-Overlay.ahk` references no endpoints at all; and after Section 2
the overlay reaches vision through `callGeminiVision` directly. ~100 lines out.

## Section 2 — Vision in the council

`POST /api/council` accepts an `image` field, mirroring the overlay's proven
path: validate the data URL, reject payloads over 8 MB, describe the image via
`callGeminiVision`, and inject that description as text context for the council.

Two deliberate departures from the overlay's implementation:

1. **MIME type is parsed, not assumed.** The overlay hardcodes `'image/png'`.
   Uploads are routinely JPEG or WebP, so the real type is read from the data
   URL prefix rather than inheriting that bug.
2. **Vision failure is surfaced, not swallowed.** The overlay silently skips
   vision on error. Council must not: answering as though no image were
   attached is a subtler lie than the one this slice exists to fix. If
   `GOOGLE_API_KEY` is absent or Gemini errors, an explicit notice frame is
   emitted.

Vision is a blocking pre-step before the stream opens, so the route emits a
`{ type: 'status' }` frame first, letting the UI show "Looking at your image…"
instead of sitting silent for several seconds.

Frontend:

- `capturePhoto` uses `canvas.toDataURL()` — the same call
  `captureFromLiveStream` already makes — instead of building a blob and
  dropping it.
- `handleFileSelect` reads to a data URL, downscaling through a canvas before
  the 8 MB ceiling can be breached.
- Attached images render inside the user's own message bubble, so the user can
  see what they actually sent.

## Section 3 — Billing

### `GET /api/billing/prices`

New endpoint behind `requireStripe`, returning real figures read from the
Stripe Price objects so the displayed price can never drift from the charge:

```json
{ "monthly": { "amount": 900, "currency": "usd", "interval": "month" },
  "yearly":  { "amount": 9000, "currency": "usd", "interval": "year" } }
```

Results are cached in module memory with a 1-hour TTL — prices change rarely,
and this avoids a Stripe round-trip on every page load.

`STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY` could not be verified by
probing (they are read per-request, and the route needs auth). If either is
missing or invalid, the endpoint returns **503 with a clear message rather than
500**, so the UI hides the upgrade path instead of rendering a broken paywall.

### Frontend

- An Upgrade panel reusing the existing `.side-panel` pattern from Settings and
  Admin: Free vs Pro comparison with real prices, and Monthly / Yearly buttons.
- Entry points: an upgrade affordance in the header for free users; "Manage
  subscription" in Settings for Pro users, routing to the portal session.
- `?payment=success` / `?payment=cancelled` handling on mount: toast, re-fetch
  the plan, and `history.replaceState` to strip the param so a refresh does not
  re-toast.

The plan re-fetch retries briefly. The Stripe webhook that flips the user to
Pro can land *after* the browser redirect, so reading the plan once and
believing it would show a just-paid user as still Free.

## Error handling

| Failure | Behaviour |
|---|---|
| Pin/favorite write fails | Optimistic state reverts, toast shown |
| Image over 8 MB | Downscaled client-side before send; rejected server-side as a backstop |
| `GOOGLE_API_KEY` missing / Gemini errors | Explicit notice frame — never a silent answer that ignores the image |
| Price ID missing or invalid | 503 from the endpoint; UI hides the upgrade path |
| Webhook lags the redirect | Plan re-fetch retries briefly before settling |

## Testing

**The backend currently has no test script and no test framework** — only the
frontend does (Vitest + Testing Library + jsdom, 4 tests, all covering
`Earring`). This slice adds `node:test` to the backend: built in, zero new
dependencies, and enough for the pure functions being extracted.

Backend:
- `buildChatUpdate` — coerces `pinned`/`favorite`; bumps `updated_at` only when
  `messages` are present. This is the regression test for the sort-order trap.
- Data-URL parsing — extracts MIME and rejects malformed or oversized input.

Frontend:
- `InputBar` attaches an image, renders the pill, and clears it on send.
- Upgrade panel stays hidden when the prices endpoint returns 503.
- `?payment=success` shows a toast and strips the param.

## Pre-flight checks

Two things could not be determined from outside and must be confirmed during
implementation rather than assumed:

1. `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY` are set in Render.
2. `GOOGLE_API_KEY` is set in Render. Vision degrades to an explicit notice
   without it, so this is not a blocker — but it does decide whether the
   feature actually works in production on day one.

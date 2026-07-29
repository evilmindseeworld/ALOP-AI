# Implementation Plan — Slice A

Spec: `../specs/2026-07-30-phantom-features-design.md`
Branch: `slice-a-phantom-features`

Ordered so the lowest-risk, independently-shippable work lands first. Each task
ends in a verification that must pass before moving on.

---

## Task 1 — Persist pin/favorite (backend)

1. Add a pure `buildChatUpdate(body)` above the routes in `backend/server.js`:
   - `title` → `sanitizeString(title, 120)` when defined
   - `messages` → existing clamp/map logic when defined; **only this branch sets
     `updated_at`**
   - `pinned` / `favorite` → `Boolean(...)` when defined
2. Rewrite `PUT /api/chats/:id` to call it.
3. Reject an update whose resulting payload is empty (400) rather than issuing a
   no-op write.

**Verify:** `node --check backend/server.js`

## Task 2 — Backend test harness

1. Add `"test": "node --test"` to `backend/package.json`.
2. Export `buildChatUpdate` from `server.js` without executing the server on
   import (guard the `listen` call with `require.main === module`).
3. `backend/server.test.js` covering:
   - `pinned: true` persists as boolean `true`
   - a pin-only update does **not** set `updated_at` (the sort-order regression)
   - a messages update **does** set `updated_at`
   - an empty body yields an empty payload

**Verify:** `cd backend && npm test` — all pass.

## Task 3 — Optimistic pin/favorite (frontend)

1. `togglePinChat` / `toggleFavoriteChat` become async: flip local state, then
   `PUT` the new value.
2. On failure, revert the flip and `setToast`.

**Verify:** `npm run build` clean.

## Task 4 — Remove dead endpoints

Delete `/api/quick`, `/api/vision`, `/api/image` and any helpers left with no
remaining callers. Keep `callGeminiVision` — the overlay uses it, and Task 5
will too.

**Verify:** `node --check backend/server.js`; grep confirms zero references.

## Task 5 — Council vision (backend)

1. Add pure `parseDataUrl(s)` → `{ mime, base64 }` or `null`. Rejects anything
   not matching `data:image/<type>;base64,` and anything over 8 MB decoded.
2. In `/api/council`, when `image` is present:
   - emit `{ type: 'status', text: 'Looking at your image…' }`
   - `callGeminiVision(model, prompt, base64, mime, 1024)` using the **parsed**
     MIME, not a hardcoded `image/png`
   - inject the description into the council context
   - on missing `GOOGLE_API_KEY` or a thrown error, emit
     `{ type: 'notice', text: ... }` — never proceed silently
3. Add `parseDataUrl` tests to `server.test.js` (valid png/jpeg/webp, malformed
   input, oversized input).

**Verify:** `cd backend && npm test`; `node --check`.

## Task 6 — Real camera and upload (frontend)

1. `capturePhoto`: replace the discarding `toBlob` with `canvas.toDataURL('image/png')`,
   attach the result, stop the camera.
2. `handleFileSelect`: read to a data URL and downscale via canvas so the longest
   edge is ≤ 1568 px before attaching.
3. Thread `image` through `handleSend` into the `/api/council` body.
4. Render an attached image inside the user's message bubble.
5. Handle the new `status` and `notice` stream frames in the read loop.

**Verify:** `npm run build` clean; `npm test` passes.

## Task 7 — Prices endpoint (backend)

1. `GET /api/billing/prices` behind `requireStripe`.
2. Retrieve both Price objects; cache in module memory with a 1-hour TTL.
3. Missing/invalid price ID → **503** with a clear message (not 500).

**Verify:** `node --check`; boot locally and confirm 503 when Stripe is unset.

## Task 8 — Upgrade UI (frontend)

1. Upgrade panel reusing the `.side-panel` pattern: Free vs Pro comparison,
   real prices, Monthly / Yearly buttons → `create-checkout-session`, redirect
   to the returned URL.
2. Header entry point for free users; Settings → "Manage subscription" for Pro
   users → `create-portal-session`.
3. Hide the upgrade path entirely if `/api/billing/prices` returns 503.
4. On mount, read `?payment=`: toast, re-fetch plan with a short retry to
   absorb webhook lag, then `history.replaceState` to strip the param.

**Verify:** `npm run build`; `npm test`.

## Task 9 — Full verification

1. `cd backend && npm test`
2. `cd frontend && npm test && npm run build`
3. Boot the backend locally with dummy env; confirm the auth behaviour from the
   previous session still holds (401 unauthenticated, not 500).
4. Report the two pre-flight unknowns from the spec.

# ALOP-AI Frontend — Architecture & Conventions

Read this before changing styling. Most of it exists because something went
wrong repeatedly, and the rule is what stopped it.

---

## 1. The stacking scale — read this before touching any z-index

**Never write a bare `z-index` number.** Use a token from the `--z-*` scale in
`App.css`.

Nine commits were spent guessing earring z-index values (`302b5aa`, `1c48887`,
`611a39e`, `76b9d7f`, `bf0647b`, `c00a0ce`, …). The values were never the
problem — nothing recorded the intended order, so every change was a guess
against an invisible spec.

The scale, lowest to highest:

| Token | Value | Owner |
|---|---|---|
| `--z-behind` | 0 | `.app-root::after` background wash |
| `--z-backdrop` | 1 | `.scanlines` texture |
| `--z-chat` | 3 | `.chat-main` — **creates a stacking context** |
| `--z-earring` | 4 | decoration: above chat, below every menu |
| `--z-sidebar` | 10 | `.sidebar` (desktop) |
| `--z-sidebar-mobile` | 50 | `.sidebar.mobile` |
| `--z-panel-overlay` | 60 | click-away scrim |
| `--z-panel` | 70 | settings / admin / upgrade |
| `--z-in-chat-control` | 80 | `.code-copy-btn`, `.scroll-down-btn` — **scoped inside `--z-chat`** |
| `--z-camera` | 100 | fullscreen capture |
| `--z-toast` | 200 | must clear every panel |
| `--z-cmdk` | 300 | command palette |
| `--z-fab` | 9999 | `.quick-ask-fab` |
| `--z-quick-ask` | 10000 | true top layer |

### The trap that keeps catching people

`--z-in-chat-control` is **80**, higher than `--z-panel` at **70**. This looks
like a bug and has been "fixed" before. It is not one.

`.chat-main` is positioned and sits at `--z-chat`, which creates a **stacking
context**. Every descendant is composited within that context, so a child at 80
is still painted below anything at `--z-earring` (4) or above in the root
context. A copy button cannot cover the settings panel no matter how large its
number is.

If you remove `position: relative` from `.chat-main`, that containment
disappears and in-chat controls will punch through every panel.
`zIndexOrder.test.js` asserts the positioning for exactly this reason.

### The guard

`src/__tests__/zIndexOrder.test.js` parses `App.css` and asserts every adjacent
pair in the scale. It has been verified against two deliberate regressions —
raising `--z-earring` above the sidebar, and swapping a token for a bare
number. Both were caught, and the failure names the inverted pair.

To add a layer: add the token to `:root`, then add it to the `ascending` array
in the test. The test is the spec.

---

## 2. Tailwind is additive, not a migration

`App.css` is ~3,100 hand-written lines on a mature token system. Tailwind is
installed so shadcn/ui and 21st.dev components can be dropped in and new UI can
be written without growing that file. It is **not** replacing it.

### Preflight is deliberately excluded

`src/tailwind.css` imports `theme.css` and `utilities.css` separately rather
than `@import "tailwindcss"`. The bundle import pulls in **Preflight**, which
globally resets margins, heading sizes and weights, list styles and border
colours — all of which `App.css` depends on. Importing it wholesale visually
destroys the app in a way that reads as "the CSS broke", not "a reset ran".

Verified absent from build output: `font-size:inherit;font-weight:inherit`,
`list-style:none`, `border-style:solid`, `-moz-tab-size`,
`text-decoration:inherit`.

If you ever do want Preflight, that is a migration with a visual audit, not a
one-line change.

### The token bridge

The `@theme inline` block maps Tailwind's palette to the **same CSS variables**
`App.css` uses, rather than restating literals:

```css
--color-surface-2: var(--surface-2);
```

So `bg-surface-2` compiles to `background-color: var(--surface-2)` — the same
value a hand-written rule produces, and both follow the light/dark toggle
because they dereference the same variable at runtime. A literal here is how
the two systems would drift: the utility and the rule would render different
colours and the theme switch would only move one.

The stacking scale is bridged too, so `z-panel` resolves to `var(--z-panel)`
and `zIndexOrder.test.js` governs Tailwind utilities as well.

`tailwindSetup.test.js` asserts every bridged colour is a `var(...)` reference,
that only tokens `App.css` actually defines are bridged, and that Preflight
never sneaks back in.

### Why App.css always wins

Tailwind utilities live in `@layer utilities`. **Unlayered CSS outranks layered
CSS regardless of source order**, so `App.css` beats any Tailwind utility on
conflict, by construction. That is intentional: Tailwind is available for new
components without being able to disturb existing ones.

The consequence: a Tailwind class on an element `App.css` already styles will
appear to do nothing. That is the safety property working, not a bug. Style new
components with Tailwind, existing ones with `App.css`.

---

## 3. Testing

```bash
cd frontend && npm test     # Vitest + Testing Library + jsdom
cd backend  && npm test     # node:test, zero dependencies
```

### jsdom gaps stubbed in `src/test/setup.js`

- `<model-viewer>` is registered by a script tag that never runs under jsdom.
- `Element.prototype.scrollIntoView` / `scrollTo` **do not exist** in jsdom —
  calling them throws rather than no-opping. Stubbed in setup so the guard
  stays out of production code, where the methods genuinely exist.

### Backend tests live in `backend/lib/`, not next to `server.js`

`server.js` calls `process.exit(1)` at import time when required env vars are
missing, which makes it untestable by construction — importing it kills the
test runner. Logic worth asserting on is extracted to `backend/lib/` as pure,
side-effect-free modules.

Run with a **quoted glob** so Node globs rather than the shell:
`node --test "lib/**/*.test.js"`. The directory form (`node --test lib/`) fails
on Node 26 with `MODULE_NOT_FOUND`.

---

## 4. Conventions worth knowing

**Attachment bytes are never persisted.** `buildChatUpdate` whitelists message
fields and keeps only a `hasImage` flag. A data URL runs to megabytes and a row
holds up to 200 messages. In-session previews live in `imagePreview`, which the
server strips; after a reload the flag renders an "Image attached" marker.

**`updated_at` bumps only when `messages` change.** The sidebar sorts on it, so
bumping it on a pin or rename would yank a chat to the top as though it had
just been posted in.

**Vision failures are surfaced, never swallowed.** `/api/overlay` skips vision
silently on error and answers as if nothing were attached — indistinguishable
to the user from having looked and seen nothing. `/api/council` returns
400/502/503 before the stream opens instead.

**MIME is parsed, not assumed.** `parseDataUrl` reads the real type from the
payload. `/api/overlay` hardcodes `image/png`; screenshots are PNG so it never
noticed, but an uploaded JPEG went to Gemini under the wrong type.

---

## 5. Known gaps

- **Bundle is ~1.12 MB** (373 kB gzipped) and Vite warns on every build. No
  code splitting yet; `react-syntax-highlighter` and `animejs` are the obvious
  candidates for a dynamic import.
- **`App.css` still carries ~202 `!important` declarations.** The z-index war
  is over, but the specificity war is not. These are the next target.
- **`App.jsx` is ~800 lines.** `CommandPalette` was extracted; the settings,
  admin and upgrade panels are the next candidates.

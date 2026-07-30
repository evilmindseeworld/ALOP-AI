# Slice C — CSS foundation and component extraction

**Date:** 2026-07-30
**Branch:** `css-cleanup-panel-extraction`
**Supersedes the "Still open in slice C" note in `handoff.md`.**

---

## The problem

`App.css` is 3,375 lines with **195 `!important` declarations**. `App.jsx` is 975 lines.

The `!important` count is a symptom. The cause is visible in the file's own section
headers:

```
/* ===== FIX: header buttons horizontal ===== */     (line 2233)
/* ===== FIX: HEADER HORIZONTAL ===== */             (line 2465)
```

The same fix, twice, 232 lines apart, eleven `!important` between them. And:

```
/* ===== FIX: settings panel rows horizontal ===== */  (line 2242)
/* ===== FIX: SETTINGS ROWS HORIZONTAL ===== */        (line 2475)
```

Every fix for the life of this file was **appended at the bottom** rather than edited
in place. When the earlier duplicate won the cascade, the new copy got `!important`.
That habit produced:

| Appended block | `!important` | What it actually is |
|---|---|---|
| `DARK MODE REWORK: Obsidian Night` | 68 | a second dark theme overriding the `:root` token block |
| `SKEUOMORPHISM` | 41 | a shadow/border pass over components styled 1,500 lines above |
| `OVERLAY UI UPDATE` | 23 | the same, for the overlay assistant |
| six `FIX:` sections | 31 | layout fixes, several of them duplicated |
| `RESPONSIVE` + `UTILITIES` | 12 | `.mobile-only` / `.desktop-only` display toggles |
| `prefers-reduced-motion` | 3 | **correct — this one stays** |

Duplicate top-level selectors follow the same shape: `.msg-row` ×4, `.app-header` ×3,
`.header-actions` ×3, `.bubble` ×3, `.setting-row` ×3, `.typing-bubble` ×3,
`.empty-logo` ×3, `.chat-item.active` ×3, `.input-btn.primary` ×3, and every
`.markdown-body` rule ×3.

**Removing the `!important` without removing the bottom of the file re-runs this in six
months.** The fix has two halves: fold the overrides into the rules they override, then
split the file so there is no single bottom to paste at.

---

## The instrument: cascade snapshots

Deleting 192 `!important` declarations can silently change what renders, and nothing in
the existing suite would notice.

- **jsdom's `getComputedStyle` cannot resolve a real cascade.** It does not do
  specificity ordering across stylesheets, and it does not expand shorthands. It will
  report a value; it will not report *the winner*.
- **Screenshot diffing is fuzzy and slow**, and an antialiasing delta looks the same as
  a broken layout.

So the guard is a **cascade snapshot** — `src/test/cssCascade.js`:

1. Parse the stylesheet into an ordered list of
   `{ media, selector, specificity, order, declarations }`.
2. Render a fixture DOM containing every component's real markup.
3. For each element, collect every rule whose selector matches via
   `element.matches()` — jsdom implements selector matching correctly, including
   descendant, child, attribute and `:not()`.
4. Sort candidates by `(!important, specificity, source order)` and take the winner per
   property.
5. Emit a deterministic text snapshot.

Evaluated across the full matrix:

- theme: `dark`, `light`
- viewport: 1400px, 900px, 400px
- `prefers-reduced-motion: reduce` on and off
- element state: base, `:hover`, `:focus`, `:focus-visible`, `:active`, `:disabled`
- pseudo-elements: `::before`, `::after`

The baseline is generated from `App.css` **as it exists on `main`** and committed before
any refactor commit. **Every Phase 1 commit must leave that snapshot byte-identical.**

The harness is itself tested: it must catch a deliberately injected regression (an
`!important` removed where it was load-bearing), or it is not a guard.

### Second instrument: the gallery

`frontend/gallery.html` — a separate Vite entry, not part of the app bundle — renders
every component's markup against the real stylesheet. Playwright screenshots it before
and after for the human-eye check a text snapshot cannot give. It doubles as living
documentation of the component inventory.

---

## Phase 1 — refactor, provably pixel-identical

Each step is one commit. Snapshot identical after every one.

| Step | Work | `!important` |
|---|---|---|
| 1.1 | Fold the six `FIX:` sections into the rules that own the selectors; delete the sections | 31 → 0 |
| 1.2 | Fold `SKEUOMORPHISM` shadows and borders into the component rules | 41 → 0 |
| 1.3 | Fold `OVERLAY UI UPDATE` into the overlay rules | 23 → 0 |
| 1.4 | Fold `DARK MODE REWORK: Obsidian Night` into the `:root` / `.dark` token block | 68 → 0 |
| 1.5 | `.mobile-only` / `.desktop-only` by specificity rather than force | 12 → 0 |
| 1.6 | Collapse every duplicate top-level selector into one rule | — |
| 1.7 | Split into `src/styles/*.css` | — |
| 1.8 | Tighten the `cssHygiene` ratchets to the new floor | — |

**Final count: 3.** The `prefers-reduced-motion` block keeps its `!important`, because
overriding an author's animation for a user with a vestibular disorder is exactly what
the keyword is for. It gets a comment saying so, and the ratchet's budget of 3 makes
that intent load-bearing.

### 1.7 — the split

```
src/styles/
  tokens.css      design tokens, both themes, the --z-* scale
  base.css        reset, scrollbars, typography
  layout.css      app shell, header, body
  sidebar.css     sidebar, chat list
  chat.css        messages, bubbles, empty state, starters
  composer.css    input bar, attachments, in-chat controls
  panels.css      side panels, settings, admin, upgrade, camera, toast
  overlay.css     the overlay assistant
  markdown.css    .markdown-body
  motion.css      keyframes, transitions, reduced-motion
```

`App.css` becomes an ordered `@import` manifest with a comment explaining that the order
*is* the cascade. Import order is asserted by test, because the split is only safe while
the order holds.

### 1.9 / 1.10 — extraction

`App.jsx` 975 → ~180 lines of composition.

```
src/lib/format.js       uid, isImageRequest, parseImagePrompt, buildImageUrl,
                        generateChatTitle, formatPrice
src/lib/storage.js      Storage
src/lib/image.js        fileToDataUrl, MAX_IMAGE_EDGE
src/lib/api.js          useApi
src/constants/starters.js
src/hooks/useChats.js               chat CRUD, council streaming, abort
src/hooks/useBilling.js             prices, checkout, portal, ?payment= handling
src/hooks/useSpeechRecognition.js
src/hooks/useCamera.js
src/components/Icon.jsx
src/components/Skeletons.jsx        InitialLoader, AppSkeleton
src/components/ChatSidebar.jsx      + ChatItem
src/components/InputBar.jsx
src/components/MessageList.jsx      + MessageActions, markdownComponents
src/components/Earring.jsx
src/components/CameraOverlay.jsx
src/components/panels/SettingsPanel.jsx
src/components/panels/AdminPanel.jsx
src/components/panels/UpgradePanel.jsx
src/overlay/OverlayAssistant.jsx
```

Four test files import `InputBar`, `Earring`, `STARTERS` and `formatPrice` from
`../App`. Those imports move to the real homes — the test should point at where the
thing lives, not at a re-export kept alive to avoid touching the test.

Every extraction is test-first. `OverlayAssistant` has **no tests today**; it gains them
before it moves, not after.

---

## Phase 2 — the shadcn/ui component layer

### The blocker, stated plainly

shadcn's documented install replaces the stylesheet with `@import "tailwindcss"`, which
pulls in **Preflight**. `src/tailwind.css` deliberately does not do that, and
`tailwindSetup.test.js` exists specifically to keep Preflight out — it resets margins,
heading sizes and weights, list styles and border colours, all of which `App.css`
depends on. Importing it wholesale looks like "the CSS broke", not "a reset ran".

### The resolution: a scoped reset

`src/styles/ui-reset.css` applies only the subset Radix and shadcn actually require,
scoped to `[data-ui-scope]` and its descendants:

- `box-sizing: border-box`
- `button, input, select, textarea { font: inherit; background: transparent; border: 0 }`
- `*, ::before, ::after { border-style: solid; border-width: 0 }`
- `svg { display: block }`
- heading and list resets

Preflight stays out. `tailwindSetup.test.js` stays green, and a new test asserts the
scoped reset emits no unscoped selector — if a rule escapes the scope, the build fails
rather than the app quietly changing.

### Token bridge

shadcn's semantic tokens map to the ALOP variables in the existing `@theme inline`
block, the same pattern §2 of `FRONTEND.md` already establishes:

```css
--color-background: var(--bg);
--color-foreground: var(--text);
--color-primary:    var(--primary);
--color-border:     var(--border);
--color-ring:       var(--border-focus);
--color-muted:      var(--surface-2);
--color-popover:    var(--surface-3);
--color-card:       var(--surface-2);
--color-destructive: var(--danger);
```

Both systems then dereference the same variable at runtime, so the theme toggle moves
both at once. A literal here is how they would drift.

### Configuration

`components.json` with `"tsx": false` — this repo is JSX, not TypeScript. The `@` alias
is added to both `vite.config.js` `resolve.alias` and the Vitest config, because a test
that cannot resolve `@/components/ui/button` fails in a way that looks like a missing
file.

### Primitives

Sheet, Dialog, Button (CVA variants), Command (cmdk), Switch, Tabs, Tooltip,
DropdownMenu, ScrollArea, Skeleton, Separator, Badge, Sonner.

### Migration

- `SidePanel` → Sheet. **It gains a focus trap it does not have today** — currently
  `Tab` from an open settings panel walks straight into the chat behind it.
- `CommandPalette` → Command/cmdk. `CommandPalette.test.jsx` must stay green, including
  the dropped-first-keystroke regression it already guards.
- `toast` → Sonner.
- theme toggle → Switch.

---

## Testing

| Layer | Guard |
|---|---|
| CSS behaviour | cascade snapshot, byte-identical across all of Phase 1 |
| CSS hygiene | `cssHygiene.test.js` ratchets: `!important` ≤ 3, duplicates 0, `FIX:` 0 |
| CSS structure | import-order test — the split is only safe while order holds |
| Stacking | existing `zIndexOrder.test.js`, unchanged |
| Tailwind | existing `tailwindSetup.test.js` + new unscoped-reset test |
| Components | per-module tests, written before each extraction |
| Visual | `gallery.html` screenshots before/after |

Existing suite is 118 tests (29 backend, 89 frontend) and must not regress.

---

## Risks

1. **1.4 is the dangerous step.** Folding Obsidian Night collapses two dark themes into
   one token set. The snapshot catches drift, but this gets its own commit and its own
   verification pass, and is the one step where a snapshot diff should be read line by
   line rather than trusted as a pass/fail.
2. **cmdk swap.** The hand-rolled palette has a regression test for a bug that took a
   session to find. The replacement must pass it unmodified.
3. **`OverlayAssistant` has no tests.** It is 124 lines handling `getDisplayMedia`,
   `SpeechRecognition` and `speechSynthesis` — all three absent from jsdom. Test-first
   means stubbing them in `setup.js` before the move.
4. **The scoped reset could leak.** A single unscoped selector reintroduces the
   Preflight problem in miniature. Asserted by test rather than by review.

## Non-goals

- No visual redesign in Phase 1. Any pixel change there is a bug by definition.
- Preflight is not adopted. That remains a migration with a visual audit.
- Slices B (AI smartness) and D (sign-in polish) are untouched.

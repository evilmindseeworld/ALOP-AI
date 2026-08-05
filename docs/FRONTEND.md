# ALOP-AI Frontend — Architecture & Conventions

Read this before changing styling or adding a component. Almost everything here
exists because something went wrong repeatedly, and the rule is what stopped it.

---

## 1. The stacking scale — read this before touching any z-index

**Never write a bare `z-index` number.** Use a token from the `--z-*` scale in
`src/styles/tokens.css`.

Nine commits were spent guessing earring z-index values (`302b5aa`, `1c48887`,
`611a39e`, `76b9d7f`, `bf0647b`, `c00a0ce`, …). The values were never the
problem — nothing recorded the intended order, so every change was a guess
against an invisible spec.

The scale, lowest to highest:

| Token | Value | Owner |
|---|---|---|
| `--z-behind` | 0 | `.app-root::after` background wash |
| `--z-grain` | 1 | `.app-root::before` film grain — **above** the wash |
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

`--z-backdrop`, `--z-fab` and `--z-quick-ask` were removed: every element they
named had already been deleted. A scale that lists layers which do not exist is
worse than a long one — it invites someone to slot a new element "between" two
phantoms.

`--z-grain` looks like it could be `--z-behind` and cannot. Noise dithers a
gradient's 8-bit steps apart, and it can only do that from **above** — beneath
the wash, the gradient paints over it and the banding it exists to break is
untouched. It is a separate element from the wash for a second reason: `::after`
is animated, and scaling noise makes the grid resample every frame, so the
surface looks like it is boiling.

### The trap that keeps catching people

`--z-in-chat-control` is **80**, higher than `--z-panel` at **70**. This looks
like a bug and has been "fixed" before. It is not one.

`.chat-main` is positioned and sits at `--z-chat`, which creates a **stacking
context**. Every descendant is composited within that context, so a child at 80
is still painted below anything at `--z-earring` (4) or above in the root
context. A copy button cannot cover the settings panel however large its number.

If you remove `position: relative` from `.chat-main`, that containment
disappears and in-chat controls will punch through every panel.

### Why panels are portalled

Panels used to render inside `.chat-main` and were therefore trapped in its
stacking context: `--z-panel` (70) became effectively "3.70" in the root
context, below the earring's 4. Comparing 70 > 4 and concluding the panel wins
is exactly the mistake that kept that bug alive — **z-index values in different
stacking contexts are not comparable**.

`SidePanel` renders through a Radix portal to `document.body`. Do not
"simplify" that away.

### The guards

- `zIndexOrder.test.js` parses the stylesheet, asserts every adjacent pair in
  the scale, and requires every file in `components/panels/` to route through
  `SidePanel`. Verified against two deliberate regressions.
- `SidePanel.test.jsx` renders a panel inside a `.chat-main` and asserts the
  dialog is **not** a descendant of it. That is the check that actually proves
  the property; the source-level one only catches an obvious refactor.

To add a layer: add the token to `tokens.css`, then add it to the `ascending`
array in the test. The test is the spec.

---

## 2. The stylesheet is fourteen files, and the import order is the cascade

`src/App.css` is a 40-line **import manifest**. It contains no rules.

```
tokens → base → layout → sidebar → chat → markdown → composer →
palette → chat-controls → panels → overlay → signin → decoration →
code-blocks → utilities
```

Fifteen files sit in `src/styles/`; fourteen are in that list. The fifteenth is
`ui-reset.css`, which belongs to the Tailwind layer stack rather than this
cascade — `tailwind.css` imports it into `layer(base)` so unlayered App.css
still outranks it. See §4.

**Only two positions in that order are load-bearing**, and both are asserted
separately: `tokens` first, because every file below dereferences it, and
`utilities` last, because its media queries have to beat component defaults at
equal specificity without `!important`. The twelve in between own their
components outright and do not override each other.

That is a change from how this file used to read. The manifest once ended with
`skeuomorphism` and `obsidian` — two whole-app design passes, inset bevels and
then a near-black palette that redeclared the entire token set — each winning by
being imported after the file it contradicted. Both were deleted in `680679a`.
That is why the tokens at the top of the list used to be dead in the shipping
theme, why `--text-muted` ended up darker than `--text-subtle`, and why a rule's
real value could not be known by reading the file that declared it. **If you are
reading a rule and wondering what overrides it later: nothing does.**

`cssImportOrder.test.js` asserts the list, that every file on disk is imported
and no phantom is, that `ui-reset` stays out, and that App.css contains nothing
but imports.

### Why the split exists

`App.css` was one 3,375-line file with 195 `!important` declarations, seven
sections named `FIX:`, and `.header-actions` declared three times. All of it
came from one property: **the file had a bottom**. Appending to a 3,000-line
stylesheet is easier than finding the rule that already exists, and the cascade
rewards whoever appends.

Fourteen files named for what they style removes the bottom. Add a rule by
finding its file. If none fits, the rule probably wants a new file — say so in
the manifest rather than pasting at the end.

### `!important` is capped at three

Only the `prefers-reduced-motion` block keeps it, because overriding an
author's animation for a user with a vestibular disorder is the one thing the
keyword is for. `cssHygiene.test.js` holds the ceiling, counting declarations
rather than prose so a comment explaining the history does not consume budget.

---

## 3. Cascade snapshots — how CSS changes are proven safe

`src/test/cssCascade.js` parses the stylesheet, computes real specificity,
walks a fixture DOM with `element.matches()`, and records the winning
declaration for every property on every element. `cssSnapshot.test.js` compares
that against a committed baseline.

It exists because neither available alternative works: jsdom's
`getComputedStyle` does not resolve a cascade across stylesheets — it reports
*a* value, not *the winner* — and screenshot diffing cannot tell an
antialiasing delta from a broken layout.

Covered: three widths, a reduced-motion pass, six interaction states, both
pseudo-elements, both themes, `@keyframes` bodies, and the effective token set
at each theme root.

### Reading a diff

A diff means **rendering changed**. During a refactor that is a bug, not an
update — do not regenerate the baseline to make it pass. To regenerate
deliberately:

```bash
UPDATE_CASCADE_BASELINE=1 npx vitest run src/__tests__/cssSnapshot.test.js
```

### Four decisions in the harness that are not obvious

1. **`var()` is resolved before recording.** Moving a token declaration between
   `:root` and `.app-root` changes where it is declared without changing what
   anything renders. Recording raw values made that read as a diff.
2. **Custom-property declarations are not emitted per element**, for the same
   reason. Effective tokens are reported once per theme root instead, which is
   move-invariant.
3. **Shorthands expand into longhands.** Without this, `animation: none` and
   `animation-duration` never compete — and a browser very much makes them.
   This gap is what let an audit classify the `prefers-reduced-motion`
   overrides as redundant and delete them.
4. **The rule count is not in the header, and `!important` is not printed.**
   Folding removes rules and force without changing rendering; recording either
   would false-fail every correct commit.

`cssSnapshotGuard.test.js` is the guard on the guard: mutations of the real
stylesheet that must be detected (changed token, deleted rule, moved
breakpoint, wrong duplicate `@keyframes` deleted, dropped load-bearing
`!important`) and mutations that must **not** be (a rule split in place,
reformatting, a redundant `!important` added). A harness that has never failed
is indistinguishable from one that cannot.

### Tooling built on it

| Script | What it does |
|---|---|
| `scripts/strip-redundant-important.mjs` | Deletes each `!important` whose removal leaves the snapshot identical |
| `scripts/explain-important.mjs` | Names the declaration each surviving `!important` suppresses |
| `scripts/remove-dead-css.mjs` | Deletes rules matching nothing the app renders |
| `scripts/merge-duplicate-rules.mjs` | Merges duplicate selectors, per group, keeping only invisible merges |
| `AUDIT_IMPORTANT=1 vitest run src/__tests__/importantAudit.test.js` | Reports which `!important` are load-bearing |

Each verifies in memory and refuses to write if a rendered value moves.

---

## 4. Tailwind and shadcn/ui — additive, and the two traps

Tailwind is here so shadcn components can be dropped in and new UI written
without growing the hand-written stylesheet. It is **not** replacing it.

### Trap 1: Preflight would destroy the app

shadcn's documented install replaces the stylesheet with
`@import "tailwindcss"`, which pulls in Preflight. Preflight globally resets
margins, heading sizes and weights, list styles, border colours and form
control appearance — all load-bearing here. Importing it does not "add shadcn";
it breaks the app in a way that reads as "the CSS died".

Instead, `src/styles/ui-reset.css` carries only the subset Radix needs, scoped
to `[data-ui-scope]`, which every shadcn surface sets. `uiResetScope.test.js`
asserts every selector is scoped, none is a bare element or universal selector,
and every rule carries zero specificity via `:where()`.

It also declares **no property a utility sets** — no padding, no margin. Vite
flattens `@import … layer(base)` into an *anonymous* layer, anonymous layers
sort after every named one, and layer precedence is resolved before specificity
is consulted, so even `:where()` did not save it. Not fighting is more robust
than winning.

### Trap 2: layered utilities are silently dead

`tailwindcss/utilities.css` is imported **unlayered**, and must stay that way.

Unlayered CSS beats layered CSS regardless of specificity. `styles/base.css`
opens with `* { box-sizing: border-box; margin: 0; padding: 0 }`, so while
utilities were layered that `*` outranked `.px-4` and every other spacing
utility. Colour and sizing utilities worked — nothing sets those globally — so
`bg-primary` and `h-9` applied while `px-4` did nothing, which is invisible
until you measure it. Every shadcn button rendered with its label clipped.

Unlayered, `.px-4` (0,1,0) beats `*` (0,0,0). App.css still wins against
existing components because it is imported after `tailwind.css` in `main.jsx`
and its component rules are also (0,1,0), so source order decides in its
favour. Both properties hold at once.

`tailwindSetup.test.js` asserts the invariant, not the text: if the stylesheet
has an unlayered global reset touching a property, utilities must be unlayered.

### The token bridge

shadcn's semantic names map onto the same variables the stylesheet uses, so a
component and a hand-written rule resolve to identical colours and both follow
the theme toggle. A literal in the bridge is how the two systems drift; the
test rejects one, which is why `--text-on-fill` exists as a real token rather
than `#ffffff` inline.

---

## 5. Component map

```
App.jsx                    composition only, ~590 lines
  components/              Icon, Earring, Crescent, InputBar, ChatSidebar,
                           MessageList, CameraOverlay, Skeletons,
                           CommandPalette, SidePanel, CodeBlock
  components/panels/       SettingsPanel, AdminPanel, UpgradePanel
  components/ui/           shadcn primitives (button, sheet, dialog, switch,
                           tabs, tooltip, scroll-area, dropdown-menu, command,
                           badge, separator, skeleton)
                           plus five hand-added motion primitives — see below
  hooks/                   useChats, useBilling, useCamera, useSpeechRecognition
  lib/                     api, dom, format, image, storage, utils
  overlay/                 OverlayAssistant
  constants/               starters
```

**Four of the five motion primitives in `components/ui/` are mounted nowhere.**
`MagneticButton` is real — every header control is one, which is why they lean
toward the cursor — and it is in the gallery. `AnimatedTabs`, `BorderTrail`,
`Spotlight` and `TextShimmer` have no importer outside their own files. They are
not in the gallery, because a gallery of things the app does not render is how
the manifest above went stale in the first place. Delete them or use them; do
not let them sit here being counted as a component layer.

`useChats` holds the council streaming loop and is the only genuinely intricate
piece. Read the comments on its abort path before changing it: it used to
return without resetting `status`, which disabled the composer permanently the
first time anyone pressed Stop.

**`InitialLoader` and `OverlayAssistant` render outside `.app-root`.** Any
token they consume must be reachable from `:root`. The overlay also carries no
theme class — that window is always dark.

---

## 6. The style gallery

`gallery.html` renders every primitive in every variant plus both themes of the
app chrome. It is served by the dev server only:

```bash
npm run dev   # then open /gallery.html
```

It is deliberately **not** a build input — adding it split the app's CSS across
chunks, dropping the main stylesheet from 77 kB to 7.77 kB.

The chrome markup is the same fixture the cascade snapshot walks, so the two
cannot drift: a component missing from the gallery is missing from the guard.

The gallery is how the dead Tailwind utilities were found. The snapshot proves
which declaration wins; it cannot show you that a button's label is clipped.

### It carries the states, not just the components

Idle chrome is the easy screenshot and the least useful one — it is what
everybody already sees. The frames that earn their place are the ones that only
exist mid-interaction, and each names the overhaul section that introduced it:

| Frame | What only it shows |
|---|---|
| `council answering` | ornament lit, typing bubble, composer showing Stop |
| `composer loaded` | attachment thumbnail and the dictation-active mic |
| `sidebar rail, 56px` | the collapsed rail, in the light theme |
| `Magnetic button` | what the header controls actually are |
| `Skip link` | pinned to its focused position — see below |

The skip link is the one deliberate lie in the gallery. It lives at
`translateY(-200%)` and returns to 0 on `:focus`, because a `display: none` link
cannot be focused and a link that cannot be focused cannot be skipped to. A
frame that rendered it honestly would render an empty box, so that frame
overrides the transform. **The mechanism is asserted in tests; the gallery only
shows the appearance.**

### Screenshots

`docs/screenshots/gallery-{1440,768,390}.webp` — full-page, at desktop, tablet
and phone. Regenerate them whenever a frame changes:

```bash
npm run dev                        # serves /gallery.html
# then, per width, drive a real browser (Chrome DevTools MCP or any headless
# driver): set the viewport, full-page capture, save over the file.
#   1440x900   → gallery-1440.webp
#    768x1024  → gallery-768.webp
#    390x844   → gallery-390.webp
```

**WebP at quality 80, not PNG.** The same three full-page captures are 10.5 MB
as PNG and 1.2 MB as WebP, and this repo is public and clones with its history.
No screenshot dependency is installed for this — 300 MB of browser binary to
produce three images, in a repo whose whole point is that the *cascade snapshot*
is the automated guard, is not a trade worth making. Screenshots here are for
human review; the test suite is what fails the build.

---

## 7. Testing

```bash
cd frontend && npm test     # Vitest + Testing Library + jsdom
cd backend  && npm test     # node:test, zero dependencies
```

### jsdom gaps stubbed in `src/test/setup.js`

- `Element.prototype.scrollIntoView` / `scrollTo` do not exist — calling them
  throws rather than no-opping.
- **`localStorage` does not exist at all.** Not empty — undefined, so
  `localStorage.getItem` throws `TypeError`. `lib/storage.js` swallows that,
  which is exactly why nobody noticed, and it meant every persistence test
  would silently assert the failure path. An in-memory implementation is
  installed instead.
- `<model-viewer>` is registered by a script tag that never runs.

`SpeechRecognition`, `getUserMedia` and `getDisplayMedia` are absent too, and
are faked per-test rather than globally — the lifecycle around them is the part
worth asserting.

### Backend tests live in `backend/lib/`, not next to `server.js`

`server.js` calls `process.exit(1)` at import time when env vars are missing,
which makes it untestable by construction. Run with a **quoted glob** so Node
globs rather than the shell: `node --test "lib/**/*.test.js"`. The directory
form fails on Node 26 with `MODULE_NOT_FOUND`.

---

## 8. Conventions worth knowing

**Attachment bytes are never persisted.** `buildChatUpdate` whitelists message
fields and keeps only a `hasImage` flag — a data URL runs to megabytes and a
row holds up to 200 messages. In-session previews live in `imagePreview`, which
the server strips.

**`updated_at` bumps only when `messages` change.** The sidebar sorts on it, so
bumping on a pin or rename would yank a chat to the top as though it had just
been posted in.

**Vision failures are surfaced, never swallowed.** `/api/council` returns
400/502/503 before the stream opens rather than answering as if nothing were
attached.

**MIME is parsed, not assumed.** `parseDataUrl` reads the real type from the
payload.

**Only one panel is open at a time.** Settings, Admin and Upgrade occupy the
same space; two mounted at once renders as one panel with the wrong contents
behind it.

---

## 9. Known gaps

Checked against the tree on 2026-08-05, not carried forward on trust. Three of
the four gaps this section used to list were already closed, and a stale gap
list is worse than none — it sends people to fix what is fixed.

- **`CommandPalette` is still hand-rolled**, not `components/ui/command`. It
  carries a regression test for a dropped-first-keystroke bug that took a
  session to find; a swap has to keep that test passing unmodified.
- **Dictation has never been exercised in a real browser**, though it is
  tested. `useSpeechRecognition.test.jsx` has 11 tests over a faked API — the
  ten-second cap, the cap NOT firing after a normal end, a `stop()` that throws
  (Safari's `InvalidStateError`), unmount cleanup, and the transcript join.
  What no test can cover is whether the browser actually grants the microphone
  and returns words, and voice input has never worked in this app's history, so
  nobody has seen it succeed. That is a browser session, not a test.

  **The fake's fidelity is the known limit:** its `start()` synchronously calls
  `onstart`, and its `stop()` synchronously calls `onend`. The real API does
  neither, so an ordering bug between "start requested" and "browser granted
  the mic" would pass here.

### Closed: the overlay's second dictation implementation

The overlay used to carry its own copy of the `SpeechRecognition` lifecycle,
and the two copies had already drifted in the way duplicated lifecycles always
do — the overlay's had **no ten-second ceiling**. A session that never fires
`onend` therefore left the microphone indicator lit with no way to clear it,
and that window loses focus constantly, because it is an always-on-top bar
sitting over other applications. It also called `alert()` on an unsupported
browser: a modal, in a frameless always-on-top window, with no obvious way out.

It uses `useSpeechRecognition` now and inherits the ceiling and its test.

  **A trap that file records:** Vitest runs `afterEach` LIFO, and
  `@testing-library/react` registers its auto-cleanup on import — before
  anything in your test file. A teardown you write therefore runs BEFORE the
  unmount it is meant to clean up after, so restoring a global the component
  touches during cleanup makes every test fail on the PREVIOUS test's unmount.
- **Four unmounted motion primitives** in `components/ui/` — see §5.
- **Three duplicate top-level selectors remain**: `*`, `.sidebar-rail`, and the
  `.chat-item:hover / :focus-within .chat-actions` pair. All three are two
  declarations of one selector inside one file, not a cross-file override.
- **Three duplicate top-level selectors remain**, down from 16: `*`,
  `.sidebar-rail`, and the `.chat-item:hover/.focus-within .chat-actions` pair.
  All three are two declarations of the same selector in one file, not a
  cross-file override.

### The sign-in page is inside the manifest now

`signin.css` sits between `overlay` and `decoration`, and it renders **instead
of** the app rather than over it — which is why `--z-signin` is excluded from
the `ascending` array: there is nothing in the scale for it to be above.

Folding it in immediately paid for itself, in a way worth recording:

- The duplicate budget jumped **16 → 19**. Adding one file to the guarded set
  surfaced six duplicate blocks that had always existed and were never counted
  — all of them mine, all from declaring an animation in one rule and its
  `animation-delay` in another. Merging them landed at **14**: below where it
  started, *with* a new file included.
- `!important` is now counted in two buckets. The 52 inside `.cl-*` rules are
  tracked separately from the 3 elsewhere, because they are a different problem:
  the budget exists to stop `!important` winning fights with **our own**
  stylesheet, and Clerk ships CSS at a specificity we cannot reliably
  out-specify. Folding them into one number would either force the budget up
  until it meant nothing, or keep this page outside the guards forever.

### Closed, and worth not re-opening

- **`.app-root *` is gone.** It set a transition on every element in the app at
  the same specificity as each component's own rule, so it won on source order
  alone, and it is why nine duplicate-rule groups could not be merged. Every
  transition is now declared by the thing it animates. `base.css` keeps a
  comment where it was, recording what it did and why it went.
- **The `skeuomorphism` and `obsidian` passes are gone** (`680679a`). §2.
- **13 of the 16 duplicate top-level selectors** went with `.app-root *`.

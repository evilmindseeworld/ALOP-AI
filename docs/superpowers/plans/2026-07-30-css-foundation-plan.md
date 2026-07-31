# CSS Foundation and Component Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `App.css` from 195 `!important` to 3, split it so it cannot regrow append-only, cut `App.jsx` from 975 lines to composition-only, and add a shadcn/ui component layer — with every CSS change proven not to alter rendering.

**Architecture:** A cascade-snapshot harness parses the stylesheet, resolves specificity against a rendered fixture DOM, and emits the winning declaration for every property on every element across theme × viewport × state. The baseline is captured from `main` before any edit. Phase 1 then folds each appended override block into the rule it overrides, one commit per block, with the snapshot required identical after each. Phase 2 layers shadcn/ui on Radix using a scoped reset instead of Preflight, because Preflight would destroy the hand-written stylesheet Phase 1 just cleaned.

**Tech Stack:** React 18, Vite 5, Vitest 2 + jsdom 25, Testing Library, Tailwind 4 (additive, no Preflight), Radix UI, class-variance-authority, cmdk, Playwright (via MCP, not a repo dependency).

## Global Constraints

- **Phase 1 must not change rendering.** A cascade-snapshot diff in Phase 1 is a bug, not an update. Never regenerate the baseline to make a test pass.
- **Never write a bare `z-index`.** Use a `--z-*` token. `zIndexOrder.test.js` enforces this; `docs/FRONTEND.md` §1 explains why.
- **Preflight stays out.** `tailwindSetup.test.js` guards this. Do not `@import "tailwindcss"`.
- **`!important` floor is 3** — the `prefers-reduced-motion` block only.
- **This repo is JSX, not TypeScript.** `components.json` uses `"tsx": false`.
- **Backend tests run with a quoted glob:** `node --test "lib/**/*.test.js"`. The directory form fails on Node 26 with `MODULE_NOT_FOUND`.
- **Windows:** `pkill` does not exist. Use `Get-Process node | Stop-Process -Force`.
- Existing suite is 118 tests (29 backend, 89 frontend). It must not regress.

---

## File Structure

**Created — test infrastructure**

| File | Responsibility |
|---|---|
| `frontend/src/test/cssCascade.js` | Parse CSS, compute specificity, evaluate media queries, resolve the cascade against a DOM |
| `frontend/src/test/fixtures/appMarkup.js` | Representative markup for every component, used by the snapshot |
| `frontend/src/__tests__/cssCascade.test.js` | Tests the harness itself — it must catch an injected regression |
| `frontend/src/__tests__/cssSnapshot.test.js` | Asserts the resolved cascade matches the committed baseline |
| `frontend/src/__tests__/__snapshots__/cascade.baseline.txt` | The baseline, generated from `main` |
| `frontend/gallery.html`, `frontend/src/gallery.jsx` | Separate Vite entry for visual screenshots |

**Created — styles (Task 8)**

`frontend/src/styles/{tokens,base,layout,sidebar,chat,composer,panels,overlay,markdown,motion}.css`

**Created — extraction (Tasks 10–11)**

`frontend/src/lib/{format,storage,image,api}.js`
`frontend/src/hooks/{useChats,useBilling,useSpeechRecognition,useCamera}.js`
`frontend/src/constants/starters.js`
`frontend/src/components/{Icon,Skeletons,ChatSidebar,InputBar,MessageList,Earring,CameraOverlay}.jsx`
`frontend/src/components/panels/{SettingsPanel,AdminPanel,UpgradePanel}.jsx`
`frontend/src/overlay/OverlayAssistant.jsx`

**Created — shadcn (Tasks 12–14)**

`frontend/components.json`, `frontend/src/lib/utils.js`, `frontend/src/styles/ui-reset.css`,
`frontend/src/components/ui/{sheet,dialog,button,command,switch,tabs,tooltip,dropdown-menu,scroll-area,skeleton,separator,badge}.jsx`

**Modified**

`frontend/src/App.css` (becomes an import manifest) · `frontend/src/App.jsx` (975 → ~180) ·
`frontend/src/tailwind.css` (shadcn token bridge) · `frontend/vite.config.js` (`@` alias, gallery entry) ·
`frontend/src/test/setup.js` (media/speech/display stubs) · `frontend/src/__tests__/cssHygiene.test.js` (ratchets) ·
`docs/FRONTEND.md` (rewrite)

---

## Task 1: Cascade snapshot harness

**Files:**
- Create: `frontend/src/test/cssCascade.js`
- Create: `frontend/src/__tests__/cssCascade.test.js`

**Interfaces:**
- Produces:
  - `parseStylesheet(css: string) → Rule[]` where
    `Rule = { selector, specificity: [a,b,c], order: number, media: string|null, declarations: Map<prop, {value, important}> }`
  - `specificity(selector: string) → [a, b, c]`
  - `mediaMatches(condition: string, env: {width, reducedMotion, scheme}) → boolean`
  - `resolve(element: Element, rules: Rule[], env, state: string[]) → Map<prop, value>`
  - `snapshot(rootElement, css, envs) → string` — deterministic, newline-delimited

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from "vitest";
import { specificity, parseStylesheet, mediaMatches, resolve } from "../test/cssCascade";

describe("specificity", () => {
  it("counts ids, classes and types", () => {
    expect(specificity("#a .b c")).toEqual([1, 1, 1]);
    expect(specificity(".a.b")).toEqual([0, 2, 0]);
    expect(specificity("a:hover")).toEqual([0, 1, 1]);
    expect(specificity("*")).toEqual([0, 0, 0]);
  });
  it("takes the max branch inside :not() and :is()", () => {
    expect(specificity(":not(.a, #b)")).toEqual([1, 0, 0]);
  });
  it("counts a pseudo-element as a type", () => {
    expect(specificity(".a::before")).toEqual([0, 1, 1]);
  });
});

describe("parseStylesheet", () => {
  it("splits selector lists into separate rules preserving order", () => {
    const rules = parseStylesheet(".a, .b { color: red }");
    expect(rules.map((r) => r.selector)).toEqual([".a", ".b"]);
    expect(rules[0].order).toBe(0);
    expect(rules[1].order).toBe(1);
  });
  it("records !important separately from the value", () => {
    const [rule] = parseStylesheet(".a { color: red !important }");
    expect(rule.declarations.get("color")).toEqual({ value: "red", important: true });
  });
  it("attaches the media condition to nested rules", () => {
    const [rule] = parseStylesheet("@media (max-width: 768px) { .a { color: red } }");
    expect(rule.media).toBe("(max-width: 768px)");
  });
  it("ignores @keyframes bodies", () => {
    expect(parseStylesheet("@keyframes spin { from { opacity: 0 } }")).toEqual([]);
  });
});

describe("mediaMatches", () => {
  it("evaluates width bounds", () => {
    expect(mediaMatches("(max-width: 768px)", { width: 400 })).toBe(true);
    expect(mediaMatches("(max-width: 768px)", { width: 1400 })).toBe(false);
    expect(mediaMatches("(min-width: 769px)", { width: 1400 })).toBe(true);
  });
  it("evaluates reduced motion", () => {
    expect(mediaMatches("(prefers-reduced-motion: reduce)", { reducedMotion: true })).toBe(true);
    expect(mediaMatches("(prefers-reduced-motion: reduce)", { reducedMotion: false })).toBe(false);
  });
  it("ands comma-free compound conditions", () => {
    expect(mediaMatches("(min-width: 700px) and (max-width: 900px)", { width: 800 })).toBe(true);
    expect(mediaMatches("(min-width: 700px) and (max-width: 900px)", { width: 1000 })).toBe(false);
  });
});

describe("resolve", () => {
  it("lets !important beat higher specificity", () => {
    const rules = parseStylesheet("#x { color: blue } .y { color: red !important }");
    document.body.innerHTML = `<div id="x" class="y"></div>`;
    expect(resolve(document.getElementById("x"), rules, {}, []).get("color")).toBe("red");
  });
  it("lets specificity beat source order", () => {
    const rules = parseStylesheet(".a.b { color: blue } .a { color: red }");
    document.body.innerHTML = `<div class="a b"></div>`;
    expect(resolve(document.querySelector(".a"), rules, {}, []).get("color")).toBe("blue");
  });
  it("lets source order break a specificity tie", () => {
    const rules = parseStylesheet(".a { color: blue } .a { color: red }");
    document.body.innerHTML = `<div class="a"></div>`;
    expect(resolve(document.querySelector(".a"), rules, {}, []).get("color")).toBe("red");
  });
  it("applies :hover rules only in the hover state", () => {
    const rules = parseStylesheet(".a { color: blue } .a:hover { color: red }");
    document.body.innerHTML = `<div class="a"></div>`;
    const el = document.querySelector(".a");
    expect(resolve(el, rules, {}, []).get("color")).toBe("blue");
    expect(resolve(el, rules, {}, ["hover"]).get("color")).toBe("red");
  });
  it("skips rules whose media condition does not match", () => {
    const rules = parseStylesheet(".a { color: blue } @media (max-width: 768px) { .a { color: red } }");
    document.body.innerHTML = `<div class="a"></div>`;
    const el = document.querySelector(".a");
    expect(resolve(el, rules, { width: 1400 }, []).get("color")).toBe("blue");
    expect(resolve(el, rules, { width: 400 }, []).get("color")).toBe("red");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/__tests__/cssCascade.test.js`
Expected: FAIL — `Failed to resolve import "../test/cssCascade"`

- [ ] **Step 3: Implement `cssCascade.js`**

Key decisions the implementer must not get wrong:

- **Dynamic pseudo-classes are stripped, not matched.** jsdom's `matches()` returns
  `false` for `:hover` always. Strip `:hover`, `:focus`, `:focus-visible`, `:focus-within`,
  `:active`, `:disabled`, `:checked` from the selector before calling `matches()`, and
  record which ones were stripped. A rule applies only if every stripped pseudo-class is
  present in the requested `state` array. This is why `resolve` takes `state`.
- **Pseudo-elements become a separate key.** `.a::before { color: red }` writes
  `::before/color`, not `color`, so a `::before` rule never competes with the element's own.
- **Specificity of `:not()`/`:is()`/`:has()`** is the max of its arguments; `:where()` is zero.
- Selector-list splitting must respect parentheses — `:not(.a, .b)` is one selector, not two.

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/__tests__/cssCascade.test.js`
Expected: PASS, 15 tests

- [ ] **Step 5: Commit**

```bash
git add frontend/src/test/cssCascade.js frontend/src/__tests__/cssCascade.test.js
git commit -m "test: add a CSS cascade resolver for refactor safety"
```

---

## Task 2: Fixture markup and the committed baseline

**Files:**
- Create: `frontend/src/test/fixtures/appMarkup.js`
- Create: `frontend/src/__tests__/cssSnapshot.test.js`
- Create: `frontend/src/__tests__/__snapshots__/cascade.baseline.txt`

**Interfaces:**
- Consumes: `parseStylesheet`, `resolve` from Task 1
- Produces: `APP_MARKUP: string` — one HTML fragment covering every component

- [ ] **Step 1: Write the fixture**

Derived from the real JSX, not invented. Must include at minimum: `.app-root.dark`,
`.app-root.light`, `.app-header`, `.brand`, `.header-actions`, `.cmdk-trigger`,
`.upgrade-btn`, `.icon-btn`, `.sidebar` (default / `.collapsed` / `.mobile.mobileOpen`),
`.chat-item` (default / `.active` / `.pinned` / `.favorite`), `.chat-main`,
`.scroll-wrapper`, `.empty-state` + `.starter-card`, `.msg-row.user`, `.msg-row.assistant`,
`.bubble`, `.typing-bubble` + `.typing-dot`, `.msg-actions` + `.msg-action-btn.active`,
`.msg-attachment`, `.msg-attachment-placeholder`, `.input-bar`, `.input-wrapper`,
`.input-text`, `.input-btn` (default / `.primary` / `.is-stop` / `.listening`),
`.attachment-preview`, `.chat-toolbar-btn`, `.scroll-down-btn`, `.side-panel` +
`.panel-overlay` + `.panel-header` + `.panel-body`, `.setting-row`, `.theme-toggle`
(+ `.active`), `.theme-card`, `.admin-user-card` + `.admin-badge.pro`, `.plan-grid` +
`.plan-col.is-pro` + `.plan-buy`, `.camera-overlay` + `.camera-btn`, `.toast`,
`.overlay-root` + `.overlay-bar` + `.overlay-input` + `.overlay-action` +
`.overlay-answer-card`, `.markdown-body` with h1/h2/h3, p, a, ul, ol, li, code, pre,
table, img, `.code-block-wrapper`, `.earring-wrap.earring-left`, `.earring-chain`,
`.earring-pivot`, `.skeleton-block`, `.quick-ask-fab`, `.mobile-only`, `.desktop-only`.

- [ ] **Step 2: Write the snapshot test**

```js
const ENVS = [];
for (const theme of ["dark", "light"])
  for (const width of [1400, 900, 400])
    for (const reducedMotion of [false, true])
      ENVS.push({ theme, width, reducedMotion });

const STATES = [[], ["hover"], ["focus"], ["focus-visible"], ["active"], ["disabled"]];

it("resolves to the committed baseline", () => {
  expect(buildSnapshot()).toBe(readFileSync(BASELINE_PATH, "utf8"));
});
```

The failure message must name the first differing line and say, verbatim:
`"Phase 1 must not change rendering. Do NOT regenerate the baseline to make this pass."`

- [ ] **Step 3: Generate the baseline from unmodified CSS**

Run: `cd frontend && npx vitest run src/__tests__/cssSnapshot.test.js -u`
Then confirm `git diff --stat frontend/src/App.css` is **empty** — the baseline is only
valid if the CSS was untouched when it was taken.

- [ ] **Step 4: Prove the harness catches a regression**

Delete one `!important` from `.header-actions` in `App.css`, run the snapshot test,
confirm it FAILS and names `.header-actions`. Then `git checkout frontend/src/App.css`.
A guard that has never failed is not a guard.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/test/fixtures frontend/src/__tests__/cssSnapshot.test.js frontend/src/__tests__/__snapshots__
git commit -m "test: capture the cascade baseline before any CSS refactor"
```

---

## Task 3: Style gallery entry

**Files:**
- Create: `frontend/gallery.html`, `frontend/src/gallery.jsx`
- Modify: `frontend/vite.config.js` (`build.rollupOptions.input`)

- [ ] **Step 1:** Add the gallery as a second Vite input alongside `index.html`, so it is
  built separately and never enters the app bundle.
- [ ] **Step 2:** Render `APP_MARKUP` from Task 2 with a theme switcher, reusing the same
  fixture so gallery and snapshot cannot drift.
- [ ] **Step 3:** Verify `npm run build` still reports the app bundle unchanged in size.
- [ ] **Step 4:** Screenshot at 1400/900/400 in both themes via Playwright; keep as the
  "before" reference.
- [ ] **Step 5:** Commit.

---

## Tasks 4–7: Fold the override blocks

One task per block, one commit each, identical procedure:

| Task | Block | Lines | `!important` |
|---|---|---|---|
| 4 | six `FIX:` sections | 2216–2258, 2465–2538 | 31 |
| 5 | `SKEUOMORPHISM` | 2259–2459 | 41 |
| 6 | `OVERLAY UI UPDATE` | 2539–2589 | 23 |
| 7 | `DARK MODE REWORK: Obsidian Night` | 2714–2912 | 68 |

**Procedure (every one of these tasks):**

- [ ] **Step 1:** For each declaration in the block, find the rule that owns the selector
  earlier in the file. If none exists, the block's rule *is* the owner — move it up, do not
  leave it at the bottom.
- [ ] **Step 2:** Merge the declaration into the owning rule and drop `!important`.
  Where the override and the original genuinely conflict, **the override's value is the
  one that renders today** — it wins, and the original declaration is deleted, not kept.
- [ ] **Step 3:** Delete the now-empty section, including its header comment.
- [ ] **Step 4:** Run `npx vitest run src/__tests__/cssSnapshot.test.js`. Expected: PASS,
  byte-identical. **If it fails, the fold is wrong — fix the fold.**
- [ ] **Step 5:** Run the full suite: `npm test`. Expected: no regression.
- [ ] **Step 6:** Commit with the count in the message, e.g.
  `refactor(css): fold the skeuomorphism pass into its components (-41 !important)`.

**Task 7 additionally:** read the snapshot diff line by line even on a pass, and record in
the commit body which token values changed owner. Two dark themes are collapsing into one;
this is the step where a silent mistake is most expensive.

---

## Task 8: Responsive utilities, dedupe, and the split

- [ ] **Step 1:** Replace `.mobile-only { display: none !important }` and its media-query
  counterpart with specificity that wins without force. Keep the three
  `prefers-reduced-motion` declarations and add the comment explaining that overriding
  author animation for a vestibular-disorder user is the keyword's intended use.
- [ ] **Step 2:** Collapse every duplicate top-level selector into a single rule, in the
  position of the **first** occurrence, carrying the **last** value for each property.
- [ ] **Step 3:** Snapshot must be identical. Commit.
- [ ] **Step 4:** Split into `src/styles/*.css` per the spec. `App.css` becomes an ordered
  `@import` manifest whose comment states that the order is the cascade.
- [ ] **Step 5:** Add `cssImportOrder.test.js` asserting the manifest's order — the split
  is only safe while the order holds.
- [ ] **Step 6:** Point `cssCascade` at the concatenation of the manifest in order, so the
  snapshot still covers the whole stylesheet. Snapshot must be identical. Commit.
- [ ] **Step 7:** Tighten `cssHygiene.test.js`: `IMPORTANT_BUDGET = 3`,
  `DUPLICATE_BUDGET = 0`, `FIX:` sections `0`. Commit.

---

## Tasks 9–11: Extraction

Test-first, one module per commit, `npm test` green after each.

- **Task 9 — `lib/`:** `format.js`, `storage.js`, `image.js`, `api.js`. Pure functions
  first; they need no React and their tests are the cheapest in the suite.
- **Task 10 — `hooks/`:** `useSpeechRecognition`, `useCamera`, `useBilling`, `useChats`.
  `useChats` carries the council streaming loop and the abort branch — its tests must
  cover the two bugs already fixed there: status must reset to `idle` after an abort, and
  a partial answer must persist rather than be discarded.
- **Task 11 — components and panels:** `Icon`, `Skeletons`, `ChatSidebar`, `InputBar`,
  `MessageList`, `Earring`, `CameraOverlay`, the three panels, `OverlayAssistant`.
  Update the four test files that import from `../App`.
  `OverlayAssistant` needs `getDisplayMedia`, `SpeechRecognition` and `speechSynthesis`
  stubbed in `src/test/setup.js` — **all three are absent from jsdom**, and it has no
  tests today.

---

## Tasks 12–14: shadcn/ui layer

- **Task 12 — foundation:** `@` alias in `vite.config.js` **and** the Vitest config;
  `components.json` with `"tsx": false`; `lib/utils.js` (`cn`);
  `styles/ui-reset.css` scoped to `[data-ui-scope]`; shadcn token bridge in
  `tailwind.css`. New test: every selector in `ui-reset.css` is scoped, and
  `tailwindSetup.test.js` still reports Preflight absent.
- **Task 13 — primitives:** Sheet, Dialog, Button, Command, Switch, Tabs, Tooltip,
  DropdownMenu, ScrollArea, Skeleton, Separator, Badge, Sonner. One test each.
- **Task 14 — migration:** `SidePanel` → Sheet (gains a focus trap it lacks today);
  `CommandPalette` → cmdk, with `CommandPalette.test.jsx` passing **unmodified**;
  `toast` → Sonner; theme toggle → Switch.

---

## Task 15: Documentation and verification

- [ ] Rewrite `docs/FRONTEND.md`: CSS architecture and the split, the cascade snapshot and
  how to read a diff, the scoped-reset decision and why not Preflight, the component map.
- [ ] `cd frontend && npm test` — all green.
- [ ] `cd backend && npm test` — 29 passing.
- [ ] `cd frontend && npm run build` — clean, no >500 kB warning.
- [ ] Gallery screenshots after, compared against Task 3's before.
- [ ] Update `handoff.md`.
- [ ] `/code-review`, then `/commit-push-pr`.

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: instrument → 1–3; the six-row
Phase 1 table → 4–8; extraction → 9–11; shadcn including the Preflight resolution and
token bridge → 12–14; testing table and docs → 15. Risk 1 (Obsidian Night) is Task 7's
extra step; risk 2 (cmdk) is Task 14's "unmodified" requirement; risk 3
(`OverlayAssistant` untested) is Task 11's stub step; risk 4 (reset leak) is Task 12's
scoping test.

**Placeholders.** None. Tasks 4–7 share one procedure because it is genuinely identical
per block — the varying part is the table above it, which is exact.

**Type consistency.** `parseStylesheet` / `specificity` / `mediaMatches` / `resolve` /
`snapshot` keep the same names and signatures in Tasks 1, 2, 3 and 8.

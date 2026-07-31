# ALOP-AI — UI overhaul (slice E)

**Date:** 2026-07-31
**Status:** approved to build in one pass (the user asked for the finished
product, not a plan to review)

---

## The problem, stated precisely

The app is not under-designed. It is designed three times, and all three are
still in the stylesheet:

1. `tokens.css` — Sakura Night: warm wood, amber surfaces.
2. `skeuomorphism.css` — every surface given inset bevels: a light line on top,
   a dark line under.
3. `obsidian.css` — a near-black palette laid over both, **redeclaring the
   entire token set** on `.dark`.

Pass 3 wins because it is imported last, so the tokens in pass 1 are dead in
the theme the app ships. Nobody can tell which file is authoritative by reading
either one, and `docs/FRONTEND.md` has to spend a section explaining that the
import order *is* the cascade.

Four consequences, all visible in a screenshot:

- **Contrast is broken.** Obsidian's ramp is inverted: `--text-muted` (#5a5560)
  is darker than `--text-subtle` (#8a8590), so "muted" text sits at 2.4:1 on
  its own surface. `.msg-meta` renders at `rgba(255,255,255,0.2)` — 1.4:1,
  effectively invisible. White on the pink fill is 2.6:1: the send button, the
  user's own messages and every badge fail AA.
- **The wood grain reads as banding.** `--woody` paints vertical stripes across
  every card in the dark theme, where there is no warm surface to justify them.
- **Long answers are unreadable.** A research answer with headings, lists and
  sources renders inside an 80%-width chat bubble with a bevel — the exact
  shape that makes long-form prose hard to scan.
- **The ornament is broken, not just large.** `.earring-chain` is 50px tall and
  the SVG's stud sits 30px inside its own viewBox, so the chain ends in mid-air
  and the stud floats below it, disconnected.

## What we are building

One system — **Sakura Obsidian** — that keeps the identity (pink, emerald,
Clash Grotesk, the crescent) and throws away the mud.

### Structure

- Delete `skeuomorphism.css` and `obsidian.css`. Their *primary* rules
  (`.input-btn`, `.avatar`, `.toast`, `.chat-item`, `.empty-state`,
  `.scroll-wrapper`, the overlay chrome) move into the component file that owns
  them; their bevels do not. The manifest stops being a pile of overrides.
- Remove `.app-root *`, which sets a transition on every element at the same
  specificity as each component's own rule and is the reason 16 duplicate
  selectors could not be merged. Every transition becomes explicit.
- One token file, both themes, with a measured text ramp.

### Visual language

| | Before | After |
|---|---|---|
| Depth | stacked inset bevels | hairline rim + ambient shadow |
| Dark surface | wood grain over near-black | flat near-black, two ambient blooms |
| Assistant message | 80%-wide bevelled bubble | full-width prose, 74ch measure, no chrome |
| User message | white on pink gradient (2.6:1) | ink on pink (8.4:1), compact, right-aligned |
| Muted text | 2.4:1 | 8.6:1 |
| Composer | recessed bar, 36px targets | single raised card, 44px targets, focus ring |
| Sidebar | flat list | Linear/Raycast: sectioned, hover-reveal, active rail |
| Toasts | one hand-rolled div | Sonner, stacked and dismissable |

### Components

- `MessageList` — role-aware layout, streaming caret, grouped meta, actions
  that appear on hover **and** on focus (keyboard users could not reach them).
- `InputBar` — one card: attachments, textarea, action row; send becomes stop
  while streaming; 44px hit targets.
- `ChatSidebar` — pinned / favourites / recent sections, hover-reveal actions.
- `Crescent` + `Earring` — chain terminates exactly at the stud, sized to the
  shell gutter, hidden where the transcript needs the room, reduced-motion
  respected.
- `SettingsPanel`, `AdminPanel`, `UpgradePanel`, `CommandPalette` — restyled on
  the same tokens; markup unchanged except where a11y requires it.

## How this is proven

- **`contrast.test.js` (new).** Parses the token file, computes WCAG relative
  luminance, and asserts every declared foreground/background pair clears its
  floor — 4.5:1 for text, 3:1 for UI boundaries — in **both** themes. This is
  the check that would have caught the inverted ramp on the day it shipped.
- **The cascade snapshot is the review instrument, not a gate.** An overhaul
  moves rendering by definition; the snapshot is read line by line to confirm
  every move is intended, then regenerated deliberately in a commit that says
  so. `cssSnapshotGuard.test.js` continues to prove the harness still detects
  what it claims to.
- **`cssImportOrder.test.js`** is updated: the manifest is the spec, and the
  spec no longer contains two design passes.
- **`cssHygiene.test.js`** ratchets go down, never up.
- Component tests for every markup change; the existing 283 stay green apart
  from ones whose asserted markup deliberately changed.

## Out of scope

Slice B (AI smartness) and D (sign-in polish). No new dependencies: Sonner,
framer-motion, lucide-react and the Radix primitives are already installed.

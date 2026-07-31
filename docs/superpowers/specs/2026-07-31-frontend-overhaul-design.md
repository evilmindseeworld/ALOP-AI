# Sakura Obsidian II — frontend overhaul

Design approved 2026-07-31. Written before implementation so a lost session
resumes from here rather than from a diff.

## What this is not

It is not a rewrite. The pass before this one (`680679a`, `39cfb37`) collapsed
three stacked design systems into one, made `tokens.css` authoritative, and
built the guards — `contrast.test.js`, `cssSnapshot.test.js`,
`zIndexOrder.test.js` — that make a restyle provable rather than eyeballed.
That work stands. This builds on top of it.

Untouched by construction: `useChats` and its streaming/abort path, `useBilling`,
the `SidePanel` portal contract, and `CommandPalette`'s internals (it carries a
regression test for a dropped-first-keystroke bug that cost a session to find;
a rewrite has to keep that test passing unmodified, which is not this project).

No new runtime dependency. `framer-motion`, `animejs`, `cmdk`, `sonner` and the
Radix primitives already cover everything below.

## The three decisions that shape everything else

Asked and answered before any code was written, because each one changes what
the rest of the work looks like:

1. **One flush frame, not three floating cards.** The shell was a header, a
   sidebar and a chat panel, each its own glass card, separated by 16px gaps.
   That is a dashboard shape. Linear and Raycast — which is the register the
   brief asks for — use a single frame with hairline dividers.
2. **The collapsed sidebar becomes a 56px icon rail**, not zero width. Nothing
   should vanish; expanding should be one click from where the eye already is.
3. **The user's own message stops being a saturated pink pill.** A filled
   gradient block wins the eye over the answer that follows it, which is the
   wrong priority in a transcript. It becomes a quiet raised pill with a 2px
   pink leading rail. Pink stays the accent for send, active, focus and rail.

## Sections

Each ships as its own commit, tests green, before the next begins.

### §1 — Shell: one frame

`.app-shell` goes from `padding: 16px; gap: 16px` to a 10px window inset holding
a single `.app-frame`: one border, one radius, `overflow: hidden`. The ambient
bloom stays visible as a thin surround — edge-to-edge would read flat, and the
surround is what keeps "premium" from becoming "plain".

Three stacked `backdrop-filter` layers (header, sidebar, chat) collapse to one
on the frame. Blur composited over blur was desaturating the pink, and three
blur layers cost three full-viewport composites per frame.

Inside the frame: a 48px `.top-bar` with a hairline under it, then `.app-body`
holding `.sidebar` (hairline right) and `.chat-main`, flush, no gap.

The top bar loses the two-line `.brand-text` stack. The subtitle string
— "AI Council • 7 models • Precision • Learning" — was four claims set in 11px
grey; the model count survives as a shadcn `Badge` next to the title and the
rest goes.

New tokens: `--topbar-h`, `--sidebar-w`, `--rail-w`, `--frame-inset`. Layout
constants that both CSS and JS read must have one home, or they drift — the
sidebar already carries a `window.innerWidth <= 768` measurement that the
stylesheet deliberately ignores.

### §2 — Sidebar: the Linear register

- **Search field** at the top, filtering titles live. This is the single change
  that most makes a sidebar feel like Linear's.
- **Rail at `--rail-w`** on collapse: search, new chat, then each chat as an
  initial-glyph button with a Tooltip carrying the full title.
- **Roving tabindex** with ↑/↓/Enter over the filtered list.
- **Footer becomes a user block** — avatar, name, plan badge — replacing the
  "ALOP-AI • Council of Minds" line. It also gives Upgrade a home that is not
  the top bar.
- Group labels stick to the top of the scroll container.

### §3 — Transcript

- User message: `--surface-2` fill, hairline border, 2px `--primary` leading
  rail, right-aligned.
- Assistant avatar shrinks to 26px and drops the literal "AI" text.
- **Copy gets a confirmed state.** `navigator.clipboard.writeText` currently
  fires into silence — no toast, no icon change, nothing. The icon swaps to a
  check for 1.6s.
- Row hover gets a wash, so the actions appearing on hover have a surface to
  appear against rather than materialising over the page.
- `text-wrap: pretty` on prose, `balance` on headings, `tabular-nums` on
  timestamps.

### §4 — Composer

- Tooltip on every icon button. `components/ui/tooltip` is installed and
  currently unused here.
- **Paste an image** into the composer, and **drop one** onto it. Both route
  through the existing `fileToDataUrl`, so neither adds a code path that can
  disagree with the file picker.
- Send button gets a real disabled→enabled transition rather than an opacity
  step.
- The card lifts 1px on `:focus-within`.

### §5 — Motion

`--ease-out` is already expo-out. Added: a token-driven press-scale of 0.97,
sidebar item stagger on mount, a spring on panel entrance, and **the earrings
sway when an answer begins arriving**.

The earrings are the app's signature — a hanging ornament in the transcript's
margin, which is the one element here that could not be mistaken for any other
chat client. Under the "spend your boldness in one place" rule they get the
deliberate flourish and everything else stays quiet.

### §6 — Accessibility

A skip link to the transcript. Tooltips supplement `aria-label` and never
replace it. The focus ring is not touched. Every new colour pair is added to
`contrast.test.js` before the token that needs it.

### §7 — Documentation and verification

`docs/FRONTEND.md` updated — §2 of it still describes a fifteen-file manifest
including `skeuomorphism` and `obsidian`, both deleted in `680679a`. The
gallery gains every new primitive and is screenshotted at 1440, 768 and 390.

## How this stays honest

The guards are the reason a restyle this size is safe to attempt at all.

| Guard | Obligation |
|---|---|
| `cssSnapshot.test.js` | Regenerated **deliberately**, per section, with the diff read and summarised in the commit message. Never regenerated to make a failure go away. |
| `test/fixtures/appMarkup.js` | Rewritten to match the new JSX. It has already drifted — it renders a `.avatar` inside `.msg-row.user`, which `MessageList` does not. A fixture that drifts silently stops guarding what drifted. |
| `cssImportOrder.test.js` | Any new stylesheet goes in the manifest **and** the test. The list is the spec. |
| `contrast.test.js` | New pairs added before the tokens that need them. |
| `zIndexOrder.test.js` | `--z-topbar` added to the scale and to the `ascending` array. |
| `gallery.html` | A component missing from the gallery is missing from the guard. |
| Build | Watched for chunk-size warnings at each commit. |

Test count at baseline: **347 passing, 28 files**. It does not go down.

## Known risk

Regenerating the cascade baseline is the one operation here that can hide a
real regression, because the guard's whole value is that a diff means rendering
changed. Mitigation is procedural, not technical: regenerate once per section,
read the diff, and state in the commit message what moved and why it was meant
to. A section whose diff contains something unexplained does not get committed.

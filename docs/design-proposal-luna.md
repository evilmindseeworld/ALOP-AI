# Luna design proposal: make the ink register

## What I looked at

I read `SakuraFrame.jsx` (especially the geometry comment at lines 176–249), `composer.css`, `decoration.css`, `tokens.css`, and the gallery fixture. The dev server was already running on 5199, so I reused it. I captured dark and light gallery states at 1262×624 and dark and light live states at 320×800. Windows reported `devicePixelRatio = 1` at both widths. I did not inspect the signed-in production shell; this is a gallery-based proposal, not a claim about that shell.

At desktop the lattice is present in both themes but reads like a watermark. The light version is easier to see than the dark version, yet both lose the one-pixel rhythm at a glance. The skyline, seal and crescent survive the same screenshots; I would strengthen the field lines, not redraw the ornament family.

## Diagnosis and proposal

**1. “The sun set it to the lets say middle left and with clouds.”** I read this as visual balance: a sun in the visible left-middle of the composer, bracketed by kasumi bars, not a new illustration. A single `cx` cannot be ideal at every viewport because the 1040-unit horizon is intentionally authored wider than the card.

Move the circle to `cx="180" cy="11" r="9"`. At the 44px strip height that places its centre about 208px into the 848px desktop card, roughly 24.5% from the left. Keep `cy` and `r`: the top remains y=2 units, below the 1.73-unit focus-clip ceiling. The existing bars at x=130–160 and x=202–224 now clear the disc by at least 20 units, greater than the 9-unit radius. The town under x=166–196 is at y=28–32 after the translate, leaving 8–12 units below the disc’s y=20 bottom; this is the new clearance measurement that replaces the old x=80–136 note.

To preserve the current good phone composition, add a small-screen `--sun-shift-x: -97px` and apply the same shift to `.composer-sun` and `.composer-clouds`; desktop uses `0px`. Make focus transforms `translate(var(--sun-shift-x), -2px)` and keep the reduced-motion rule at the non-moving shifted position. This keeps the sun/cloud relationship and avoids a mobile jump. Rewrite the load-bearing comments with these values; do not raise `cy` or enlarge `r`.

**2. “Make it so that the design is more visible.”** I read this as more authored contrast, not more objects. Add theme tokens in `tokens.css`: dark `--ornament-lattice-diag: 12%` and `--ornament-lattice-rule: 9%`; Bamboo Day `16%` and `12%`. In both `.chat-main::after` and the deliberately mirrored sign-in lattice, replace hard-coded `8%`/`6%` with those tokens. Keep the 60°/−60°/0° angles and 27/28px plus 47/48px periods unchanged. Change `.composer-clouds` from `var(--ornament-a-faint)` to `var(--ornament-a-mid)` so the bars actually read as clouds beside the sun.

**3. “The lines in the background when you switch to white mode they become very thin and hard to see also kinda similar in black mode.”** I read this as a contrast/alpha complaint, not a thickness complaint. The measured DPR is 1, so fractional-pixel splitting is not the cause on this machine. Keep every band 1px; increasing alpha makes it crisper here, while changing to 2px would alter the kasumi rhythm and muddy the clear zone. The theme-specific token values above give paper more ink than night without changing global ornament alphas.

## Surprise: the council register

If the stronger lattice still feels too quiet, add one removable CSS-only mark to `.input-wrapper::before`: a 3px-high, 18px/34px repeating kasumi rail from `left: 28px` to `right: 54px`, `top: -2px`, `opacity: var(--ornament-a-faint)`, with `pointer-events: none`. Use `var(--ornament-silhouette)`, not another pink mass. It reads as a small register for the place where the council receives its question, and it echoes the existing banded skyline without adding a branch or another logo. It causes no layout shift, dependency, or stream-time work; delete the selector if it competes with the seal.

## What I would NOT do

I would not touch the centered hero or 2×2 starter grid, redraw branches, add a torii/stars/rosette, thicken the lattice to 2px, change its periods, or add JavaScript animation. I would not globally raise `--ornament-a-*`; that would make every ornament louder to solve one field. The proposal remains inline SVG/CSS, `pointer-events: none`, and preserves the existing `prefers-reduced-motion` state.

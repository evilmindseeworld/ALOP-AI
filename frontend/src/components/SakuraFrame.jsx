import { memo } from "react";

/**
 * The decorative sakura frame behind the empty state.
 *
 * WHY THIS IS SVG AND NOT A 3D SCENE, recorded because the question will come
 * back: the ornament in this app WAS a <model-viewer> rendering a 9.4MB
 * model.glb — roughly 47x the entire gzipped JS bundle, for pure decoration —
 * pulling an unpinned runtime from unpkg on every page load. It was replaced by
 * about a kilobyte of inline SVG (see Crescent.jsx). Everything below is a few
 * kilobytes, inline, no runtime, no network, and it renders identically on a
 * phone with a dead battery. A premium look is not a heavy one.
 *
 * WHY FIVE SEPARATE SVGs RATHER THAN ONE. The first version was a single
 * <svg viewBox="0 0 400 260" preserveAspectRatio="slice"> covering the panel,
 * and it was wrong in a way worth recording: `slice` scales the WHOLE drawing
 * to cover its box, so on a 1300px panel every unit was multiplied by ~3.3.
 * Five-pixel petals became seventeen-pixel blobs and the torii filled the
 * screen. Decoration has to keep its size while its CONTAINER changes size,
 * which means each piece needs its own box. Sizes live in decoration.css; the
 * viewBox keeps them crisp at any of them.
 *
 * WHERE IT SITS: only behind the empty state. The transcript is the product,
 * and an illustrated frame around 900 words of prose competes with the thing it
 * frames. The empty state is the one screen with nothing to compete with.
 *
 * Everything paints in `currentColor` so one declaration themes the lot.
 */

/** One five-petal blossom, drawn once and instanced. */
const Blossom = ({ x, y, r = 1, o = 1 }) => (
  <g transform={`translate(${x} ${y}) scale(${r})`} opacity={o}>
    {[0, 72, 144, 216, 288].map((a) => (
      <ellipse key={a} cx="0" cy="-5.2" rx="3.1" ry="4.8" transform={`rotate(${a})`} />
    ))}
    <circle cx="0" cy="0" r="1.4" opacity="0.5" />
  </g>
);

/**
 * The seal, and it is the one thing on the screen that COMMITS.
 *
 * Nothing in this app's ornament had ever been drawn at full opacity. The whole
 * family lived between 0.16 and 0.34, which is the definition of a watermark:
 * every mark hedging, nothing asserting. The reference painting answers that
 * with two hanko — small, hard-edged, fully saturated vermilion, the only
 * saturated thing on a page otherwise made of washes. They are what stop the
 * composition floating.
 *
 * So this is a solid square at alpha 1, in `--ornament-seal`, with the glyph cut
 * out of it rather than drawn on top. NEGATIVE SPACE IS NOT A FLOURISH HERE: a
 * carved seal reads as pressed into the page, and a stroked glyph on a filled
 * square reads as a logo in a box. The mask is what makes the difference, and it
 * also means the cut-out shows whatever surface is behind the seal, so one
 * drawing works on the band, on the composer and on both themes.
 *
 * WHAT IT DRAWS is the same two-arcs-meeting-at-a-point as `Keystone` and the
 * rosette's centre: several traces agreeing. Same sentence, third size.
 *
 * NO VERTICAL STEM BETWEEN THE ARCS AND THE DOT, for the reason recorded on
 * `Keystone`: arcs plus a stem plus a dot beneath it reads as a downward arrow,
 * and an ornament that looks like a scroll-to-bottom control is a bug. The
 * inset frame is the density a real hanko gets from its border, and it is what
 * keeps two arcs from looking thin inside a 28px square.
 *
 * `id` must be unique per instance or the second seal on the page inherits the
 * first one's mask, which renders as a plain square. Two are on screen at once.
 */
export const Seal = ({ className = "sakura-seal", id = "seal" }) => (
  <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <mask id={`${id}-cut`}>
      <rect width="32" height="32" fill="#fff" />
      <rect x="3.2" y="3.2" width="25.6" height="25.6" rx="1.4" fill="none" stroke="#000" strokeWidth="1.4" />
      <g fill="none" stroke="#000" strokeWidth="2.4" strokeLinecap="round">
        <path d="M9.5 11 C 13 11.4, 15.4 13.6, 16 16.6" />
        <path d="M22.5 11 C 19 11.4, 16.6 13.6, 16 16.6" />
      </g>
      <circle cx="16" cy="21.8" r="2.2" fill="#000" />
    </mask>
    <rect
      width="32"
      height="32"
      rx="3"
      fill="var(--ornament-seal)"
      mask={`url(#${id}-cut)`}
    />
  </svg>
);

/**
 * The keystone: the mark that closes the frame.
 *
 * A centred mark at the foot of the surface closes the composition, for the
 * same reason a printer sets a fleuron at the foot of a page.
 *
 * WHAT IT DRAWS is the rosette's convergence point at small scale: separate
 * arcs arriving at one dot. The seal above the empty state says the council
 * converges; this says it again in three strokes, at the exact place the user
 * is about to ask the question that starts it. Same idea, same visual language,
 * a twentieth the size.
 *
 * NO HORIZONTAL RULE, deliberately. A line across the surface would read as a
 * wall between transcript and composer, the exact effect `--fade-bottom`
 * exists to dissolve — see base.css. The mark floats unsupported.
 */
export const Keystone = ({ className = "sakura-keystone" }) => (
  <svg
    className={className}
    viewBox="0 0 48 24"
    aria-hidden="true"
    focusable="false"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
  >
    {/* NO VERTICAL STROKE. The first version had one, and with the dot beneath
        it the whole mark read as a downward ARROW — a scroll-to-bottom
        affordance sitting above the composer, which is a control this app
        actually has elsewhere. Ornament that looks clickable is a bug. The two
        arcs alone read as a flourish; the stem read as an instruction. */}
    <path d="M3 7 C 11 7, 18 11, 22.4 15.4" strokeWidth="1.1" opacity="0.5" />
    <path d="M45 7 C 37 7, 30 11, 25.6 15.4" strokeWidth="1.1" opacity="0.5" />
    {/* Blossoms at the outer ends, so the mark is visibly the same hand that
        drew the sprigs either side of it rather than a stray glyph.
        `fill`/`stroke` are set here because this svg is stroke-only: Blossom
        draws filled ellipses and would render invisible inheriting fill="none",
        and would grow a 1.1px outline inheriting the stroke. */}
    <g fill="currentColor" stroke="none">
      <Blossom x={3} y={7} r={0.42} o={0.5} />
      <Blossom x={45} y={7} r={0.42} o={0.5} />
    </g>
    {/* The point the two arcs agree on — the one filled mark, as in the
        rosette's centre. */}
    <circle cx="24" cy="16.6" r="2" fill="currentColor" stroke="none" opacity="0.75" />
  </svg>
);

/**
 * Two sprigs resting on the prompt bar's top edge.
 *
 * The tree reached every part of this app except the one object the user
 * actually touches. `SakuraBaseCorners` frames the composer, but only on the
 * empty state — the moment a conversation starts it unmounts, and from then on
 * the prompt bar is the single undecorated surface on screen. It is also the
 * only one that is always there.
 *
 * THE SAME `Sprig`, NOT A NEW DRAWING. A second hand drawing the same flower
 * is how a house style comes apart; this is the corner branch at a smaller
 * size, straddling the card's own edge so the blossoms sit half on the border
 * and half off it — resting on the bar rather than pasted inside it.
 *
 * IT ANSWERS THE CARET. On focus the pair lifts and warms slightly. The border
 * already changes colour when the composer is focused, which is a form field
 * reporting state; the branch moving is the object noticing you. Both changes
 * are on the same element and the same easing, so they read as one gesture.
 * Positioned outside the text box on purpose — decoration over the words
 * someone is typing has no acceptable opacity, which is the same conclusion
 * decoration.css reached about the rosette and the prose beneath it.
 */
/**
 * THE TOWN UNDER A HIGH SUN, along the foot of the prompt bar.
 *
 * What was here was a branch hung ABOVE the card's top edge — half of it over
 * the transcript, at fifteen percent alpha, reading as something behind the bar
 * rather than something on it. The branch is the right family and was in the
 * wrong place: an ornament that overlaps the surface it decorates has to be
 * translucent enough to type through, and at that alpha it was a smudge.
 *
 * This stands on the ground instead. The rooftops' baseline IS the inner rule's
 * bottom line — see composer.css, which owns the strip and the padding that
 * clears it — so nothing overlaps anything and no alpha is spent hiding a
 * collision. The card gained 12px of bottom padding to give the horizon a floor
 * it owns, which is the whole cost of it.
 *
 * THE SUN IS THE SUBJECT. It is drawn in --ornament-seal, the vermilion the
 * hanko uses, at the strong step. It is the only round thing in a strip of
 * straight edges, which is what makes it read at 18px.
 *
 * IT IS UP, NOT RISING, and that is the owner's correction (2026-08-11): "the
 * sun is high in the sky." It used to sit low and to the right with the
 * roofline cutting its lower half, on the argument that a disc rising BEHIND a
 * skyline is a time of day where a disc sitting ON one is a logo. That
 * argument was for a DAWN, and it is the wrong drawing — a high sun is clear
 * of the horizon, which is the whole difference between morning and midday.
 * So it no longer touches the town at all, and the occlusion it was drawn to
 * get is gone with it.
 *
 * That leaves the "logo" risk the old note was guarding against, and the guard
 * is now the composition rather than the overlap: the disc is small, it is off
 * to the left rather than centred over anything, and the cloud bars sit at
 * different heights either side of it. A mark is a logo when it is centred and
 * alone. This one is neither.
 *
 * The town is one silhouette, not an illustration: flat blocks, three gables
 * and a two-tier pagoda, all one fill at one alpha. The overlaps are deliberate
 * and the opacity is on the GROUP rather than on each path — per-path alpha
 * would show every seam where two buildings meet.
 */
export const ComposerSkyline = memo(() => (
  <div className="composer-skyline">
    {/* 1040 UNITS WIDE, WHICH IS WIDER THAN THE CARD ON PURPOSE.
        The first draft was 320 units — 262px rendered — centred in a strip up
        to 850px, so it read as a sticker in dead space rather than as a
        horizon. A horizon is not a motif you place; it is the thing the view
        stops at, and the only way to draw one is to run it past both edges.
        The profile is AUTHORED longer rather than scaled: stretching 320 units
        to full width would shear every gable. */}
    {/* 38 UNITS TALL, WHERE THE TOWN IS 22 OF THEM. The first version had no
        sky at all: the viewBox ended at the tallest roof, so the sun could not
        be drawn above the roofline without being clipped by the top of its own
        box, and it sat half-buried in the town. Then four units of sky, which
        got the sun clear of the roofs but left it hugging them. Sixteen units
        is what it takes for a sun to be genuinely UP with room either side for
        the cloud bars.
        THE SKY IS NOW THE CONSTRAINT ON THE SUN'S HEIGHT, so read this before
        raising it further: the disc cannot go above y=0, and the strip's pixel
        height is tied to this viewBox — `.composer-skyline` is 44px for 38
        units, and composer.css's bottom padding is derived from that height and
        must move with it. Buying more sky costs composer height, which costs
        transcript. It was not worth it for the two units left in hand. */}
    <svg viewBox="0 0 1040 38" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">
      {/* WHY A FIXED x AND NOT A FRACTION OF THE DRAWING.
          The sun used to sit at 330 of 1040 with the strip CENTRING the
          drawing, which meant its distance from the card's left edge was a
          function of the card's width — at a phone width the visible window is
          the middle 350px of a 1200px drawing and the sun was outside it
          entirely. The strip now aligns the drawing to its left edge (see
          composer.css), so this coordinate is a fixed offset from the card's
          left edge at every viewport. The clip that makes this a horizon rather
          than a motif moved to the right end, where the town runs off.

          96 FROM 170, and r 9 from 10 with the centre up a unit to 11.

          THE RADIUS IS WHAT BUYS THE ALTITUDE, and the reason is a clip, so do
          not "fix" this by raising cy. `.composer-skyline` is `overflow:
          hidden` and `:focus-within` lifts this disc 2px (composer.css). At
          44px per 38 units that is 1.73 units, so the top of the sun can never
          sit above y≈1.73 or it loses a chord off its crown every time the
          composer takes focus. The old disc was already at that ceiling: top
          y=2 at cy=12, r=10. Its centre could not rise at all.

          So the height came out of the radius instead. Same top edge, one unit
          less disc, and the bottom rises four units — which is the measurement
          that matters, because "high in the sky" is about the gap to the
          horizon, not the distance to the top of a box nobody can see. That gap
          was ZERO: the old sun's lowest point was y=22 and the gable beside it
          peaked at exactly 22, which is why it read as sitting on the roofs.
          It is now 11 units of open sky — the town under x 80-136 is at y 31-33
          absolute and this disc bottoms out at 20. */}
      {/* THE WEATHER MOVES; THE TOWN DOES NOT. Sun and cloud are one group so
          their spacing is authored once and survives the shift — the clearances
          measured below are between members of THIS group, so they hold at every
          viewport rather than needing re-deriving per breakpoint.

          The shift itself is in composer.css and is bounded. Why it exists: a
          single fixed x cannot be middle-left at both ends. At 320px the strip
          shows about 219 units and x=96 lands 44% across, which is right. At
          desktop the strip shows about 607 and the same 96 lands at 16%, hard
          against the edge. Measured, not reasoned: at a 1068px window the strip
          is 702.8px, the drawing renders at 1.158px per unit (height-bound, so
          this ratio is FIXED at every width), and the sun's centre sits 111px
          from the card's left edge.

          A UNIT IN THAT TRANSFORM IS AN SVG UNIT, NOT A CSS PIXEL, and this is
          the part that will mislead the next reader. `translateX(74px)` on an
          SVG child resolves in the user coordinate system: measured in Chrome at
          this viewBox it moved the disc 60.3 CSS px, not 74. Any number written
          into that clamp is in the same 1040-wide space as the coordinates
          here — do not convert it. */}
      <g className="composer-weather">
      <circle className="composer-sun" cx="96" cy="11" r="9" />
      {/* KASUMI BARS, which is the only cloud this drawing can carry.
          A rendered cloud is a soft mass and everything else in the strip is a
          hard edge — the two do not read as one hand. Japanese screens solve it
          with flat banded cloud, and a rounded bar is that at 3 units tall.
          They are ORNAMENT INK at the faint step, not silhouette: the town is a
          mass and these are line work, and a second solid shape in the sky
          would compete with the one thing in the strip that is meant to be
          looked at. None of them touches the disc — a bar across the sun is a
          handsome drawing at poster size and a smudge at 44px. */}
      {/* SEVEN BARS, ONE PER SEAT. Four approach from the left, three answer
          from the right, and the sun is the one resolved mark between them. The
          council is seven voices reconciled into a single reply, and this is
          that shape in weather rather than printed as a widget — the owner has
          ruled out a council table on the chat screen, and this is not one: it
          labels nothing, counts nothing, and updates never. If the roster size
          ever changes this does not have to.

          CHECKED AGAINST THE DISC RATHER THAN EYEBALLED, centre (96, 11) and
          r=9. The nearest corner in the set is (82, 7.4) on the fourth bar:
          sqrt(14² + 3.6²) = 14.46 units, so 5.46 clear of the edge. Next
          nearest is the third bar's right edge at x=70, 26 units out. Nothing
          crosses the disc — a bar across the sun is a handsome drawing at poster
          size and a smudge at 44px. These are group-local, so the shift above
          does not disturb any of it. */}
      <g className="composer-clouds">
        <rect x="18" y="4.2" width="24" height="3.4" rx="1.7" />
        <rect x="36" y="12.4" width="32" height="4" rx="2" />
        <rect x="54" y="8.2" width="16" height="3.2" rx="1.6" />
        <rect x="68" y="3.4" width="14" height="4" rx="2" />
        <rect x="118" y="4.8" width="26" height="3.6" rx="1.8" />
        <rect x="126" y="12.4" width="34" height="4" rx="2" />
        <rect x="170" y="8.2" width="16" height="3.2" rx="1.6" />
      </g>
      </g>
      {/* The town keeps its own coordinates and is dropped 16 units into the
          taller box, so the profile below is the same drawing it always was and
          none of its numbers had to be re-derived. */}
      <g className="composer-town" transform="translate(0 16)">
        <path d="M0 22 V15 H16 V10 H24 V15 H38 L46 7 L54 15 H68 V5 H80 V15 H100 V17 H136 V12 H150 L158 6 L166 12 H180 V16 H196 V9 H208 V16 H228 L236 8 L244 16 H258 V13 H272 V17 H292 V14 H320 V16 H340 V8 H352 V16 H372 V12 H392 L401 6 L410 12 H430 V17 H452 V11 H470 V15 H486 V17 H520 V13 H536 L546 7 L556 13 H574 V16 H590 V9 H604 V16 H624 V13 H648 V17 H666 V10 H684 V15 H704 L713 8 L722 15 H740 V12 H762 V17 H780 V14 H800 V6 H816 V14 H836 V16 H860 V11 H884 V16 H904 L915 7 L926 16 H944 V13 H962 V17 H984 V10 H1000 V15 H1018 V17 H1040 V22 Z" />
        {/* Two pagodas, each rising out of a low run the profile leaves for it —
            x 100–136 and x 486–520. Two flared eaves apiece: the flare is the
            whole silhouette, so these are the only curves in a strip of
            straight lines.
            NO FINIAL. The mast on the first draft was 1.2 units — under a pixel
            at this height — and a sub-pixel path does not render as a spire, it
            renders as a stray hairline over the roof. */}
        <path d="M104 9 Q118 4.5 132 9 L128.5 10.6 Q118 7.4 107.5 10.6 Z" />
        <path d="M112 10.6 H124 V13.4 H112 Z" />
        <path d="M101 15.4 Q118 10.6 135 15.4 L131.5 17 Q118 13.4 104.5 17 Z" />
        <path d="M109 17 H127 V22 H109 Z" />
        <path d="M489 9 Q503 4.5 517 9 L513.5 10.6 Q503 7.4 492.5 10.6 Z" />
        <path d="M497 10.6 H509 V13.4 H497 Z" />
        <path d="M486 15.4 Q503 10.6 520 15.4 L516.5 17 Q503 13.4 489.5 17 Z" />
        <path d="M494 17 H512 V22 H494 Z" />
      </g>
    </svg>
  </div>
));

ComposerSkyline.displayName = "ComposerSkyline";

export const ComposerSprigs = memo(() => (
  <div className="composer-sprigs" aria-hidden="true">
    <ComposerSkyline />
    <Seal className="sakura-seal composer-seal" id="composer-seal" />
  </div>
));

ComposerSprigs.displayName = "ComposerSprigs";

/**
 * The keystone, anchored to the chat surface rather than the scroller, so it
 * sits centred above the composer.
 *
 * THE BRANCHES ARE GONE — all four corner sprigs, the four separate drawings,
 * the leaf, and the falling petals on sign-in. Cut on the owner's instruction
 * (2026-08-11): "leave the earrings, just delete the branches." The top pair
 * came off first as a declutter and the rest followed in the same breath.
 *
 * What that leaves is the family's harder half, which is the half that was
 * carrying it: the crescents, the keystone, the seal, the skyline and the
 * asanoha lattice. The branch was the part that said "Japanese" without saying
 * anything about THIS product — the same charge that retired the torii, in the
 * note below. It took four hand-authored variants to stop reading as a CSS
 * frame, and it still decorated rather than argued.
 *
 * DO NOT REDRAW IT. If this screen needs more, it needs it from the marks that
 * mean something here.
 *
 * `pointer-events: none` is on the wrapper in CSS: this overlaps the composer's
 * top edge by design, and decoration must never eat a click meant for the
 * prompt bar.
 */
export const SakuraBaseCorners = memo(() => (
  <div className="sakura-base" aria-hidden="true">
    <Keystone />
  </div>
));

SakuraBaseCorners.displayName = "SakuraBaseCorners";

/**
 * The torii went first, replaced by CouncilRosette: it was atmosphere borrowed
 * from a theme, and said nothing about a product where several models answer
 * separately and converge on one reply. The rosette is built out of that
 * mechanic — see CouncilRosette.jsx.
 *
 * THE FRAME HAS NOW FOLLOWED IT, for the same reason and by the same argument.
 * It held the two top corner sprigs and nothing else, so with the branches cut
 * there was no component left — an empty wrapper kept "in case" is how dead
 * code survives a deletion. The default export is gone; this file exports the
 * pieces that still draw something. See SakuraBaseCorners above for what the
 * family is now and why the branches are not coming back.
 */

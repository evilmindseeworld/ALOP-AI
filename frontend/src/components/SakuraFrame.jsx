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
 * One leaf, in the SECOND COLOUR.
 *
 * This is the only part of the branch that is not `currentColor`, and that is
 * the point. Every ornament in this app used to be one hue at five alphas,
 * which is what a watermark is — the reference painting this family comes from
 * carries pink blossom, sage leaf and a single vermilion seal, and reads as ink
 * on paper because of it. `--ornament-leaf` is declared per theme, so the leaf
 * follows Sakura Night and Bamboo Day without a second drawing.
 */
const Leaf = ({ x, y, r = 1, a = 0, o = 0.7 }) => (
  <path
    d="M0 0 C 3.4 -3.6, 8.4 -3.9, 11.6 -1.2 C 8.2 2.6, 3.2 3.1, 0 0 Z"
    transform={`translate(${x} ${y}) rotate(${a}) scale(${r})`}
    fill="var(--ornament-leaf)"
    opacity={o}
  />
);

/**
 * A corner branch, in four DIFFERENT drawings.
 *
 * It used to be one drawing mirrored with scale(-1) into all four corners, plus
 * a fifth and sixth copy on the composer. That is why the ornament read as a
 * CSS frame rather than as a painting: a perfect bilateral pair is the one
 * thing no hand-drawn branch has ever been, and the eye reads the symmetry long
 * before it reads the flowers. The reference has a single branch rising from
 * the lower left with its mass right of centre and nothing repeated anywhere.
 *
 * So there are four variants and no mirroring. They differ in branch path,
 * blossom count, leaf placement and length, and decoration.css gives each
 * corner a different SIZE and ALPHA on top of that — the right-hand pair is
 * larger, which is what moves the composition's mass off centre.
 *
 * MIRRORING IS NOT COMING BACK. If a fifth position is ever needed, draw a
 * fifth variant. `scaleX(-1)` on any of these undoes the whole change.
 *
 * Still never ROTATED past a few degrees, for the original reason: a branch
 * turned upside down hangs its blossoms underneath itself.
 */
const SPRIGS = {
  /* TOP LEFT. Enters at the corner and sweeps down and right, heaviest of the
     four: this is the one the eye lands on first. */
  tl: (
    <g>
      <path d="M2 4 C 28 10, 50 20, 70 36 C 82 45, 94 51, 108 54" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.62" />
      <path d="M42 17 C 48 28, 54 34, 64 39" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.45" />
      <Leaf x={38} y={14} r={0.95} a={26} o={0.8} />
      <Leaf x={74} y={40} r={0.8} a={-42} o={0.62} />
      <Blossom x={16} y={7} r={1} o={0.9} />
      <Blossom x={40} y={16} r={0.75} o={0.6} />
      <Blossom x={63} y={39} r={1.1} o={0.95} />
      <Blossom x={90} y={21} r={0.85} o={0.7} />
      <Blossom x={106} y={53} r={0.7} o={0.55} />
      {/* Loose petals falling away from the branch. Every reference image has
          these, and they are what stops a sprig reading as a diagram. */}
      <Blossom x={28} y={38} r={0.5} o={0.4} />
      <Blossom x={82} y={66} r={0.45} o={0.3} />
    </g>
  ),
  /* TOP RIGHT. Enters at the right edge and runs down and LEFT — authored that
     way rather than flipped, which is the whole point of this set. It is
     deliberately the sparsest: four blossoms against the top left's seven, so
     the two do not read as one gesture repeated. */
  tr: (
    <g>
      <path d="M118 6 C 96 12, 78 20, 62 32 C 46 44, 30 49, 14 50" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" opacity="0.58" />
      <Leaf x={86} y={16} r={0.9} a={152} o={0.74} />
      <Blossom x={112} y={8} r={0.9} o={0.85} />
      <Blossom x={84} y={18} r={0.7} o={0.58} />
      <Blossom x={60} y={33} r={1.05} o={0.9} />
      <Blossom x={17} y={50} r={0.6} o={0.48} />
      <Blossom x={44} y={62} r={0.42} o={0.28} />
    </g>
  ),
  /* BOTTOM LEFT. Rises out of the corner. The cluster sits at the FAR end,
     which is what stops the four corners sharing a rhythm. */
  bl: (
    <g>
      <path d="M2 70 C 22 62, 40 48, 56 32 C 68 20, 84 12, 104 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.6" />
      <path d="M56 32 C 62 40, 70 45, 80 47" fill="none" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" opacity="0.42" />
      <Leaf x={48} y={36} r={0.9} a={-38} o={0.75} />
      <Leaf x={86} y={13} r={0.7} a={-8} o={0.55} />
      <Blossom x={88} y={11} r={1.05} o={0.92} />
      <Blossom x={103} y={10} r={0.8} o={0.72} />
      <Blossom x={78} y={47} r={0.7} o={0.55} />
      <Blossom x={30} y={53} r={0.55} o={0.4} />
    </g>
  ),
  /* BOTTOM RIGHT. Rises left out of the right corner. Two blossoms and a leaf
     only: it sits beside the composer, and the quietest corner belongs next to
     the one control on the screen. */
  br: (
    <g>
      <path d="M118 68 C 100 62, 84 52, 70 38 C 58 26, 42 18, 22 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.56" />
      <Leaf x={78} y={44} r={0.85} a={140} o={0.7} />
      <Blossom x={112} y={66} r={0.75} o={0.62} />
      <Blossom x={68} y={37} r={1} o={0.88} />
      <Blossom x={24} y={14} r={0.65} o={0.5} />
      <Blossom x={50} y={52} r={0.4} o={0.26} />
    </g>
  ),
  /* THE PROMPT BAR, and the only one that CROSSES ITS OWN BOX. It runs off the
     right edge of the viewBox so that on the composer a real length of branch
     lies over the card surface rather than stopping at its border. That crossing
     is what makes the ornament read as resting ON the bar; see composer.css. */
  bar: (
    <g>
      <path d="M0 8 C 26 14, 46 26, 62 42 C 74 54, 92 62, 120 66" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.66" />
      <path d="M34 18 C 40 30, 44 40, 44 52" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.44" />
      <Leaf x={30} y={16} r={1} a={34} o={0.82} />
      <Leaf x={66} y={47} r={0.85} a={-16} o={0.66} />
      <Leaf x={100} y={62} r={0.7} a={8} o={0.5} />
      <Blossom x={14} y={9} r={0.95} o={0.88} />
      <Blossom x={44} y={53} r={0.8} o={0.62} />
      <Blossom x={61} y={41} r={1.15} o={0.95} />
      <Blossom x={96} y={62} r={0.75} o={0.6} />
      <Blossom x={116} y={66} r={0.55} o={0.42} />
    </g>
  ),
};

const Sprig = ({ variant = "tl" }) => SPRIGS[variant] ?? SPRIGS.tl;

/**
 * Exported because the BOTTOM PAIR CANNOT LIVE IN THIS FRAME.
 *
 * The frame is inside `.scroll-wrapper`, which has `overflow: auto` — so a
 * child of it cannot paint outside it, however it is positioned. The bottom
 * sprigs were therefore stuck at the bottom of the SCROLLING BOX, floating in
 * the margins beside the starter cards, while the composer sat below in a
 * different box entirely. Insetting the frame further only moved them within
 * the same clip.
 *
 * `SakuraBaseCorners` renders the same drawing as a sibling of the scroller,
 * in `.chat-content`, where the bottom of the box really is the bottom of the
 * chat surface. See decoration.css.
 */
export const Corner = ({ className, variant }) => (
  <svg className={className} viewBox="0 0 120 76" aria-hidden="true" focusable="false" fill="currentColor">
    <Sprig variant={variant} />
  </svg>
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
 * Two sprigs in two corners read as two decorations. One centred mark between
 * them reads as a frame, because the eye completes the line — the same reason a
 * printer sets a fleuron at the foot of a page rather than two ornaments in the
 * corners and nothing between.
 *
 * WHAT IT DRAWS is the rosette's convergence point at small scale: separate
 * arcs arriving at one dot. The seal above the empty state says the council
 * converges; this says it again in three strokes, at the exact place the user
 * is about to ask the question that starts it. Same idea, same visual language,
 * a twentieth the size.
 *
 * NO HORIZONTAL RULE, deliberately. A line spanning corner to corner here would
 * read as a wall between the transcript and the composer, which is the exact
 * effect `--fade-bottom` exists to dissolve — see base.css. The mark floats
 * unsupported; the corners are what imply the line.
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
export const ComposerSprigs = memo(() => (
  <div className="composer-sprigs" aria-hidden="true">
    <Corner className="composer-sprig composer-sprig-l" variant="bar" />
    <Seal className="sakura-seal composer-seal" id="composer-seal" />
  </div>
));

ComposerSprigs.displayName = "ComposerSprigs";

/**
 * The two lower sprigs and the keystone, anchored to the chat surface rather
 * than the scroller, so they sit in the real bottom corners either side of the
 * composer with the mark centred between them.
 *
 * `pointer-events: none` is on the wrapper in CSS: these overlap the composer's
 * outer corners by design, and decoration must never eat a click meant for the
 * prompt bar.
 */
export const SakuraBaseCorners = memo(() => (
  <div className="sakura-base" aria-hidden="true">
    <Corner className="sakura-corner sakura-corner-bl" variant="bl" />
    <Keystone />
    <Corner className="sakura-corner sakura-corner-br" variant="br" />
  </div>
));

SakuraBaseCorners.displayName = "SakuraBaseCorners";

/**
 * The torii is gone, replaced by CouncilRosette.
 *
 * It was atmosphere borrowed from a theme: it said "Japanese" and said nothing
 * about a product where several models answer separately and converge on one
 * reply. The rosette is built out of that mechanic — see CouncilRosette.jsx.
 * The sprigs stay because they frame without asserting a subject.
 *
 * THE ROSETTE IS NOT IN HERE ANY MORE. It hung at the frame's top edge, which
 * is concentric with nothing: `.empty-state` centres its whole column, so the
 * mark's y is a function of how tall the title, subtitle and starter grid come
 * out at that viewport. It now renders inside the mark's own box — see
 * EmptyState in MessageList.jsx. Sign-in never showed it: this frame renders
 * there too, and signin.css had been hiding it with `display: none` since
 * before the move, so the copy here was drawing nothing on either screen.
 */
const SakuraFrame = memo(() => (
  <div className="sakura-frame" aria-hidden="true">
    <Corner className="sakura-corner sakura-corner-tl" variant="tl" />
    <Corner className="sakura-corner sakura-corner-tr" variant="tr" />
  </div>
));

SakuraFrame.displayName = "SakuraFrame";

export default SakuraFrame;

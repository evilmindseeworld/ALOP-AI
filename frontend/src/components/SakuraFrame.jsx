import { memo } from "react";
import CouncilRosette from "./CouncilRosette";

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
 * A corner branch. Drawn once for the top-left and mirrored for the rest —
 * authoring four by hand is four chances for one to be subtly wrong.
 *
 * Mirrored with scale(-1), never rotated: a rotated branch grows the wrong way
 * and the blossoms end up hanging underneath it on two of the four corners.
 */
const Sprig = () => (
  <g>
    <path d="M2 4 C 28 10, 50 20, 70 36 C 82 45, 94 51, 108 54" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
    <path d="M42 17 C 48 28, 54 34, 64 39" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
    <path d="M72 38 C 76 30, 82 25, 90 22" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
    <Blossom x={16} y={7} r={1} o={0.9} />
    <Blossom x={40} y={16} r={0.75} o={0.6} />
    <Blossom x={63} y={39} r={1.1} o={0.95} />
    <Blossom x={90} y={21} r={0.85} o={0.7} />
    <Blossom x={106} y={53} r={0.7} o={0.55} />
    {/* Loose petals falling away from the branch. Every reference image has
        these, and they are what stops a sprig reading as a diagram. */}
    <Blossom x={28} y={38} r={0.5} o={0.4} />
    <Blossom x={82} y={66} r={0.45} o={0.3} />
    <Blossom x={54} y={62} r={0.38} o={0.25} />
  </g>
);

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
export const Corner = ({ className }) => (
  <svg className={className} viewBox="0 0 120 76" aria-hidden="true" focusable="false" fill="currentColor">
    <Sprig />
  </svg>
);

/**
 * The two lower sprigs, anchored to the chat surface rather than the scroller,
 * so they sit in the real bottom corners either side of the composer.
 *
 * `pointer-events: none` is on the wrapper in CSS: these overlap the composer's
 * outer corners by design, and decoration must never eat a click meant for the
 * prompt bar.
 */
export const SakuraBaseCorners = memo(() => (
  <div className="sakura-base" aria-hidden="true">
    <Corner className="sakura-corner sakura-corner-bl" />
    <Corner className="sakura-corner sakura-corner-br" />
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
 */
const SakuraFrame = memo(() => (
  <div className="sakura-frame" aria-hidden="true">
    <CouncilRosette />
    <Corner className="sakura-corner sakura-corner-tl" />
    <Corner className="sakura-corner sakura-corner-tr" />
  </div>
));

SakuraFrame.displayName = "SakuraFrame";

export default SakuraFrame;

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

const Corner = ({ className }) => (
  <svg className={className} viewBox="0 0 120 76" aria-hidden="true" focusable="false" fill="currentColor">
    <Sprig />
  </svg>
);

/**
 * The torii.
 *
 * Proportions are the whole job or it reads as a table: the kasagi (top lintel)
 * overhangs the pillars and sweeps up at the ends, the nuki (second beam) is
 * shorter than it, the pillars taper and lean inward, and the gakuzuka is the
 * small plaque between them.
 */
const Torii = () => (
  <svg className="sakura-torii" viewBox="0 0 240 190" aria-hidden="true" focusable="false" fill="currentColor">
    <path d="M14 30 C 76 12, 164 12, 226 30 L 226 41 C 164 24, 76 24, 14 41 Z" />
    <rect x="34" y="60" width="172" height="8" rx="2" />
    <path d="M62 41 L 78 41 L 86 186 L 68 186 Z" />
    <path d="M178 41 L 162 41 L 154 186 L 172 186 Z" />
    <rect x="112" y="70" width="16" height="26" rx="2" opacity="0.75" />
  </svg>
);

const SakuraFrame = memo(() => (
  <div className="sakura-frame" aria-hidden="true">
    <Torii />
    <Corner className="sakura-corner sakura-corner-tl" />
    <Corner className="sakura-corner sakura-corner-tr" />
    <Corner className="sakura-corner sakura-corner-bl" />
    <Corner className="sakura-corner sakura-corner-br" />
  </div>
));

SakuraFrame.displayName = "SakuraFrame";

export default SakuraFrame;

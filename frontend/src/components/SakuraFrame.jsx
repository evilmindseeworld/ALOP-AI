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
 * A blossom hanging off the wood, on its own stem.
 *
 * The pedicel is the whole difference between a branch with flowers on it and a
 * branch with flowers NEAR it. Without the short stem connecting the two, the
 * blossoms read as a separate scatter layer that happens to overlap a stick.
 *
 * @param x,y   where it leaves the wood
 * @param drop  how far it hangs. Longer stems near the tips, where a real
 *              branch is thinnest and the weight actually pulls.
 * @param sway  sideways drift of the hang, so no two fall on the same plumb line
 */
const Hanger = ({ x, y, drop, sway = 0, r = 1, o = 1 }) => (
  <g opacity={o}>
    <path
      d={`M${x} ${y} q ${sway * 0.3} ${drop * 0.65}, ${sway} ${drop}`}
      fill="none"
      stroke="var(--bark)"
      strokeWidth="0.8"
      strokeLinecap="round"
      opacity="0.75"
    />
    <Blossom x={x + sway} y={y + drop + r * 4} r={r} />
  </g>
);

/**
 * THE BOUGH. One piece of wood, entering from a corner.
 *
 * WHAT THIS REPLACED, and why the replacement is smaller rather than larger:
 * four identical flowering sprigs, one per corner, mirrored from a single
 * drawing. Four corners of the same shape is a FRAME, and a frame is wallpaper —
 * the eye reads it as border stock and stops looking. It also fought the one
 * aesthetic the app is named after: symmetry is the opposite of what a sakura
 * arrangement does. Asymmetry is the point of the reference, not a liberty
 * taken with it.
 *
 * So: one bough, top-left, flush into the corner, and a much smaller echo at
 * the bottom-right that balances the weight without answering it. Two elements
 * where there were four, and the composition now has a direction.
 *
 * WOOD, NOT WIRE. The old branch was a 1.5px stroke of the same pink as the
 * flowers, which is a line drawing of a branch. This is a filled path that is
 * thick where it enters and tapers to nothing at the tips, in its own bark
 * colour — so the blossoms are the only pink and are the brightest thing in the
 * ornament, which is the correct hierarchy for a cherry branch.
 *
 * The blossoms HANG. They are attached by short stems that drop from the
 * underside of the limbs, which is what they do on a real tree and what the
 * old version, with flowers sitting on top of the line, did not.
 */
const Bough = () => (
  <g>
    {/* Main limb. Outline traced out along the top edge and back along the
        bottom, the two converging at the tip — that convergence is the taper,
        and it is why this cannot be a stroke.
        NINE UNITS AT THE BASE, THREE AT THE TIP. The first attempt was sixteen
        and five, which at the rendered 300px is a 26px slab: it read as a grey
        bar with flowers near it, not as wood. A branch is mostly thin. */}
    <path
      d="M0 5 C 34 11, 70 25, 104 49 C 122 61, 143 71, 173 79 L 173 82
         C 142 75, 119 66, 100 53 C 68 31, 33 18, 0 14 Z"
      fill="var(--bark)"
      opacity="0.62"
    />
    {/* Each fork STARTS INSIDE the limb, not against it. Beginning at the
        outline leaves a hairline of background between the two shapes at some
        zoom levels, and a fork that does not visibly join reads as a second
        stick lying across the first. */}
    <path
      d="M46 17 C 64 12, 86 8, 108 7 L 108 10 C 87 12, 66 17, 50 22 Z"
      fill="var(--bark)"
      opacity="0.52"
    />
    {/* Dropping away. This one carries the heaviest blossoms, because weight is
        what bends a branch down in the first place. */}
    <path
      d="M82 39 C 94 51, 105 66, 113 84 L 110 86 C 101 69, 90 55, 79 44 Z"
      fill="var(--bark)"
      opacity="0.52"
    />

    {/* Clustered where the forks leave the limb, which is where buds crowd on a
        real tree, and thinning toward the tips.
        THE DROPS ARE LONG ON PURPOSE. At a drop of 6 the blossom overlaps the
        wood it hangs from and the stem is invisible, which is the whole
        difference between a branch with flowers ON it and one with flowers
        hanging OFF it. */}
    <Hanger x={22} y={12} drop={16} sway={-3} r={0.9} o={0.95} />
    <Hanger x={48} y={19} drop={22} sway={4} r={0.75} o={0.8} />
    <Hanger x={86} y={42} drop={18} sway={-4} r={1} o={1} />
    <Hanger x={104} y={9} drop={14} sway={3} r={0.65} o={0.65} />
    <Hanger x={112} y={84} drop={13} sway={-3} r={0.8} o={0.75} />
    <Hanger x={144} y={72} drop={20} sway={5} r={0.7} o={0.6} />
    <Hanger x={172} y={81} drop={12} sway={-4} r={0.55} o={0.45} />

    {/* Loose petals, already fallen and attached to nothing. Every reference
        image has these, and they are what stops the whole thing reading as a
        botanical diagram. */}
    <Blossom x={64} y={72} r={0.4} o={0.26} />
    <Blossom x={132} y={110} r={0.34} o={0.2} />
    <Blossom x={98} y={100} r={0.28} o={0.16} />
  </g>
);

const Limb = ({ className }) => (
  <svg className={className} viewBox="0 0 180 122" aria-hidden="true" focusable="false" fill="currentColor">
    <Bough />
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
    {/* Bottom right, because it is the only corner of this screen with nothing
        already in it. See decoration.css for the measurement that moved it
        there, and for why it is mirrored rather than rotated. */}
    <Limb className="sakura-limb sakura-limb-br" />
  </div>
));

SakuraFrame.displayName = "SakuraFrame";

export default SakuraFrame;

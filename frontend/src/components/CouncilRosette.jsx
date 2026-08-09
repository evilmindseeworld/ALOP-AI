import { memo, useMemo } from "react";

/**
 * The council, drawn.
 *
 * This replaces the torii that used to sit behind the empty state. The torii
 * was atmosphere borrowed from a theme; it said "Japanese" and nothing about
 * this product. A guilloché rosette is built the way this product works:
 * several independent traces, each following its own rhythm, superimposed
 * until they resolve into one figure. That is the council — several models
 * answer separately, read each other, and converge on a single reply.
 *
 * THE TRACE COUNT IS NOT DECORATIVE. `traces` is the number of models in the
 * pro council, and the boot banner prints the same number. If the council
 * changes size, this changes with it and the ornament stays true.
 *
 * WHY GUILLOCHÉ AND NOT A BLOB OR A GLOW. Guilloché is the linework on
 * banknotes and share certificates. It reads as issued rather than generated,
 * which is the opposite of the soft gradient haze every AI product currently
 * ships. It is also cheap: a few hundred points of `<path>` data, computed
 * once, no runtime, no image, no filter.
 *
 * THE MATH is an epitrochoid — a point on a circle rolling around another
 * circle:
 *
 *   x = R·cos(t) + d·cos(k·t + φ)
 *   y = R·sin(t) + d·sin(k·t + φ)
 *
 * `k` (petals) sets how many lobes the figure has, `d` how far the lobes swing
 * from the base circle, and `φ` rotates each trace off its neighbour. Giving
 * every trace the same φ would stack them into one thick line; spreading φ
 * evenly across a full turn is what produces the interference lattice that
 * makes the figure look engraved rather than drawn.
 *
 * LINE SPACING IS THE ONE NUMBER TO RESPECT. Guilloché moirés badly when its
 * lines fall closer than a few pixels — the pattern starts to shimmer and
 * alias, especially once a browser scales the SVG. `d` and the trace count are
 * tuned so neighbouring curves stay separated at the sizes this renders at.
 * If you raise the trace count, lower `d` to match, and look at it at 320px
 * before believing it.
 */

const TAU = Math.PI * 2;

/**
 * One closed epitrochoid trace as an SVG path string.
 *
 * `steps` is sampling resolution, not detail: too few and the curve turns into
 * a polygon at large sizes, too many and the path string bloats for points no
 * one can see. 240 holds up past 600px, which is well beyond where this is
 * ever drawn.
 */
const trace = ({ R, d, k, phase, cx, cy, steps = 240 }) => {
  let out = "";
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * TAU;
    const x = cx + R * Math.cos(t) + d * Math.cos(k * t + phase);
    const y = cy + R * Math.sin(t) + d * Math.sin(k * t + phase);
    out += `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return `${out}Z`;
};

const CouncilRosette = memo(({ traces = 7, petals = 5 }) => {
  // Computed once per trace count. The whole figure is a few hundred numbers,
  // so this is memoised for tidiness rather than for speed.
  const paths = useMemo(() => {
    const cx = 160;
    const cy = 160;
    return Array.from({ length: traces }, (_, i) => ({
      key: i,
      // Each trace sits on a slightly different base radius so the figure has
      // depth instead of reading as one ring drawn several times.
      d: trace({
        R: 96 - i * 1.6,
        d: 34,
        k: petals,
        phase: (i / traces) * TAU,
        cx,
        cy,
      }),
    }));
  }, [traces, petals]);

  return (
    <svg
      className="council-rosette"
      viewBox="0 0 320 320"
      aria-hidden="true"
      focusable="false"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="0.6"
        vectorEffect="non-scaling-stroke"
      >
        {paths.map((p) => (
          <path key={p.key} d={p.d} />
        ))}
      </g>
      {/* The still point the traces agree on. Every trace passes through the
          same centre, which is the only part of the figure they share — so it
          gets the one solid mark in the drawing. */}
      <circle cx="160" cy="160" r="1.6" fill="currentColor" opacity="0.5" />
    </svg>
  );
});

CouncilRosette.displayName = "CouncilRosette";

export default CouncilRosette;

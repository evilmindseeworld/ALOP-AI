import { memo, useEffect, useRef, useState } from "react";

/**
 * The ensō, drawn by seven hands.
 *
 * WHAT THIS REPLACED. Five ornaments: two hanging crescent moons, a wooden
 * sakura bough, a torii silhouette, and the lattice behind them. Together they
 * said "Japanese night" and nothing else. The product's actual differentiator —
 * seven models answer separately, read each other, then reconcile into one
 * reply — was stated in a subtitle and drawn nowhere.
 *
 * WHY AN ENSŌ. It is the ink circle drawn in a single breath and deliberately
 * left open, and it earns its place three times over:
 *
 *   - It is one object, where there were five. The whole ornament is a ring.
 *   - It is drawn here as SEVEN OVERLAPPING ARCS. Up close there are seven
 *     strokes; from across the room there is one circle. That is the product's
 *     sentence, in a form that is a real art object rather than a diagram.
 *   - An open circle is what an empty state IS. The gap is the question nobody
 *     has asked yet, and it sits on the one screen that asks for one.
 *
 * TWO EARLIER ATTEMPTS ARE WORTH RECORDING, because both failed for reasons
 * that would otherwise get rediscovered. The first drew seven strokes fanning
 * across the full width of the chat surface into a convergence point: at that
 * length a brush stroke has nowhere to vary, so it came out as parallel bars
 * meeting at a vertex — a network diagram — and it ran straight behind the
 * transcript. The second shrank the same fan to a mark in the margin, which
 * fixed the prose problem and left a shape that read as a quill, and sat one
 * row above this app's own send arrow looking like a sibling of it. Convergence
 * drawn as a fan is a diagram gesture. Convergence drawn as a closing ring is
 * a picture.
 *
 * MOTION IS RARE BY DEFAULT. The ornament this replaced had petals falling
 * forever, two moons swinging forever and a logo pulsing forever — three
 * infinite decorative loops on one screen, which is the first thing every
 * animation guideline warns about. This one is still:
 *
 *   - It draws itself once per session, not once per empty state. A new chat is
 *     opened many times a day; the first one of a tab is a first impression and
 *     can afford 800ms, the twentieth cannot.
 *   - Idle: nothing moves.
 *   - Working: the arcs light in sequence around the ring, which reads as the
 *     circle being drawn. That is the loading-indicator exception, and it
 *     inherits the job the swinging crescents did — the periphery reports that
 *     something is happening without a second spinner mid-page.
 */

const CX = 78;
const CY = 78;

/**
 * Where the brush starts and how far it travels, in degrees.
 *
 * 306°, not 360: the remaining 54° is the ensō's opening. Starting at 128°
 * (lower left in SVG's y-down space) puts that gap at the upper right, which is
 * where a right-handed brush would lift.
 */
const START = 128;
const SWEEP = 306;

/** Each arc overreaches its neighbour so the ring has no seams, only overlaps. */
const OVERLAP = 5;

const polar = (r, deg) => {
  const rad = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)];
};

/**
 * The seven, in the order the brush lays them down.
 *
 * NOTHING HERE IS REGULAR, and that is the whole difference between an ensō and
 * a compass circle. `r` varies so the ring wobbles off true; `w` is the brush
 * pressure, heaviest through the middle of the stroke where the hand is
 * committed and lightest at the two ends where it lands and lifts.
 *
 * The last arc carries `--primary`, and it is the only colour in the drawing.
 * It is not a separate mark for "the reply" — the reply is not separate from
 * the seven, it is made of them, so the ring simply finishes in the answer's
 * colour.
 */
const ARCS = [
  { r: 55.5, w: 3.2, o: 0.34 },
  { r: 57.5, w: 5.4, o: 0.46 },
  { r: 56, w: 7.6, o: 0.6 },
  { r: 58.5, w: 8.4, o: 0.72 },
  { r: 56.5, w: 7.2, o: 0.62 },
  { r: 58, w: 5.2, o: 0.5 },
  { r: 56, w: 3.4, o: 1, reply: true },
];

const arcPath = (i, r) => {
  const step = SWEEP / ARCS.length;
  const a0 = START + i * step - (i === 0 ? 0 : OVERLAP);
  const a1 = START + (i + 1) * step + (i === ARCS.length - 1 ? 0 : OVERLAP);
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

/**
 * Once per session, not once per mount.
 *
 * Module scope rather than state or storage: it should reset when the tab does,
 * because a fresh tab is a fresh first impression, and it must not survive into
 * tomorrow's session as "already seen".
 */
let hasDrawn = false;

const CouncilInk = memo(({ active = false, dim = false, className = "" }) => {
  const [drawn, setDrawn] = useState(hasDrawn);
  const frame = useRef(0);

  useEffect(() => {
    if (hasDrawn) return;
    // Two frames, not zero: the element has to be painted in its start state
    // before the class that transitions away from it lands, or the browser
    // coalesces both into one style resolution and nothing animates.
    frame.current = requestAnimationFrame(
      () =>
        (frame.current = requestAnimationFrame(() => {
          hasDrawn = true;
          setDrawn(true);
        }))
    );
    return () => cancelAnimationFrame(frame.current);
  }, []);

  return (
    <svg
      className={`council-ink ${drawn ? "is-drawn" : ""} ${active ? "is-active" : ""} ${
        dim ? "is-dim" : ""
      } ${className}`}
      viewBox="0 0 156 156"
      aria-hidden="true"
      focusable="false"
    >
      {ARCS.map((a, i) => (
        <path
          key={i}
          className={`ink-arc ${a.reply ? "is-reply" : ""}`}
          d={arcPath(i, a.r)}
          fill="none"
          stroke={a.reply ? "var(--primary)" : "var(--ink)"}
          strokeWidth={a.w}
          // Round caps are what make seven arcs read as one continuous ring
          // rather than as seven segments of a dashed circle.
          strokeLinecap="round"
          // Normalised so one dashoffset draws every arc at the same rate
          // whatever its real radius and sweep. See decoration.css.
          pathLength="100"
          style={{ "--arc-opacity": a.o, "--arc-index": i }}
        />
      ))}
    </svg>
  );
});

CouncilInk.displayName = "CouncilInk";

export default CouncilInk;

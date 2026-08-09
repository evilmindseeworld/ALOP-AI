import { memo } from "react";

/**
 * Falling petals across the top of the sign-in page.
 *
 * The bough they used to hang from is gone: it was one of the branches the
 * council ink replaced, and a branch drawn beside seven converging ink strokes
 * read as two unrelated pictures sharing a corner. The petals stayed because
 * they are weather rather than ornament — they say what season the product is
 * in without drawing a second subject.
 *
 * WHY IT IS INLINE SVG AND CSS AND NOTHING ELSE. The same reason recorded in
 * SakuraFrame.jsx, which this follows: the ornament in this app was once a
 * 9.4MB model.glb pulled from unpkg for decoration. The sign-in page was then
 * deliberately cut from 267KB to 167KB gzipped by getting framer-motion and the
 * markdown renderer OFF it — people were downloading an animation library to
 * look at a login form. Adding one back for falling petals would undo that
 * work for the same reason it was done.
 *
 * So: petals that are CSS keyframes on a handful of spans, and nothing else.
 * No JS runs per frame, nothing is measured, nothing is scheduled. It costs
 * about two kilobytes and it renders on a phone with a dead battery.
 *
 * WHY THE PETALS ARE TRANSFORM AND OPACITY ONLY. Those two properties animate
 * on the compositor without touching layout or paint. Animating `top` instead
 * would relayout the page 60 times a second behind a form someone is typing
 * into, which is how decoration turns into a dropped keystroke.
 *
 * REDUCED MOTION IS NOT A DOWNGRADE HERE. Under prefers-reduced-motion the
 * petals do not fade out and they do not freeze mid-fall — both read as broken.
 * They are simply not rendered, and the bough stays. A still branch is a
 * finished picture; a still petal halfway down the screen is a bug.
 *
 * WHERE THEY FALL, AND WHY IT IS NOT THE WHOLE PAGE. The first version ran them
 * down the full viewport, across the sign-in card and the roster. WCAG 2.1 and
 * WebAIM name that specific pattern — moving images beneath static text — as a
 * vestibular trigger, with dizziness and nausea as the reported symptoms rather
 * than mere distraction. `prefers-reduced-motion` is honoured here, but one
 * published dataset puts its adoption at 25-30%, so most people it would help
 * never switch it on. The petals are now confined to the bough's own box; the
 * CSS carries the full reasoning.
 *
 * COUNT. Eight, down from fourteen. Visual complexity is the strongest measured
 * predictor of first-impression appeal and LOW complexity wins — an effect
 * detectable at 17ms of exposure. Fourteen moving objects were working against
 * the one screen where that is measured. Eight in a band still read as weather;
 * they just no longer compete with the form.
 */

/**
 * Fourteen petals. Position, delay, duration and drift are per-petal custom
 * properties so the keyframes can stay a single rule — fourteen copies of the
 * same animation differing only in numbers is fourteen chances for one to be
 * subtly wrong, which is the mistake SakuraFrame.jsx records making with its
 * corner sprigs.
 *
 * The numbers are hand-picked rather than random: `Math.random()` would give a
 * different fall on every render, so a re-render mid-scroll would teleport every
 * petal, and no two screenshots of this page would ever match.
 */
const PETALS = [
  { left: 9, delay: 0, dur: 13, drift: 34, spin: 220, scale: 0.85 },
  { left: 21, delay: 6.2, dur: 16, drift: -26, spin: -180, scale: 0.6 },
  { left: 34, delay: 2.4, dur: 11.5, drift: 44, spin: 300, scale: 0.95 },
  { left: 46, delay: 9.1, dur: 15, drift: -38, spin: 160, scale: 0.7 },
  { left: 58, delay: 3.9, dur: 17, drift: 30, spin: -260, scale: 0.55 },
  { left: 70, delay: 11.4, dur: 12.5, drift: -46, spin: 200, scale: 0.9 },
  { left: 82, delay: 1.6, dur: 14.5, drift: 40, spin: -140, scale: 0.65 },
  { left: 93, delay: 7.7, dur: 16.5, drift: -32, spin: 280, scale: 0.8 },
];

/** One petal: an ellipse with one pointed end, which is what makes it a petal. */
const Petal = ({ p }) => (
  <span
    className="sakura-petal"
    style={{
      "--petal-left": `${p.left}%`,
      "--petal-delay": `${p.delay}s`,
      "--petal-duration": `${p.dur}s`,
      "--petal-drift": `${p.drift}px`,
      "--petal-spin": `${p.spin}deg`,
      "--petal-scale": p.scale,
    }}
  >
    <svg viewBox="0 0 12 14" aria-hidden="true" focusable="false" fill="currentColor">
      <path d="M6 0 C 9.6 3.2, 12 7, 10.4 10.6 C 9.2 13.2, 6.6 14, 6 14 C 5.4 14, 2.8 13.2, 1.6 10.6 C 0 7, 2.4 3.2, 6 0 Z" />
    </svg>
  </span>
);

const SakuraBough = memo(() => (
  <div className="sakura-bough" aria-hidden="true">
    <div className="sakura-petals">
      {PETALS.map((p, i) => (
        <Petal key={i} p={p} />
      ))}
    </div>
  </div>
));

SakuraBough.displayName = "SakuraBough";

export default SakuraBough;

import { memo } from "react";

/**
 * The hanging crescent ornament.
 *
 * Replaces a <model-viewer> that rendered a 9.4MB model.glb — roughly 47x the
 * entire gzipped JS bundle, for pure decoration — and pulled the model-viewer
 * runtime from an unpinned unpkg URL on every page load. This SVG is about a
 * kilobyte, inline, with no third-party runtime and no network dependency.
 *
 * It also removes a custom element from the stacking picture. <model-viewer>
 * manages its own canvas and swallowed drag gestures aimed at the UI behind it,
 * which is why the old markup needed pointer-events:none in two places.
 *
 * aria-hidden: a decorative ornament carries no information, so announcing it
 * to a screen reader is noise.
 *
 * Positioning and stacking live in App.css (.earring-wrap / .earring-left /
 * .earring-right) — deliberately NOT inline, because inline styles silently
 * outrank the stylesheet and that mismatch caused a long run of duelling
 * z-index commits.
 */
const Crescent = memo(({ side }) => {
  // Gradient and mask ids must be unique per instance; two earrings render at
  // once and duplicate ids would make the second reference the first's defs.
  const gid = `crescent-grad-${side}`;
  const mid = `crescent-mask-${side}`;

  return (
    <svg
      className="crescent"
      viewBox="0 0 110 150"
      width="110"
      height="150"
      role="presentation"
      focusable="false"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--primary-soft)" />
          <stop offset="55%" stopColor="var(--primary)" />
          <stop offset="100%" stopColor="var(--secondary)" />
        </linearGradient>

        {/* A crescent is a disc with a second disc bitten out of it. Doing that
            with a mask rather than a two-arc path keeps the geometry honest —
            arc-based crescents silently collapse when the inner radius is too
            small for the chord and SVG scales it back up. */}
        <mask id={mid}>
          <rect width="110" height="150" fill="black" />
          <circle cx="55" cy="88" r="46" fill="white" />
          <circle cx="82" cy="70" r="42" fill="black" />
        </mask>
      </defs>

      {/* The stud the chain terminates in. */}
      <circle cx="55" cy="30" r="4.5" fill={`url(#${gid})`} opacity="0.9" />
      <line x1="55" y1="34" x2="55" y2="44" stroke="var(--primary)" strokeWidth="1.2" opacity="0.5" />

      <g mask={`url(#${mid})`}>
        <rect width="110" height="150" fill={`url(#${gid})`} />
      </g>

      {/* Specular edge — catches the light along the outer rim so the shape
          reads as an object rather than a flat cutout. */}
      <circle
        cx="55"
        cy="88"
        r="46"
        fill="none"
        stroke="var(--primary-soft)"
        strokeWidth="1"
        opacity="0.35"
        mask={`url(#${mid})`}
      />
    </svg>
  );
});

Crescent.displayName = "Crescent";
export default Crescent;

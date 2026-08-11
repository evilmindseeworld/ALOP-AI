import { memo } from "react";

/**
 * The hanging crescent ornament.
 *
 * TWO THINGS WERE WRONG WITH THE PREVIOUS DRAWING, and only one of them was
 * the size.
 *
 * 1. The stud sat at cy=30 inside a 110x150 viewBox, while `.earring-chain` is
 *    a separate 50px div stacked above it. The chain therefore ended 30px
 *    short of the stud and the ornament rendered as a floating dot, a gap, and
 *    a moon — which is what it looks like in every screenshot of the app.
 *    The stud is now at the very top of the box (cy=7), so the chain meets it
 *    exactly, whatever height the chain is given at a breakpoint.
 *
 * 2. It was drawn at 110x150 and rendered at 110x150 — about the size of the
 *    avatar column — so a piece of decoration competed with the transcript.
 *    The intrinsic size is now 96x132 and CSS scales it down per breakpoint;
 *    the viewBox is what keeps that crisp at every size.
 *
 * Replaces a <model-viewer> that rendered a 9.4MB model.glb — roughly 47x the
 * entire gzipped JS bundle, for pure decoration — and pulled the model-viewer
 * runtime from an unpinned unpkg URL on every page load. This SVG is about a
 * kilobyte, inline, with no third-party runtime and no network dependency.
 *
 * aria-hidden: a decorative ornament carries no information, so announcing it
 * to a screen reader is noise.
 *
 * Positioning and stacking live in styles/decoration.css — deliberately NOT
 * inline, because inline styles silently outrank the stylesheet, and that
 * mismatch is what caused a long run of duelling z-index commits.
 */
const Crescent = memo(({ side }) => {
  // Gradient and mask ids must be unique per instance; two earrings render at
  // once and duplicate ids would make the second reference the first's defs.
  const gid = `crescent-grad-${side}`;
  const mid = `crescent-mask-${side}`;
  const rid = `crescent-rim-${side}`;

  return (
    <svg
      className="crescent"
      viewBox="0 0 96 132"
      width="96"
      height="132"
      role="presentation"
      focusable="false"
    >
      <defs>
        <linearGradient id={gid} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor="var(--primary-soft)" />
          <stop offset="55%" stopColor="var(--primary)" />
          <stop offset="100%" stopColor="var(--secondary)" />
        </linearGradient>

        <linearGradient id={rid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary-soft)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.15" />
        </linearGradient>

        {/* A crescent is a disc with a second disc bitten out of it. Doing that
            with a mask rather than a two-arc path keeps the geometry honest —
            arc-based crescents silently collapse when the inner radius is too
            small for the chord and SVG scales it back up. */}
        {/* THE TWO SIDES ARE DIFFERENT PHASES, NOT ONE SHAPE FLIPPED.
            `.earring-right .crescent` used to carry `transform: scaleX(-1)`,
            which made the pair a perfect bilateral mirror — and a mirror is the
            single loudest signal that an ornament was placed by a stylesheet
            rather than drawn. Moving the bite to the other side of the disc AND
            changing its radius and centre gives the right-hand moon a genuinely
            thinner phase, so the two read as the same object at two moments
            rather than as one object and its reflection. */}
        <mask id={mid}>
          <rect width="96" height="132" fill="black" />
          <circle cx="46" cy="84" r="42" fill="white" />
          {side === "right" ? (
            <circle cx="22" cy="72" r="41" fill="black" />
          ) : (
            <circle cx="72" cy="66" r="38" fill="black" />
          )}
        </mask>
      </defs>

      {/* The post the chain terminates in, then the bail the moon hangs from.
          Both live at the top of the box so the chain has something to meet. */}
      <circle cx="48" cy="7" r="4" fill={`url(#${gid})`} />
      <line x1="48" y1="11" x2="48" y2="26" stroke={`url(#${rid})`} strokeWidth="1.4" />
      <circle
        cx="48"
        cy="32"
        r="6"
        fill="none"
        stroke={`url(#${gid})`}
        strokeWidth="1.6"
        opacity="0.75"
      />

      <g mask={`url(#${mid})`}>
        <rect width="96" height="132" fill={`url(#${gid})`} />
      </g>

      {/* Specular edge — catches the light along the outer rim so the shape
          reads as an object rather than a flat cutout. */}
      <circle
        cx="46"
        cy="84"
        r="42"
        fill="none"
        stroke="var(--primary-soft)"
        strokeWidth="1"
        opacity="0.4"
        mask={`url(#${mid})`}
      />
    </svg>
  );
});

Crescent.displayName = "Crescent";
export default Crescent;

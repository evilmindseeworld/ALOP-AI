import { memo } from "react";

/** Hanging crescent fitted to the shared chain and sun geometry. */

const BITE = {
  left: { cx: 57, cy: 86.4, r: 36 },
  right: { cx: 38.6, cy: 87, r: 39 },
};

const Crescent = memo(({ side }) => {
  // Gradient and mask ids must be unique per instance; two earrings render at
  // once and duplicate ids would make the second reference the first's defs.
  const gid = `crescent-grad-${side}`;
  const mid = `crescent-mask-${side}`;
  const bite = BITE[side] ?? BITE.left;

  return (
    <svg
      className="crescent earring-face"
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

        <mask id={mid}>
          <rect width="96" height="132" fill="black" />
          <circle cx="48" cy="84" r="40" fill="white" />
          <circle cx={bite.cx} cy={bite.cy} r={bite.r} fill="black" />
        </mask>
      </defs>

      {/* Flat stroke: a vertical SVG line has a zero-width objectBoundingBox. */}
      <line x1="48" y1="0" x2="48" y2="32" stroke="var(--primary)" strokeWidth="1.8" />
      <circle cx="48" cy="8" r="2.6" fill={`url(#${gid})`} />
      <circle
        cx="48"
        cy="38"
        r="6"
        fill="none"
        stroke={`url(#${gid})`}
        strokeWidth="1.5"
        opacity="0.8"
      />

      <g mask={`url(#${mid})`}>
        <rect width="96" height="132" fill={`url(#${gid})`} />

        {/* A fine stroke along the bite adds a restrained bevel. */}
        <circle
          cx={bite.cx}
          cy={bite.cy}
          r={bite.r}
          fill="none"
          stroke="var(--secondary)"
          strokeWidth="1.6"
          opacity="0.5"
        />
        {/* Fine highlight along the outer rim. */}
        <circle
          cx="48"
          cy="84"
          r="40"
          fill="none"
          stroke="var(--primary-soft)"
          strokeWidth="0.9"
          opacity="0.45"
        />
      </g>
    </svg>
  );
});

Crescent.displayName = "Crescent";
export default Crescent;

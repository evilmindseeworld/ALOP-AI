import { memo } from "react";

/** Light-theme ornament sharing the crescent's fitting and viewBox. */

const RAY_COUNT = 12;
const RAY_RADIUS = 39;
const RAY_LENGTH = 7;

// Circumference split into RAY_COUNT equal slots, each slot part ray part gap.
const CIRCUMFERENCE = 2 * Math.PI * RAY_RADIUS;
const SLOT = CIRCUMFERENCE / RAY_COUNT;

const Sun = memo(({ side }) => {
  // Gradient and mask ids must be unique per instance; two earrings render at
  // once and duplicate ids would make the second reference the first's defs.
  const gid = `sun-grad-${side}`;

  // Half a slot of offset on the right, so the rays are out of phase rather
  // than mirrored. Rotation is about the body's centre, not the viewBox's.
  const rayOffset = side === "right" ? SLOT / 2 : 0;

  return (
    <svg
      className="sun earring-face"
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

      {/* Rays. `pathLength` is not used: the dash array is in user units against
          the real circumference, so changing RAY_RADIUS moves the rays without
          changing their thickness. */}
      <circle
        cx="48"
        cy="84"
        r={RAY_RADIUS}
        fill="none"
        stroke={`url(#${gid})`}
        strokeWidth={RAY_LENGTH}
        strokeDasharray={`3 ${SLOT - 3}`}
        strokeDashoffset={rayOffset}
        strokeLinecap="round"
        opacity="0.85"
      />

      {/* The body. Smaller than the crescent's disc so the rays fit inside the
          same box rather than the ornament growing on theme switch. */}
      <circle cx="48" cy="84" r="27" fill={`url(#${gid})`} />

      {/* Specular edge — same job as the crescent's outer rim: makes the shape
          read as an object rather than a flat cutout. */}
      <circle
        cx="48"
        cy="84"
        r="27"
        fill="none"
        stroke="var(--primary-soft)"
        strokeWidth="1"
        opacity="0.45"
      />
    </svg>
  );
});

Sun.displayName = "Sun";
export default Sun;

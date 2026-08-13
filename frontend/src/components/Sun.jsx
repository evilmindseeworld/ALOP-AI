import { memo } from "react";

/**
 * The hanging sun ornament — the light-theme half of the earring pair.
 *
 * WHY THIS EXISTS. The crescent is a night mark. Hung in the light theme it was
 * the same drawing at half opacity, which is why `.light .earring-wrap` carries
 * an opacity rule at all: the shape did not belong there and was being muted
 * rather than replaced. The owner's instruction (2026-08-13) is that the
 * ornament turns to the sun in light mode and stays a moon in dark.
 *
 * IT IS BUILT TO THE CRESCENT'S GEOMETRY, NOT TO ITS OWN. Same 96x132 viewBox,
 * stud at cy=7 so `.earring-chain` meets it exactly, bail at cy=32, body
 * centred at (46, 84). Anything else and the two ornaments would hang at
 * different heights and the theme switch would look like a layout bug. See
 * Crescent.jsx for why those three numbers are what they are.
 *
 * THE TWO SIDES ARE DIFFERENT, NOT MIRRORED, for the same reason the crescent's
 * two phases are: a perfect bilateral mirror is the loudest signal that an
 * ornament was placed by a stylesheet rather than drawn. Here the difference is
 * the ray phase — the right-hand sun's rays sit half a step round from the
 * left's — so the pair reads as one object seen twice rather than as a
 * reflection.
 *
 * Rays are drawn as a stroked, dashed circle rather than as twelve <line>
 * elements. One element, one dash pattern, and the ray count is a division
 * rather than a hand-authored list that drifts when the radius changes.
 */

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
  const rid = `sun-rim-${side}`;

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

        <linearGradient id={rid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary-soft)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.15" />
        </linearGradient>
      </defs>

      {/* The post the chain terminates in, then the bail the sun hangs from.
          Identical to the crescent's, deliberately — the ornament changes, the
          fitting it hangs from does not. */}
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

      {/* Rays. `pathLength` is not used: the dash array is in user units against
          the real circumference, so changing RAY_RADIUS moves the rays without
          changing their thickness. */}
      <circle
        cx="46"
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
      <circle cx="46" cy="84" r="27" fill={`url(#${gid})`} />

      {/* Specular edge — same job as the crescent's outer rim: makes the shape
          read as an object rather than a flat cutout. */}
      <circle
        cx="46"
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

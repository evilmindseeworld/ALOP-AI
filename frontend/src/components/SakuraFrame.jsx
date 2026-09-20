import { memo } from "react";

/** One five-petal blossom, drawn once and instanced. */
const Blossom = ({ x, y, r = 1, o = 1 }) => (
  <g transform={`translate(${x} ${y}) scale(${r})`} opacity={o}>
    {[0, 72, 144, 216, 288].map((a) => (
      <ellipse key={a} cx="0" cy="-5.2" rx="3.1" ry="4.8" transform={`rotate(${a})`} />
    ))}
    <circle cx="0" cy="0" r="1.4" opacity="0.5" />
  </g>
);

export const Seal = ({ className = "sakura-seal", id = "seal" }) => (
  <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <mask id={`${id}-cut`}>
      <rect width="32" height="32" fill="#fff" />
      <rect x="3.2" y="3.2" width="25.6" height="25.6" rx="1.4" fill="none" stroke="#000" strokeWidth="1.4" />
      <g fill="none" stroke="#000" strokeWidth="2.4" strokeLinecap="round">
        <path d="M9.5 11 C 13 11.4, 15.4 13.6, 16 16.6" />
        <path d="M22.5 11 C 19 11.4, 16.6 13.6, 16 16.6" />
      </g>
      <circle cx="16" cy="21.8" r="2.2" fill="#000" />
    </mask>
    <rect
      width="32"
      height="32"
      rx="3"
      fill="var(--ornament-seal)"
      mask={`url(#${id}-cut)`}
    />
  </svg>
);

export const Keystone = ({ className = "sakura-keystone" }) => (
  <svg
    className={className}
    viewBox="0 0 48 24"
    aria-hidden="true"
    focusable="false"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
  >
    {/* NO VERTICAL STROKE. The first version had one, and with the dot beneath
        it the whole mark read as a downward ARROW — a scroll-to-bottom
        affordance sitting above the composer, which is a control this app
        actually has elsewhere. Ornament that looks clickable is a bug. The two
        arcs alone read as a flourish; the stem read as an instruction. */}
    <path d="M3 7 C 11 7, 18 11, 22.4 15.4" strokeWidth="1.1" opacity="0.5" />
    <path d="M45 7 C 37 7, 30 11, 25.6 15.4" strokeWidth="1.1" opacity="0.5" />
    {/* Blossoms at the outer ends, so the mark is visibly the same hand that
        drew the sprigs either side of it rather than a stray glyph.
        `fill`/`stroke` are set here because this svg is stroke-only: Blossom
        draws filled ellipses and would render invisible inheriting fill="none",
        and would grow a 1.1px outline inheriting the stroke. */}
    <g fill="currentColor" stroke="none">
      <Blossom x={3} y={7} r={0.42} o={0.5} />
      <Blossom x={45} y={7} r={0.42} o={0.5} />
    </g>
    {/* The point the two arcs agree on — the one filled mark, as in the
        rosette's centre. */}
    <circle cx="24" cy="16.6" r="2" fill="currentColor" stroke="none" opacity="0.75" />
  </svg>
);

/** Day village and night city share a 38-unit composer strip. */

export const ComposerSkyline = memo(() => (
  <div className="composer-skyline">

    <svg viewBox="0 0 1040 38" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">

      {/* Shared weather disc; keep the central skyline corridor clear. */}
      <g className="composer-weather">
      <defs>
        <mask id="composer-moon-bite" maskUnits="userSpaceOnUse" x="87" y="2" width="18" height="18">
          <circle cx="96" cy="11" r="9" fill="#fff" />
          <circle cx="99.4" cy="8.8" r="8.2" fill="#000" />
        </mask>
      </defs>
<circle className="composer-sun composer-sun-corona" cx="96" cy="11" r="9" />
      <circle className="composer-sun composer-sun-core" cx="96" cy="11" r="6.4" />
      <circle className="composer-moon" cx="96" cy="11" r="9" mask="url(#composer-moon-bite)" />

      <g className="composer-clouds">
        <rect x="18" y="4.2" width="24" height="3.4" rx="1.7" />
        <rect x="36" y="12.4" width="32" height="4" rx="2" />
        <rect x="54" y="8.2" width="16" height="3.2" rx="1.6" />
        <rect x="68" y="3.4" width="14" height="4" rx="2" />
        <rect x="118" y="4.8" width="26" height="3.6" rx="1.8" />
        <rect x="126" y="12.4" width="34" height="4" rx="2" />
        <rect x="170" y="8.2" width="16" height="3.2" rx="1.6" />
      </g>
      </g>

      <g className="composer-town composer-town-village" transform="translate(0 16)">
        <path d="M0 22 V15 H16 V10 H24 V15 H38 L46 7 L54 15 H68 V5 H80 V15 H100 V17 H136 V12 H150 L158 6 L166 12 H180 V16 H196 V9 H208 V16 H228 L236 8 L244 16 H258 V13 H272 V17 H292 V14 H320 V16 H340 V8 H352 V16 H372 V12 H392 L401 6 L410 12 H430 V17 H452 V11 H470 V15 H486 V17 H520 V13 H536 L546 7 L556 13 H574 V16 H590 V9 H604 V16 H624 V13 H648 V17 H666 V10 H684 V15 H704 L713 8 L722 15 H740 V12 H762 V17 H780 V14 H800 V6 H816 V14 H836 V16 H860 V11 H884 V16 H904 L915 7 L926 16 H944 V13 H962 V17 H984 V10 H1000 V15 H1018 V17 H1040 V22 Z" />

        <path d="M104 9 Q118 4.5 132 9 L128.5 10.6 Q118 7.4 107.5 10.6 Z" />
        <path d="M112 10.6 H124 V13.4 H112 Z" />
        <path d="M101 15.4 Q118 10.6 135 15.4 L131.5 17 Q118 13.4 104.5 17 Z" />
        <path d="M109 17 H127 V22 H109 Z" />
        <path d="M489 9 Q503 4.5 517 9 L513.5 10.6 Q503 7.4 492.5 10.6 Z" />
        <path d="M497 10.6 H509 V13.4 H497 Z" />
        <path d="M486 15.4 Q503 10.6 520 15.4 L516.5 17 Q503 13.4 489.5 17 Z" />
        <path d="M494 17 H512 V22 H494 Z" />
      </g>

      <g className="composer-town composer-town-far" transform="translate(0 16)">
        <path d="M0 22 V14 H24 V18 H50 V12 H72 V17 H100 V15 H132 V18 H168 V16 H196 V8 H216 V14 H238 V5 H258 V13 H282 V9 H304 V16 H330 V6 H352 V12 H378 V15 H402 V7 H424 V14 H450 V10 H474 V16 H500 V4 H522 V13 H548 V9 H572 V15 H600 V11 H636 V6 H658 V14 H682 V8 H706 V16 H730 V5 H752 V12 H778 V15 H802 V9 H826 V14 H850 V7 H874 V13 H900 V10 H924 V16 H948 V6 H972 V14 H998 V11 H1022 V15 H1040 V22 Z" />
      </g>
      {/* Dark profile: Tokyo buildings, a pale back rank, and sparse windows. */}
      <g className="composer-town composer-town-city" transform="translate(0 16)">

        <path d="M0 22 V17 H14 V13 H26 V18 H40 V15 H52 V12 H64 V16 H78 V18 H92 V17 H108 V18 H124 V16 H140 V18 H156 V17 H172 V15 H190 V9 H202 V5 H214 V12 H224 V16 H236 V8 H246 V14 H258 V6 H268 V15 H280 V11 H292 V4 H304 V13 H314 V17 H326 V7 H338 V12 H350 V16 H360 V5 H372 V14 H384 V10 H396 V17 H408 V6 H420 V13 H432 V16 H444 V8 H456 V12 H468 V15 H480 V4 H492 V11 H504 V17 H516 V9 H528 V14 H540 V6 H552 V16 H564 V12 H576 V18 H640 V13 H652 V7 H664 V15 H676 V5 H688 V12 H700 V17 H712 V9 H724 V14 H736 V6 H748 V16 H760 V11 H772 V4 H784 V13 H796 V17 H808 V8 H820 V15 H832 V12 H844 V6 H856 V16 H868 V18 H890 V13 H902 V7 H914 V15 H926 V10 H938 V17 H950 V5 H962 V12 H974 V16 H986 V8 H998 V14 H1010 V11 H1024 V16 H1040 V22 Z" />

        <path d="M603 22 L610 9.5 L612.6 3.5 L613.4 2 H614.6 L615.4 3.5 L618 9.5 L625 22 Z" />
        <path d="M603.5 11 H624.5 V13.4 H603.5 Z" />

        <path d="M869 22 L874 10 L875.4 3 L875.8 1.5 H876.4 L876.8 3 L878 10 L883 22 Z" />
        <path d="M869.5 11.6 H882.5 V13.6 H869.5 Z" />

        <path d="M294 2 H300 V4 H294 Z" />
        <path d="M482 2 H488 V4 H482 Z" />
        <path d="M774 2 H780 V4 H774 Z" />
        <path d="M952 3 H958 V5 H952 Z" />
      </g>

      <g className="composer-windows" transform="translate(0 16)">
        <rect x="206" y="8" width="2" height="2" />
        <rect x="296" y="7" width="2" height="2" />
        <rect x="484" y="8" width="2" height="2" />
        <rect x="678" y="9" width="2" height="2" />
        <rect x="776" y="7" width="2" height="2" />
        <rect x="954" y="9" width="2" height="2" />
      </g>
    </svg>
  </div>
));

ComposerSkyline.displayName = "ComposerSkyline";

export const ComposerSprigs = memo(() => (
  <div className="composer-sprigs" aria-hidden="true">
    <ComposerSkyline />
    <Seal className="sakura-seal composer-seal" id="composer-seal" />
  </div>
));

ComposerSprigs.displayName = "ComposerSprigs";

/** Keystone that anchors the composer ornament. */

export const SakuraBaseCorners = memo(() => (
  <div className="sakura-base" aria-hidden="true">
    <Keystone />
  </div>
));

SakuraBaseCorners.displayName = "SakuraBaseCorners";

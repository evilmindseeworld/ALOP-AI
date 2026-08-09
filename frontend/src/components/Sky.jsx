import { memo } from "react";

/**
 * The sky behind the empty state.
 *
 * ONE ORNAMENT, AND THE THEME DECIDES WHAT IS IN IT. The two themes are called
 * Sakura Night and Bamboo Day, and until now that was a name and a palette and
 * nothing else: the same decoration hung in both. A moon in a room called Day
 * is a palette swap. A moon that becomes a sun is a place.
 *
 * That is the whole idea, and it is why this is not a fourth decoration bolted
 * beside the others. It replaces all of them: two hanging crescents, a wooden
 * bough, a torii silhouette and an ensō, which between them said "Japanese
 * night" four times and never once responded to anything the product did.
 *
 * BOTH BODIES ARE ALWAYS IN THE MARKUP and the stylesheet chooses. Rendering
 * the right one from a `darkMode` prop would mean this component needed to know
 * the theme, which means threading it from App through MessageList for a
 * picture; and it would flash the wrong body for a frame on first paint,
 * because the theme class lands on .app-root before React has re-rendered a
 * child that reads it. CSS has the answer already and cannot be late.
 *
 * EVERYTHING IS A GRADIENT OR A MASKED CIRCLE. No image request, no runtime, no
 * canvas. The ornament in this app was once a 9.4MB model.glb pulled from unpkg
 * for decoration, and the rule since then is that atmosphere costs kilobytes.
 */

/**
 * The stars.
 *
 * Hand-placed, not random: Math.random() would give a different sky on every
 * render, so a re-render mid-conversation would teleport every star and no two
 * screenshots would ever match. Positions are percentages of the sky box.
 *
 * They cluster loosely toward the upper right, away from the reading column,
 * and thin out as they approach the moon: a real sky has fewer visible stars
 * near a bright body, and copying that is what stops this reading as confetti.
 * The four faintest exist to break the rhythm of the bright ones.
 */
const STARS = [
  { x: 12, y: 18, r: 1.6, o: 0.85, twinkle: 0 },
  { x: 26, y: 8, r: 1.1, o: 0.6, twinkle: 2.6 },
  { x: 41, y: 22, r: 1.9, o: 1, twinkle: 1.2 },
  { x: 18, y: 42, r: 1.2, o: 0.66, twinkle: 3.4 },
  { x: 8, y: 62, r: 1.5, o: 0.8, twinkle: 1.9 },
  { x: 33, y: 55, r: 0.9, o: 0.5, twinkle: 4.1 },
  { x: 55, y: 12, r: 1.3, o: 0.72, twinkle: 0.7 },
  { x: 68, y: 34, r: 1, o: 0.52, twinkle: 3 },
  { x: 22, y: 78, r: 1.1, o: 0.58, twinkle: 2.2 },
  { x: 47, y: 71, r: 0.8, o: 0.7, twinkle: 4.6 },
  { x: 60, y: 58, r: 1.4, o: 0.44, twinkle: 1.5 },
  { x: 5, y: 32, r: 0.9, o: 0.48, twinkle: 3.8 },
];

const Sky = memo(() => (
  <div className="sky" aria-hidden="true">
    {/* The light the body casts, as its own layer. A glow drawn as a shadow on
        the disc is clipped by the disc's own box at large radii; a sibling
        behind it is not, so the falloff can be as wide as it needs to be. */}
    <div className="sky-halo" />

    {/* NIGHT. The crescent is one circle with another subtracted from it, which
        is what a crescent physically is. Drawing it as a filled path instead
        means hand-fitting two arcs whose curvature has to agree, and they never
        quite do at every size. */}
    <svg className="sky-moon" viewBox="0 0 200 200" focusable="false">
      <defs>
        <mask id="sky-crescent">
          <rect width="200" height="200" fill="#000" />
          <circle cx="100" cy="100" r="72" fill="#fff" />
          {/* Offset up and right, so the horns point down-left toward the
              reading column and the moon leans away from the text.

              CLOSER THAN IT LOOKS IT SHOULD BE. The subtracted circle nearly
              covers the lit one: at cx=139 the crescent came out as a fat
              banana, which is what a waxing moon looks like three days before
              it is interesting. Real crescents are thin. */}
          <circle cx="128" cy="66" r="68" fill="#000" />
        </mask>
        <radialGradient id="sky-moon-fill" cx="34%" cy="66%" r="78%">
          <stop offset="0%" stopColor="var(--moon-lit)" />
          <stop offset="100%" stopColor="var(--moon-dim)" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="72" fill="url(#sky-moon-fill)" mask="url(#sky-crescent)" />
    </svg>

    <div className="sky-stars">
      {STARS.map((s) => (
        <span
          key={`${s.x}-${s.y}`}
          className="sky-star"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: `${s.r * 2}px`,
            height: `${s.r * 2}px`,
            "--star-opacity": s.o,
            "--star-delay": `${s.twinkle}s`,
          }}
        />
      ))}
    </div>

    {/* DAY. A plain disc: the sun has no features to draw, and every attempt to
        give it rays turns it into a weather icon. The corona is the halo layer
        above, which is warm rather than cool under the light theme. */}
    <svg className="sky-sun" viewBox="0 0 200 200" focusable="false">
      <defs>
        {/* THE RIM FADES TO NOTHING, and that is the whole difference between
            a sun and an orange circle. A disc with a hard edge reads as a UI
            element sitting on the page; light has no edge. The last stop is
            fully transparent so the body dissolves into the paper instead of
            being stamped onto it. */}
        {/* r="50%", AND THE NUMBER IS THE WHOLE FIX. A radial gradient's radius
            is a fraction of the element's BOUNDING BOX, not of the shape. At
            76% the 100% stop landed a third of the way outside the circle, so
            the transparent end was clipped away and the sun rendered as a
            solid peach ball with a hard edge. 50% puts the last stop exactly on
            the circle's rim, which is the only value at which the disc can
            dissolve into the paper instead of being stamped onto it. */}
        <radialGradient id="sky-sun-fill" cx="40%" cy="36%" r="50%">
          <stop offset="0%" stopColor="var(--sun-core)" />
          <stop offset="42%" stopColor="var(--sun-edge)" />
          <stop offset="74%" stopColor="var(--sun-rim)" />
          <stop offset="100%" stopColor="var(--sun-rim)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="78" fill="url(#sky-sun-fill)" />
    </svg>
  </div>
));

Sky.displayName = "Sky";

export default Sky;

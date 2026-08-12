# Sol's design proposal: council weather, not a louder wallpaper

## 1. What I actually looked at

I read `AGENTS.md`, `handoff.md`, the load-bearing `ComposerSkyline` comment in
`SakuraFrame.jsx`, the skyline rules in `composer.css`, the lattice rule in
`decoration.css`, and both ornament alpha ladders in `tokens.css`.

I inspected the live `gallery.html`, not only the source. I took in-memory
screenshots of the dark empty state and the light populated transcript at a
1440 x 900 browser window, then both again at an emulated 320 x 900 viewport.
The connector would only save files inside the repo, so I did not save the
screenshots: obeying the one-file rule mattered more than leaving disposable
captures behind.

This machine is not at 1x. Windows reports `AppliedDPI = 120`, or 125% display
scale; Chrome reports `devicePixelRatio = 1.25`. The physical screen is
1536 x 960. At desktop the gallery's composer skyline rendered 848.4 x 44 CSS
pixels. At 320px the gallery fixture left a 254 x 44px composer strip after its
own outer padding.

I also ran two browser-only A/B probes in both themes, removed afterward:

- Doubling the lattice colour mixes from 8%/6% to 16%/12% while retaining a
  1px band made the lattice darker, but it remained a thin, soft smear.
- Retaining 8%/6% and widening the band from 1px to 1.6px made it visibly
  crisper at 125%. The period and the stroke then both land on whole device
  pixels: 28 x 1.25 = 35, 48 x 1.25 = 60, and 1.6 x 1.25 = 2.

## 2. Diagnosis

### 1. "the sun set it to the lets say middle left and with clouds"

I read this as “put the sun in the middle of the left half of the **visible
composer** and let the kasumi read as a cloud field around it,” not “set a
fraction of the 1040-unit drawing.” The distinction matters because most of
that drawing is clipped.

`cx=96` is already a sound middle-left position at 320px, where it renders
about 111px from the strip's left edge. At desktop it renders about 111px into
an 848px strip and reads hard-left. A single new fixed coordinate would fix one
viewport by harming the other. The weather needs a bounded responsive shift,
while the town remains left-aligned and clipped exactly as it is.

This touches the owner-specified composer sun and clouds. The owner's quoted
request names both, so it authorizes that touch. It does not authorize moving
the centred hero or changing the starter grid, and I do neither.

### 2. "make it so that the design is more visible"

I read “the design” narrowly as the skyline weather being discussed in the
same breath. The town is already an opaque silhouette and the sun is already
full-opacity seal red; turning either up is impossible or wrong. The weak part
is the cloud group at `--ornament-a-faint`: 0.15 dark and 0.22 light. In both
desktop screenshots the bars are present but require hunting.

The correct existing rung is `--ornament-a-mid`: 0.26 dark and 0.38 light. No
token values need to change. This makes the clouds legible without globally
raising every crescent, rule, rosette and keystone. Again, this touches only the
owner-named clouds, under the owner's explicit request.

### 3. Thin background lines in white and black modes

The primary defect on this machine is subpixel rasterization, not insufficient
alpha. A 1 CSS px band is 1.25 device pixels. The angled gradients distribute
that fractional coverage over neighbouring rows, so the line reads thinner and
fainter. The alpha-only probe made the distributed coverage stronger, not
sharper; the width-only probe fixed the perceived weight.

Evidence that would falsify this diagnosis is simple: at a true DPR 1 browser,
if the 1px line remains geometrically crisp but merely too pale, alpha is the
remaining variable. The implementation should therefore be checked at DPR 1,
1.25 and 1.5, not judged from one screenshot.

The lattice is an owner-specified part of the surface, and item 3 explicitly
asks to repair it. The clear centre mask and the under-640px removal stay; the
request does not license putting pattern behind prose or onto the phone layout.

## 3. The proposal

### Put the weather in the middle-left without losing it on phones

Wrap the existing sun circle and cloud group in
`<g className="composer-weather">`. Keep the circle at `cx="96" cy="11" r="9"`
and add this to `composer.css`:

```css
.composer-weather {
  transform: translateX(clamp(0px, calc(20vw - 96px), 74px));
}
```

There is no transition on this group. At 320px the shift is 0 and the effective
sun centre remains 96. At 640px it is 32. At 850px and above it caps at 74, so
the effective desktop centre is 170. The sun's own focus transform remains a
separate vertical transform on `.composer-sun` and reduced motion remains
unchanged.

At the desktop endpoint, keep `cy=11` and `r=9`. The crown is still at y=2; the
2px focus lift is 1.73 SVG units, leaving 0.27 units before the clip. The sun
bottom remains y=20. Over the town at effective x=170, the nearest roof is at
y=28, giving 8 units of open sky. The first pagoda ends at x=136, 34 units from
the sun centre. These numbers should replace the old fixed-x measurements in
the load-bearing comment.

Use these seven local cloud bars inside the moving group:

```jsx
<rect x="18"  y="4.2"  width="24" height="3.4" rx="1.7" />
<rect x="36"  y="12.4" width="32" height="4"   rx="2" />
<rect x="54"  y="8.2"  width="16" height="3.2" rx="1.6" />
<rect x="68"  y="3.4"  width="14" height="4"   rx="2" />
<rect x="118" y="4.8"  width="26" height="3.6" rx="1.8" />
<rect x="126" y="12.4" width="34" height="4"   rx="2" />
<rect x="170" y="8.2"  width="16" height="3.2" rx="1.6" />
```

The nearest cloud corner is at local (82, 7.4): 14.46 units from the sun centre,
or 5.46 units clear of its radius. No bar crosses the disc. Change only:

```css
.composer-clouds { opacity: var(--ornament-a-mid); }
```

Do not change the token ladder: dark remains 0.40/0.26/0.15 and light remains
0.55/0.38/0.22.

### Make the lattice land on device pixels

In `.chat-main::after`, introduce local `--lattice-line: 1px`. Replace the hard
27px and 47px starts with `calc(28px - var(--lattice-line))` and
`calc(48px - var(--lattice-line))`; keep the final stops and therefore the
28px/48px periods unchanged. Keep the current 8% diagonal and 6% horizontal
colour mixes unchanged.

Add resolution-specific geometry:

```css
@media (min-resolution: 1.20dppx) and (max-resolution: 1.30dppx) {
  .chat-main::after { --lattice-line: 1.6px; }
}
@media (min-resolution: 1.45dppx) and (max-resolution: 1.55dppx) {
  .chat-main::after { --lattice-line: 1.333px; }
}
@media (min-resolution: 1.70dppx) and (max-resolution: 1.80dppx) {
  .chat-main::after { --lattice-line: 1.143px; }
}
```

Those values produce two device pixels at common Windows 125%, 150% and 175%
scales. DPR 1 keeps a crisp 1-device-pixel line; DPR 2 naturally turns that
same 1 CSS px into two device pixels. This changes geometry, not the palette or
the ornament alpha ladder.

## 4. My one surprise: seven seats in the weather

The cloud field should contain seven bars, not the current five: one for each
council seat. They do not label themselves or become a diagram; they simply
give the kasumi an ALOP-specific reason to have exactly this cadence. Four bars
approach from the left, three answer from the right, and the sun is the one
resolved mark between them. It is the product's “seven answers, one reply” idea
hidden in weather rather than printed as UI.

This surprise touches the clouds the owner explicitly asked to revisit, and
the owner's “surprise me” request covers adding the two bars. Cost: two SVG
rectangles, no dependency, no layout shift, no animation, 0px composer height
and 0px transcript space. Its still state is the entire idea.

## 5. What I would NOT do

I would not raise `--ornament-a-*` globally. It would brighten unrelated owner-
approved ornaments and would not solve the lattice's fractional-pixel edge.

I would not change the lattice to 16%/12%, add pseudo-element opacity, blur it,
or add glow. The A/B made the problem louder without making it crisp.

I would not raise the sun, enlarge it, or buy more sky. `cy=11`, `r=9` and the
44px strip already sit at the focus-lift clip limit. More sky means more bottom
padding and less transcript, with no need demonstrated here.

I would not draw soft cloud masses, gradients or illustration. Flat banded
kasumi is the correct hand for the existing silhouette.

I would not use a fixed `cx=170`: it looks right on desktop and pushes the disc
toward the phone strip's right edge. The bounded group shift solves both.

I would not restore the lattice below 640px, move it under prose, change the
centred hero, change the 2x2 starter grid, redraw branches or reintroduce a
torii. None of those is named by this request, and “surprise me” is not a
license to smuggle in a rejected redesign.

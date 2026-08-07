/**
 * Renders public/og.svg to public/og.png at 1200x630, the social card.
 *
 * This exists as a file rather than a `node -e` line for one reason: the card
 * carries the logo mark, and resvg does not fetch relative image hrefs. The
 * mark has to be read off disk and inlined as a data URI before the SVG is
 * handed over. Doing that on a command line means escaping base64 through two
 * shells, which is how the previous one-liner broke.
 *
 * The href in og.svg is left EMPTY on purpose. An empty href renders as
 * nothing rather than as a broken-image box, so the file stays viewable in a
 * browser, and there is no 46 KB of base64 committed into a file a human is
 * expected to read and edit.
 *
 *   npm i --no-save @resvg/resvg-js pngjs
 *   node scripts/render-og.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { PNG } from "pngjs";

/**
 * logo.png is 721x720 and almost all of it is invisible. The chip body and the
 * brain behind it are drawn at #000 on a #040404 field, so against any dark
 * surface - the card, the app, the sign-in header - the only thing that
 * actually reads is the penguin, which occupies x 260..410, y 218..487.
 *
 * Dropped whole into a 56px box that penguin is four pixels wide and looks
 * like dirt. So the mark is cropped to it here, with a small even margin, and
 * placed at a size where the bird is recognisable. Measured, not eyeballed:
 * the numbers below are the bounding box of every pixel brighter than #12.
 */
const CROP = { x: 244, y: 202, w: 182, h: 301 };

function croppedMark() {
  const full = PNG.sync.read(readFileSync("public/logo.png"));
  const out = new PNG({ width: CROP.w, height: CROP.h });
  PNG.bitblt(full, out, CROP.x, CROP.y, CROP.w, CROP.h, 0, 0);

  // logo.png has an OPAQUE #040404 field, which is darker than the card's
  // #0a0a0a. Pasted as-is the crop shows up as a faintly darker rectangle
  // around the bird - the exact "someone slapped a logo on it" look this card
  // was made to avoid. Keying the field out lets the penguin sit on the card's
  // own background, which is what the mark looks like everywhere else.
  for (let i = 0; i < out.data.length; i += 4) {
    const max = Math.max(out.data[i], out.data[i + 1], out.data[i + 2]);
    if (max <= 18) out.data[i + 3] = 0;
  }
  return PNG.sync.write(out).toString("base64");
}

// Rendered at 2x and box-filtered down. resvg's own downscale of a 182px mark
// into a 46px slot stairsteps the bird's outline badly; averaging four samples
// per pixel costs one extra second and fixes it, and the type gets cleaner
// edges for free.
const SCALE = 2;

function downsample(png, factor) {
  const w = Math.round(png.width / factor);
  const h = Math.round(png.height / factor);
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0, 0];
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const s = ((y * factor + dy) * png.width + (x * factor + dx)) << 2;
          for (let c = 0; c < 4; c++) acc[c] += png.data[s + c];
        }
      }
      const d = (y * w + x) << 2;
      for (let c = 0; c < 4; c++) out.data[d + c] = Math.round(acc[c] / (factor * factor));
    }
  }
  return out;
}

const svg = readFileSync("public/og.svg", "utf8");
const dataUri = `data:image/png;base64,${croppedMark()}`;

// Both spellings: resvg reads xlink:href, browsers prefer href, and og.svg
// carries the pair so it previews correctly either way.
const withMark = svg
  .replace('href="" xlink:href=""', `href="${dataUri}" xlink:href="${dataUri}"`);

if (withMark === svg) {
  throw new Error("og.svg no longer has the empty mark href this script fills in");
}

const big = new Resvg(withMark, {
  fitTo: { mode: "width", value: 1200 * SCALE },
  font: { loadSystemFonts: true },
}).render().asPng();

const png = PNG.sync.write(downsample(PNG.sync.read(big), SCALE));

writeFileSync("public/og.png", png);

/**
 * And the tab icon, from the same crop.
 *
 * public/favicon.svg was a PURPLE LIGHTNING BOLT — no relation to this
 * product's mark, and purple is a colour this design system does not contain.
 * It was declared as the icon, so every tab showed someone else's logo.
 *
 * logo.png cannot be used directly either: it is an opaque #040404 square, so
 * as a favicon it is a black tile with a four-pixel smudge in the middle. The
 * keyed crop above is the mark that actually reads at 16px.
 */
/**
 * The mark on its tile, at whatever size the consumer needs.
 *
 * On a DARK TILE, not transparent. The penguin is white line-art: dropped on
 * a light browser tab, or on Google's white result row, it disappears
 * entirely. The tile is the same shape logo.png already is, so the icon, the
 * sign-in header and the search result agree.
 */
function markTile(size) {
  const pad = Math.round(size / 8);
  const w = Math.round((size - 2 * pad) * (CROP.w / CROP.h));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${Math.round(size / 4.9)}" fill="#0a0a0a"/>
  <image x="${Math.round((size - w) / 2)}" y="${pad}" width="${w}" height="${size - 2 * pad}" href="${dataUri}"/>
</svg>`;
  const raw = new Resvg(svg, { fitTo: { mode: "width", value: size * SCALE } }).render().asPng();
  return PNG.sync.write(downsample(PNG.sync.read(raw), SCALE));
}

/* 144, NOT 128, and the number is a requirement rather than a preference.
 *
 * Google only considers a favicon for a search result if it is a square whose
 * side is a MULTIPLE OF 48 — 48, 96, 144, and so on. This shipped at 128,
 * which is not one, so the result row fell back to the generic globe and the
 * site read as nobody's. 144 is the smallest multiple that still looks right
 * on a 2x tab strip. */
const ICON = 144;
writeFileSync("public/favicon.png", markTile(ICON));
console.log(`favicon.png: ${ICON}x${ICON}`);

/* The logo Google is told about in JSON-LD, and it cannot be logo.png.
 *
 * That file is a 721x720 square drawn at #000 on a #040404 field — to a
 * crawler compositing it on white it is a black rectangle with a bird
 * somewhere inside. Organization.logo is what can appear beside a brand
 * result, so it gets the same keyed mark on the same tile as everything
 * else. 512 because Google wants the longest side at 112px or more and
 * resamples down; a source with room to spare survives that better. */
const LOGO = 512;
writeFileSync("public/logo-mark.png", markTile(LOGO));
console.log(`logo-mark.png: ${LOGO}x${LOGO}`);
console.log(`og.png: ${png.readUInt32BE(16)}x${png.readUInt32BE(20)}, ${(png.length / 1024).toFixed(0)} KB`);

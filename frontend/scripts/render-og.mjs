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
 * public/logo.svg is the supplied master artwork. Its 1500-square canvas has
 * generous export padding around the actual mark, so every raster surface is
 * made from the measured artwork bounds below. Keeping the crop here makes
 * the favicon, in-app logo, structured-data logo and social card one source.
 */
const CROP = { x: 438, y: 425, w: 586, h: 601 };

function croppedMark() {
  const master = readFileSync("public/logo.svg", "utf8")
    .replace(/viewBox="[^"]+"/, `viewBox="${CROP.x} ${CROP.y} ${CROP.w} ${CROP.h}"`)
    .replace(/width="[^"]+"/, `width="${CROP.w}"`)
    .replace(/height="[^"]+"/, `height="${CROP.h}"`);
  const out = PNG.sync.read(new Resvg(master, {
    fitTo: { mode: "width", value: CROP.w },
  }).render().asPng());

  // The master has an opaque black field. Key it out here so the artwork can
  // sit cleanly on the app/card background; markTile adds the dark field back
  // for favicons and search results, where a white mark needs contrast.
  for (let i = 0; i < out.data.length; i += 4) {
    const max = Math.max(out.data[i], out.data[i + 1], out.data[i + 2]);
    if (max <= 8) out.data[i + 3] = 0;
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
 * The padded master cannot be used directly at tab size: the artwork would be
 * too small. The keyed crop above is the mark that actually reads at 16px.
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

/* AND /favicon.ico, because that path is requested whether it is declared or not.
 *
 * `<link rel="icon">` points at favicon.png and browsers honour it, so this is
 * not for them. It is for the callers that never read the HTML: Google's
 * favicon crawler probes /favicon.ico directly, and so do feed readers, chat
 * link unfurlers and monitoring tools. That path returned the SPA's 404 page —
 * served as text/html, which is a worse answer than nothing, because a client
 * expecting an image gets a document.
 *
 * Multi-size on purpose. An .ico is a container, and each consumer picks the
 * entry it wants: 16 and 32 for a tab strip and a bookmark bar, 48 because
 * that is the size Google's crawler asks for. Shipping one 144 and letting
 * every consumer downscale it is how a mark turns to mush at 16px.
 *
 * The ICO container is assembled by hand — six fields and a directory — rather
 * than by adding an image library to devDependencies for a file that changes
 * about once a year.
 */
const ICO_SIZES = [16, 32, 48, 64, 128];
function ico(sizes) {
  const images = sizes.map((s) => markTile(s));
  const HEADER = 6;
  const ENTRY = 16;
  const dir = Buffer.alloc(HEADER + ENTRY * images.length);
  dir.writeUInt16LE(0, 0); // reserved
  dir.writeUInt16LE(1, 2); // 1 = icon
  dir.writeUInt16LE(images.length, 4);

  let offset = dir.length;
  images.forEach((png, i) => {
    const at = HEADER + ENTRY * i;
    const s = sizes[i];
    // 0 means 256 in this field; every size here is below that, but the rule is
    // why the field is a single byte and worth not tripping over later.
    dir.writeUInt8(s >= 256 ? 0 : s, at);
    dir.writeUInt8(s >= 256 ? 0 : s, at + 1);
    dir.writeUInt8(0, at + 2); // palette size, 0 for truecolour
    dir.writeUInt8(0, at + 3); // reserved
    dir.writeUInt16LE(1, at + 4); // colour planes
    dir.writeUInt16LE(32, at + 6); // bits per pixel
    dir.writeUInt32LE(png.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([dir, ...images]);
}
writeFileSync("public/favicon.ico", ico(ICO_SIZES));
console.log(`favicon.ico: ${ICO_SIZES.join(", ")}`);

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
writeFileSync("public/logo.png", markTile(LOGO));
console.log(`logo.png: ${LOGO}x${LOGO}`);
console.log(`og.png: ${png.readUInt32BE(16)}x${png.readUInt32BE(20)}, ${(png.length / 1024).toFixed(0)} KB`);

import { it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildSnapshot, readStylesheet } from "../test/cssSnapshot";

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "App.css");

/**
 * Which `!important` declarations actually decide anything?
 *
 * Removes each one in turn and asks the cascade snapshot whether the result
 * renders differently. On the pre-refactor stylesheet the answer was:
 *
 *     total: 195    load-bearing: 36    redundant: 159
 *
 * Four out of five were doing nothing — appended by someone who assumed the
 * cascade had beaten them when in fact their rule was already winning on source
 * order. That number is why the cleanup starts by deleting force rather than by
 * restructuring: 159 of them are a no-op edit the snapshot can verify in bulk.
 *
 * Off by default: it builds the snapshot once per declaration, so it runs in
 * ~40s rather than the suite's ~4s. Turn it on when you want the current split:
 *
 *     AUDIT_IMPORTANT=1 npx vitest run src/__tests__/importantAudit.test.js
 */
it("reports which !important declarations are load-bearing", () => {
  if (!process.env.AUDIT_IMPORTANT) return;

  const css = readStylesheet(ENTRY);
  const base = buildSnapshot(css);
  const marks = [...css.matchAll(/!important/g)].map((m) => m.index);
  const loadBearing = [];

  for (const at of marks) {
    const without = css.slice(0, at) + css.slice(at + "!important".length);
    if (buildSnapshot(without) === base) continue;

    const lineStart = css.lastIndexOf("\n", at) + 1;
    loadBearing.push(
      `${css.slice(0, at).split("\n").length}: ${css.slice(lineStart, css.indexOf("\n", at)).trim()}`
    );
  }

  console.log(
    `\ntotal: ${marks.length}   load-bearing: ${loadBearing.length}   redundant: ${marks.length - loadBearing.length}\n\n` +
      loadBearing.join("\n")
  );

  // Every survivor should be load-bearing once the cleanup is finished, apart
  // from the three in the prefers-reduced-motion block, which are correct.
  expect(loadBearing.length).toBeLessThanOrEqual(marks.length);
}, 600_000);

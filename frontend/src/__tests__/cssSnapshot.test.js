import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildSnapshot, readStylesheet } from "../test/cssSnapshot";

const here = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(here, "..", "App.css");
const BASELINE = join(here, "__snapshots__", "cascade.baseline.txt");

/**
 * The guard for the !important refactor.
 *
 * The baseline was captured from App.css exactly as it stood on `main`, before
 * a single declaration moved. Every commit that folds an override block into
 * the rule it overrides must leave this file byte-identical, because folding
 * changes how the stylesheet is written and must not change what it renders.
 *
 * To regenerate deliberately — which during phase 1 means you have decided a
 * rendering change is intended, and should be saying so in the commit message:
 *
 *     UPDATE_CASCADE_BASELINE=1 npx vitest run src/__tests__/cssSnapshot.test.js
 */
describe("App.css cascade", () => {
  it("resolves to the committed baseline", () => {
    const actual = buildSnapshot(readStylesheet(ENTRY));

    if (process.env.UPDATE_CASCADE_BASELINE === "1") {
      writeFileSync(BASELINE, actual);
      return;
    }

    expect(existsSync(BASELINE), `no baseline at ${BASELINE} — generate it with UPDATE_CASCADE_BASELINE=1`).toBe(true);

    const expected = readFileSync(BASELINE, "utf8");
    if (actual === expected) return;

    const a = actual.split("\n");
    const b = expected.split("\n");
    const at = a.findIndex((line, i) => line !== b[i]);
    const context = (lines, i) => lines.slice(Math.max(0, i - 4), i + 5).join("\n");

    throw new Error(
      "The resolved cascade changed.\n\n" +
        "Phase 1 must not change rendering. Do NOT regenerate the baseline to make this pass —\n" +
        "the fold is wrong, or a declaration that used to win no longer does.\n\n" +
        `First difference at line ${at + 1}:\n\n` +
        `--- baseline ---\n${context(b, at)}\n\n` +
        `--- current ---\n${context(a, at)}\n`
    );
  });
});

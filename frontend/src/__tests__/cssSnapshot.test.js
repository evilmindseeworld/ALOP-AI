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
 * The baseline captures the resolved App.css cascade. Mechanical refactors
 * must leave it byte-identical; an intentional visual change must regenerate
 * it in the same review so the new rendering remains explicit.
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
        "An unrecorded cascade change is not acceptable. Do NOT regenerate the baseline to hide it —\n" +
        "the refactor is wrong, or an intentional rendering change lacks a reviewed baseline update.\n\n" +
        `First difference at line ${at + 1}:\n\n` +
        `--- baseline ---\n${context(b, at)}\n\n` +
        `--- current ---\n${context(a, at)}\n`
    );
  });
});

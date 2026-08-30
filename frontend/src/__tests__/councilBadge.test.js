import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { COUNCIL, FREE_COUNT } from "../constants/council";

const here = dirname(fileURLToPath(import.meta.url));

/* The header badge read "4 models" on free while the roster had three free
 * seats. It was a typed number, so nothing failed when the roster changed —
 * the only signal was a user reading the header.
 *
 * Asserting on source text rather than a render because App.jsx needs Clerk, a
 * router and a live billing hook to mount, and the defect being guarded is
 * literally "someone typed a digit". Proximity, not exact escaping: this must
 * survive the line being reflowed. */
describe("council badge", () => {
  const source = readFileSync(join(here, "..", "App.jsx"), "utf8");

  it("counts seats from the roster instead of hardcoding a number", () => {
    expect(source).toMatch(/COUNCIL\.length\} models/);
    expect(source).toMatch(/FREE_COUNT\} models/);
  });

  it("has no hardcoded seat count anywhere in the header", () => {
    expect(source).not.toMatch(/["'`]\d+ models/);
  });

  it("roster still splits into the two counts the badge shows", () => {
    expect(FREE_COUNT).toBe(COUNCIL.filter((m) => m.free).length);
    expect(FREE_COUNT).toBeLessThan(COUNCIL.length);
  });

  it("advertises the current five-seat council and its two free seats", () => {
    expect(COUNCIL).toHaveLength(5);
    expect(FREE_COUNT).toBe(2);
    expect(COUNCIL.filter((m) => !m.free)).toHaveLength(3);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "..", "styles", "chat.css"), "utf8");

const ruleBody = (selector) => {
  const match = css.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`));
  expect(match, `${selector} rule must exist`).toBeTruthy();
  return match[1];
};

describe("answer skeleton layout", () => {
  it("stretches the skeleton so percentage bars have a definite containing width", () => {
    const body = ruleBody(".answer-skeleton");

    expect(body).toMatch(/(?:^|[;\n])\s*align-self\s*:\s*stretch\s*;/);
  });
});

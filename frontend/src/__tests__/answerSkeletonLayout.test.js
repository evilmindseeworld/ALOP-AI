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

  it("reserves a stable process footprint and wraps truthful stage copy", () => {
    const process = ruleBody(".council-process");
    const stage = ruleBody(".council-stage-text");

    expect(process).toMatch(/(?:^|[;\n])\s*height\s*:\s*124px\s*;/);
    expect(process).toMatch(/(?:^|[;\n])\s*overflow\s*:\s*visible\s*;/);
    expect(css).toMatch(/\.council-process\.is-terminal\s*\{[^}]*height\s*:\s*auto\s*;/s);
    expect(stage).toMatch(/overflow-wrap\s*:\s*anywhere/);
    expect(stage).toMatch(/white-space\s*:\s*normal/);
    expect(stage).not.toMatch(/text-overflow\s*:\s*ellipsis/);
    expect(stage).not.toMatch(/white-space\s*:\s*nowrap/);
  });
});

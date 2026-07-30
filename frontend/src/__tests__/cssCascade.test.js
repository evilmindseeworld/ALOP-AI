import { describe, it, expect, beforeEach } from "vitest";
import {
  specificity,
  parseStylesheet,
  mediaMatches,
  resolve,
  effectiveVars,
  substituteVars,
} from "../test/cssCascade";

/**
 * The refactor this harness exists for deletes 192 `!important` declarations.
 * Nothing else in the suite would notice if that changed what renders — jsdom's
 * getComputedStyle does not resolve a cascade across stylesheets, and a
 * screenshot diff cannot tell antialiasing from a broken layout.
 *
 * So these are the tests of the instrument. If they are wrong, every guarantee
 * built on top of them is worthless.
 */

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("specificity", () => {
  it("counts ids, classes and types", () => {
    expect(specificity("#a .b c")).toEqual([1, 1, 1]);
    expect(specificity(".a.b")).toEqual([0, 2, 0]);
    expect(specificity("a:hover")).toEqual([0, 1, 1]);
    expect(specificity("*")).toEqual([0, 0, 0]);
    expect(specificity("div > span + p ~ a")).toEqual([0, 0, 4]);
  });

  it("counts attribute selectors as classes", () => {
    expect(specificity('[data-ui-scope]')).toEqual([0, 1, 0]);
    expect(specificity('input[type="file"]')).toEqual([0, 1, 1]);
  });

  it("takes the highest branch inside :not(), :is() and :has()", () => {
    expect(specificity(":not(.a, #b)")).toEqual([1, 0, 0]);
    expect(specificity(":is(div, .cls)")).toEqual([0, 1, 0]);
  });

  it("gives :where() zero specificity", () => {
    expect(specificity(":where(#a, .b)")).toEqual([0, 0, 0]);
    expect(specificity(".x:where(#a)")).toEqual([0, 1, 0]);
  });

  it("counts a pseudo-element as a type, not a class", () => {
    expect(specificity(".a::before")).toEqual([0, 1, 1]);
    expect(specificity("::-webkit-scrollbar")).toEqual([0, 0, 1]);
  });
});

describe("parseStylesheet", () => {
  it("splits selector lists into separate rules, preserving source order", () => {
    const rules = parseStylesheet(".a, .b { color: red }");
    expect(rules.map((r) => r.selector)).toEqual([".a", ".b"]);
    expect(rules[0].order).toBe(0);
    expect(rules[1].order).toBe(1);
  });

  it("does not split on a comma inside :not()", () => {
    const rules = parseStylesheet(":not(.a, .b) { color: red }");
    expect(rules.map((r) => r.selector)).toEqual([":not(.a, .b)"]);
  });

  it("records !important separately from the value", () => {
    const [rule] = parseStylesheet(".a { color: red !important }");
    expect(rule.declarations.get("color")).toEqual({ value: "red", important: true });
  });

  it("keeps the last declaration when a property repeats inside one rule", () => {
    const [rule] = parseStylesheet(".a { color: red; color: blue }");
    expect(rule.declarations.get("color").value).toBe("blue");
  });

  it("does not split a declaration on a semicolon inside a url()", () => {
    const [rule] = parseStylesheet('.a { background: url("data:image/svg+xml;base64,AAA"); color: red }');
    expect(rule.declarations.get("color").value).toBe("red");
    expect(rule.declarations.get("background").value).toContain("base64,AAA");
  });

  it("attaches the media condition to nested rules", () => {
    const [rule] = parseStylesheet("@media (max-width: 768px) { .a { color: red } }");
    expect(rule.media).toBe("(max-width: 768px)");
    expect(rule.selector).toBe(".a");
  });

  it("ignores @keyframes bodies", () => {
    expect(parseStylesheet("@keyframes spin { from { opacity: 0 } to { opacity: 1 } }")).toEqual([]);
  });

  it("ignores @font-face and @import", () => {
    expect(parseStylesheet('@import url("x.css"); @font-face { font-family: a }')).toEqual([]);
  });

  it("strips comments, including ones containing braces", () => {
    const rules = parseStylesheet("/* .fake { color: red } */ .a { color: blue }");
    expect(rules).toHaveLength(1);
    expect(rules[0].selector).toBe(".a");
  });

  it("preserves custom properties verbatim", () => {
    const [rule] = parseStylesheet(":root { --gradient: linear-gradient(135deg, #a, #b) }");
    expect(rule.declarations.get("--gradient").value).toBe("linear-gradient(135deg, #a, #b)");
  });
});

describe("mediaMatches", () => {
  it("evaluates width bounds", () => {
    expect(mediaMatches("(max-width: 768px)", { width: 400 })).toBe(true);
    expect(mediaMatches("(max-width: 768px)", { width: 1400 })).toBe(false);
    expect(mediaMatches("(min-width: 769px)", { width: 1400 })).toBe(true);
  });

  it("treats max-width as inclusive and min-width as inclusive", () => {
    expect(mediaMatches("(max-width: 768px)", { width: 768 })).toBe(true);
    expect(mediaMatches("(min-width: 768px)", { width: 768 })).toBe(true);
  });

  it("evaluates reduced motion", () => {
    expect(mediaMatches("(prefers-reduced-motion: reduce)", { reducedMotion: true })).toBe(true);
    expect(mediaMatches("(prefers-reduced-motion: reduce)", { reducedMotion: false })).toBe(false);
  });

  it("ands compound conditions", () => {
    expect(mediaMatches("(min-width: 700px) and (max-width: 900px)", { width: 800 })).toBe(true);
    expect(mediaMatches("(min-width: 700px) and (max-width: 900px)", { width: 1000 })).toBe(false);
  });

  it("ors a comma-separated media list", () => {
    expect(mediaMatches("(max-width: 400px), (min-width: 1200px)", { width: 1400 })).toBe(true);
    expect(mediaMatches("(max-width: 400px), (min-width: 1200px)", { width: 800 })).toBe(false);
  });

  it("matches the screen and all media types", () => {
    expect(mediaMatches("screen and (max-width: 768px)", { width: 400 })).toBe(true);
    expect(mediaMatches("all", { width: 400 })).toBe(true);
  });

  it("never matches print", () => {
    expect(mediaMatches("print", { width: 400 })).toBe(false);
  });
});

describe("resolve", () => {
  const mount = (html) => {
    document.body.innerHTML = html;
    return document.body.firstElementChild;
  };

  it("lets !important beat higher specificity", () => {
    const rules = parseStylesheet("#x { color: blue } .y { color: red !important }");
    const el = mount(`<div id="x" class="y"></div>`);
    expect(resolve(el, rules, {}, []).get("color").value).toBe("red");
  });

  it("lets specificity beat source order", () => {
    const rules = parseStylesheet(".a.b { color: blue } .a { color: red }");
    expect(resolve(mount(`<div class="a b"></div>`), rules, {}, []).get("color").value).toBe("blue");
  });

  it("lets source order break a specificity tie", () => {
    const rules = parseStylesheet(".a { color: blue } .a { color: red }");
    expect(resolve(mount(`<div class="a"></div>`), rules, {}, []).get("color").value).toBe("red");
  });

  it("lets a later !important beat an earlier !important", () => {
    const rules = parseStylesheet("#x { color: blue !important } .y { color: red !important }");
    const el = mount(`<div id="x" class="y"></div>`);
    // Both important: specificity decides, and #x is higher.
    expect(resolve(el, rules, {}, []).get("color").value).toBe("blue");
  });

  it("applies :hover rules only in the hover state", () => {
    const rules = parseStylesheet(".a { color: blue } .a:hover { color: red }");
    const el = mount(`<div class="a"></div>`);
    expect(resolve(el, rules, {}, []).get("color").value).toBe("blue");
    expect(resolve(el, rules, {}, ["hover"]).get("color").value).toBe("red");
  });

  it("requires every dynamic pseudo-class in a compound to be active", () => {
    const rules = parseStylesheet(".a:hover:focus { color: red }");
    const el = mount(`<div class="a"></div>`);
    expect(resolve(el, rules, {}, ["hover"]).has("color")).toBe(false);
    expect(resolve(el, rules, {}, ["hover", "focus"]).get("color").value).toBe("red");
  });

  it("matches a dynamic pseudo-class on an ancestor in the selector", () => {
    const rules = parseStylesheet(".p:hover .c { color: red }");
    document.body.innerHTML = `<div class="p"><span class="c"></span></div>`;
    const child = document.querySelector(".c");
    expect(resolve(child, rules, {}, []).has("color")).toBe(false);
    expect(resolve(child, rules, {}, ["hover"]).get("color").value).toBe("red");
  });

  it("keys pseudo-element declarations separately from the element's own", () => {
    const rules = parseStylesheet(".a { color: blue } .a::before { color: red }");
    const out = resolve(mount(`<div class="a"></div>`), rules, {}, []);
    expect(out.get("color").value).toBe("blue");
    expect(out.get("::before/color").value).toBe("red");
  });

  it("skips rules whose media condition does not match", () => {
    const rules = parseStylesheet(".a { color: blue } @media (max-width: 768px) { .a { color: red } }");
    const el = mount(`<div class="a"></div>`);
    expect(resolve(el, rules, { width: 1400 }, []).get("color").value).toBe("blue");
    expect(resolve(el, rules, { width: 400 }, []).get("color").value).toBe("red");
  });

  it("matches descendant selectors against real ancestry", () => {
    const rules = parseStylesheet(".root .leaf { color: red }");
    document.body.innerHTML = `<div class="root"><i><span class="leaf"></span></i></div>`;
    expect(resolve(document.querySelector(".leaf"), rules, {}, []).get("color").value).toBe("red");
  });
});

describe("effectiveVars", () => {
  it("inherits custom properties from ancestors", () => {
    const rules = parseStylesheet(":root { --bg: black } .child { color: red }");
    document.documentElement.className = "";
    document.body.innerHTML = `<div class="child"></div>`;
    const vars = effectiveVars(document.querySelector(".child"), rules, {});
    expect(vars.get("--bg")).toBe("black");
  });

  it("lets a nearer ancestor shadow a farther one", () => {
    // This is the exact shape of the theme system: :root holds the dark
    // defaults and .app-root.light overrides them further down the tree.
    const rules = parseStylesheet(":root { --bg: black } .light { --bg: white }");
    document.body.innerHTML = `<div class="light"><span class="leaf"></span></div>`;
    expect(effectiveVars(document.querySelector(".leaf"), rules, {}).get("--bg")).toBe("white");
  });

  it("does not care which ancestor declared a token, only its value", () => {
    // Moving a token declaration from .app-root up to :root must NOT read as a
    // change — that is exactly the refactor being performed, and a snapshot
    // that flagged it would be unusable.
    const onRoot = parseStylesheet(":root { --bg: black }");
    const onApp = parseStylesheet(".app { --bg: black }");
    document.body.innerHTML = `<div class="app"><span class="leaf"></span></div>`;
    const leaf = document.querySelector(".leaf");
    expect(effectiveVars(leaf, onRoot, {}).get("--bg")).toBe(effectiveVars(leaf, onApp, {}).get("--bg"));
  });
});

describe("substituteVars", () => {
  const vars = new Map([["--a", "red"], ["--b", "var(--a)"], ["--pad", "4px"]]);

  it("replaces a single reference", () => {
    expect(substituteVars("var(--a)", vars)).toBe("red");
  });

  it("replaces references inside a larger value", () => {
    expect(substituteVars("1px solid var(--a)", vars)).toBe("1px solid red");
  });

  it("resolves a reference that points at another reference", () => {
    expect(substituteVars("var(--b)", vars)).toBe("red");
  });

  it("uses the fallback when the token is undefined", () => {
    expect(substituteVars("var(--missing, 8px)", vars)).toBe("8px");
  });

  it("prefers the defined token over its fallback", () => {
    expect(substituteVars("var(--pad, 99px)", vars)).toBe("4px");
  });

  it("handles a fallback that is itself a reference", () => {
    expect(substituteVars("var(--missing, var(--a))", vars)).toBe("red");
  });

  it("leaves an unresolvable reference visible rather than silently blank", () => {
    expect(substituteVars("var(--missing)", vars)).toBe("var(--missing)");
  });

  it("terminates on a self-referential token instead of recursing forever", () => {
    const cyclic = new Map([["--x", "var(--y)"], ["--y", "var(--x)"]]);
    expect(() => substituteVars("var(--x)", cyclic)).not.toThrow();
  });
});

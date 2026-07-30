import { describe, it, expect } from "vitest";
import { resolveLanguage } from "../components/CodeBlock";

/**
 * PrismLight registers a fixed set of grammars instead of shipping every
 * language Prism knows (which cost ~627kB). An unregistered language must fall
 * back to plain text rather than throwing, and the common fence aliases must
 * map onto the grammars that are registered — otherwise ```sh and ```yml would
 * silently render flat despite bash and yaml both being available.
 */
describe("resolveLanguage", () => {
  it("passes through languages that are registered", () => {
    for (const lang of ["javascript", "python", "rust", "sql", "yaml", "bash"]) {
      expect(resolveLanguage(lang)).toBe(lang);
    }
  });

  it("maps shell aliases onto bash", () => {
    for (const alias of ["sh", "shell", "zsh", "console"]) {
      expect(resolveLanguage(alias)).toBe("bash");
    }
  });

  it("maps common short aliases", () => {
    expect(resolveLanguage("js")).toBe("javascript");
    expect(resolveLanguage("ts")).toBe("typescript");
    expect(resolveLanguage("py")).toBe("python");
    expect(resolveLanguage("rb")).toBe("ruby");
    expect(resolveLanguage("rs")).toBe("rust");
    expect(resolveLanguage("yml")).toBe("yaml");
    expect(resolveLanguage("md")).toBe("markdown");
  });

  it("maps markup-family languages onto the markup grammar", () => {
    for (const alias of ["html", "xml", "svg", "vue"]) {
      expect(resolveLanguage(alias)).toBe("markup");
    }
  });

  it("is case-insensitive and tolerates whitespace", () => {
    expect(resolveLanguage("PYTHON")).toBe("python");
    expect(resolveLanguage("  JS  ")).toBe("javascript");
    expect(resolveLanguage("Dockerfile")).toBe("docker");
  });

  // The important safety property: an unknown fence must degrade to plain text
  // rather than being handed to the highlighter as an unregistered grammar.
  it("falls back to text for languages that are not registered", () => {
    for (const lang of ["brainfuck", "cobol", "not-a-language", "haskell"]) {
      expect(resolveLanguage(lang)).toBe("text");
    }
  });

  it("falls back to text for empty or missing input", () => {
    expect(resolveLanguage("")).toBe("text");
    expect(resolveLanguage(null)).toBe("text");
    expect(resolveLanguage(undefined)).toBe("text");
  });

  it("covers the languages an AI assistant most often emits", () => {
    // Regression guard: if someone trims the registration list to save bytes,
    // these are the ones that must survive.
    const essential = ["javascript", "typescript", "jsx", "tsx", "python", "bash", "json", "sql", "css", "markup"];
    for (const lang of essential) {
      expect(resolveLanguage(lang), `${lang} must stay registered`).toBe(lang);
    }
  });
});

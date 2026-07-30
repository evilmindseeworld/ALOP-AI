import { useState, useCallback } from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

// PrismLight, not Prism. The full Prism build bundles a grammar for every
// language it knows — ~627kB minified. PrismLight ships the core and lets you
// register only what you need.
//
// The list below is what a coding assistant actually emits. Anything not
// registered still renders in the styled block, just without token colouring —
// a graceful degradation, not an error. Add a language here if you find one
// rendering flat.
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import c from "react-syntax-highlighter/dist/esm/languages/prism/c";
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp";
import csharp from "react-syntax-highlighter/dist/esm/languages/prism/csharp";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import docker from "react-syntax-highlighter/dist/esm/languages/prism/docker";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import graphql from "react-syntax-highlighter/dist/esm/languages/prism/graphql";
import ini from "react-syntax-highlighter/dist/esm/languages/prism/ini";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import kotlin from "react-syntax-highlighter/dist/esm/languages/prism/kotlin";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import php from "react-syntax-highlighter/dist/esm/languages/prism/php";
import powershell from "react-syntax-highlighter/dist/esm/languages/prism/powershell";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import ruby from "react-syntax-highlighter/dist/esm/languages/prism/ruby";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import swift from "react-syntax-highlighter/dist/esm/languages/prism/swift";
import toml from "react-syntax-highlighter/dist/esm/languages/prism/toml";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";

const LANGUAGES = {
  bash, c, cpp, csharp, css, diff, docker, go, graphql, ini, java, javascript,
  json, jsx, kotlin, markdown, markup, php, powershell, python, ruby, rust,
  sql, swift, toml, tsx, typescript, yaml,
};

for (const [name, definition] of Object.entries(LANGUAGES)) {
  SyntaxHighlighter.registerLanguage(name, definition);
}

// Fences are written with whatever alias the model felt like. Mapping them
// here means ```sh and ```yml highlight instead of silently rendering flat.
const ALIASES = {
  sh: "bash", shell: "bash", zsh: "bash", console: "bash",
  js: "javascript", mjs: "javascript", cjs: "javascript", node: "javascript",
  ts: "typescript", py: "python", rb: "ruby", rs: "rust", kt: "kotlin",
  cs: "csharp", "c++": "cpp", yml: "yaml", md: "markdown",
  html: "markup", xml: "markup", svg: "markup", vue: "markup",
  dockerfile: "docker", ps1: "powershell", postgres: "sql", psql: "sql",
};

export const resolveLanguage = (raw) => {
  const key = (raw || "").toLowerCase().trim();
  if (!key) return "text";
  const resolved = ALIASES[key] || key;
  return resolved in LANGUAGES ? resolved : "text";
};

/**
 * Syntax-highlighted code block.
 *
 * Lives in its own module so it can be lazy-loaded — it is by far the largest
 * thing in the app, yet it is only needed once a reply actually contains a
 * fenced code block.
 */
export default function CodeBlock({ language, code, ...props }) {
  const [copied, setCopied] = useState(false);

  // The old button gave no feedback at all, so on a slow clipboard write you
  // could not tell whether the click had registered.
  const copy = useCallback(() => {
    navigator.clipboard.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => setCopied(false)
    );
  }, [code]);

  return (
    <div className="code-block-wrapper">
      <button className={`code-copy-btn ${copied ? "is-copied" : ""}`} onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
      <SyntaxHighlighter style={oneDark} language={resolveLanguage(language)} PreTag="div" {...props}>
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

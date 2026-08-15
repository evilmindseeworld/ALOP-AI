import { useState, useCallback, useEffect } from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

// The highlighter module is already behind MessageList's lazy boundary. Keep
// its grammars behind a second boundary too: a Python answer should not fetch
// 25 unrelated grammars just because it contains one fenced block.
const LANGUAGE_LOADERS = {
  bash: () => import("react-syntax-highlighter/dist/esm/languages/prism/bash").then((m) => m.default),
  c: () => import("react-syntax-highlighter/dist/esm/languages/prism/c").then((m) => m.default),
  cpp: () => import("react-syntax-highlighter/dist/esm/languages/prism/cpp").then((m) => m.default),
  csharp: () => import("react-syntax-highlighter/dist/esm/languages/prism/csharp").then((m) => m.default),
  css: () => import("react-syntax-highlighter/dist/esm/languages/prism/css").then((m) => m.default),
  diff: () => import("react-syntax-highlighter/dist/esm/languages/prism/diff").then((m) => m.default),
  docker: () => import("react-syntax-highlighter/dist/esm/languages/prism/docker").then((m) => m.default),
  go: () => import("react-syntax-highlighter/dist/esm/languages/prism/go").then((m) => m.default),
  graphql: () => import("react-syntax-highlighter/dist/esm/languages/prism/graphql").then((m) => m.default),
  ini: () => import("react-syntax-highlighter/dist/esm/languages/prism/ini").then((m) => m.default),
  java: () => import("react-syntax-highlighter/dist/esm/languages/prism/java").then((m) => m.default),
  javascript: () => import("react-syntax-highlighter/dist/esm/languages/prism/javascript").then((m) => m.default),
  json: () => import("react-syntax-highlighter/dist/esm/languages/prism/json").then((m) => m.default),
  jsx: () => import("react-syntax-highlighter/dist/esm/languages/prism/jsx").then((m) => m.default),
  kotlin: () => import("react-syntax-highlighter/dist/esm/languages/prism/kotlin").then((m) => m.default),
  markdown: () => import("react-syntax-highlighter/dist/esm/languages/prism/markdown").then((m) => m.default),
  markup: () => import("react-syntax-highlighter/dist/esm/languages/prism/markup").then((m) => m.default),
  php: () => import("react-syntax-highlighter/dist/esm/languages/prism/php").then((m) => m.default),
  powershell: () => import("react-syntax-highlighter/dist/esm/languages/prism/powershell").then((m) => m.default),
  python: () => import("react-syntax-highlighter/dist/esm/languages/prism/python").then((m) => m.default),
  ruby: () => import("react-syntax-highlighter/dist/esm/languages/prism/ruby").then((m) => m.default),
  rust: () => import("react-syntax-highlighter/dist/esm/languages/prism/rust").then((m) => m.default),
  sql: () => import("react-syntax-highlighter/dist/esm/languages/prism/sql").then((m) => m.default),
  swift: () => import("react-syntax-highlighter/dist/esm/languages/prism/swift").then((m) => m.default),
  toml: () => import("react-syntax-highlighter/dist/esm/languages/prism/toml").then((m) => m.default),
  tsx: () => import("react-syntax-highlighter/dist/esm/languages/prism/tsx").then((m) => m.default),
  typescript: () => import("react-syntax-highlighter/dist/esm/languages/prism/typescript").then((m) => m.default),
  yaml: () => import("react-syntax-highlighter/dist/esm/languages/prism/yaml").then((m) => m.default),
};

const loadedLanguages = new Set();
const pendingLanguages = new Map();

const loadLanguage = (language) => {
  if (loadedLanguages.has(language)) return Promise.resolve();
  if (!LANGUAGE_LOADERS[language]) return Promise.resolve();
  if (!pendingLanguages.has(language)) {
    pendingLanguages.set(
      language,
      LANGUAGE_LOADERS[language]()
        .then((definition) => {
          SyntaxHighlighter.registerLanguage(language, definition);
          loadedLanguages.add(language);
        })
        .catch(() => {})
        .finally(() => pendingLanguages.delete(language)),
    );
  }
  return pendingLanguages.get(language);
};

// Fences are written with whatever alias the model felt like.
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
  return resolved in LANGUAGE_LOADERS ? resolved : "text";
};

/** Syntax-highlighted code block. The plain fallback keeps its box stable. */
export default function CodeBlock({ language, code, ...props }) {
  const [copied, setCopied] = useState(false);
  const resolvedLanguage = resolveLanguage(language);
  const [languageReady, setLanguageReady] = useState(() => loadedLanguages.has(resolvedLanguage));

  useEffect(() => {
    let active = true;
    if (resolvedLanguage === "text" || loadedLanguages.has(resolvedLanguage)) {
      setLanguageReady(true);
    } else {
      setLanguageReady(false);
      loadLanguage(resolvedLanguage).then(() => {
        if (active) setLanguageReady(true);
      });
    }
    return () => { active = false; };
  }, [resolvedLanguage]);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => setCopied(false),
    );
  }, [code]);

  return (
    <div className="code-block-wrapper">
      <button className={`code-copy-btn ${copied ? "is-copied" : ""}`} onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
      <SyntaxHighlighter style={oneDark} language={languageReady ? resolvedLanguage : "text"} PreTag="div" {...props}>
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

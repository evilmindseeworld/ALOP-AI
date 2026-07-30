/**
 * A CSS cascade resolver, for proving a stylesheet refactor changed nothing.
 *
 * WHY THIS EXISTS
 *
 * App.css carried 195 `!important` declarations because every fix for the life
 * of the file was appended at the bottom rather than edited in place. Removing
 * them means moving declarations between rules, and nothing in the suite would
 * notice if that changed what renders:
 *
 *   - jsdom's getComputedStyle does not resolve a cascade across stylesheets.
 *     It reports *a* value, not *the winner*.
 *   - Screenshot diffing cannot tell an antialiasing delta from a broken layout.
 *
 * So this parses the stylesheet, computes real specificity, walks a fixture DOM
 * with element.matches() — which jsdom does implement correctly — and reports
 * the winning declaration for every property on every element.
 *
 * THE ONE SUBTLETY WORTH READING
 *
 * Custom properties are resolved through the ancestor chain and substituted
 * into values before they are recorded. That is deliberate: the refactor moves
 * token declarations between `:root` and `.app-root`, which changes *where* a
 * token is declared without changing what any descendant renders. A snapshot
 * that flagged that move would fail on every correct commit and be turned off
 * within a day. Substituting first means the snapshot tracks the rendered
 * value, which is the thing that must not change.
 */

// --- small scanners -------------------------------------------------------

const IDENT = /[-_a-zA-Z0-9 -￿\\]/;

const skipIdent = (s, i) => {
  while (i < s.length && IDENT.test(s[i])) i++;
  return i;
};

const endOfString = (s, i) => {
  const quote = s[i];
  i++;
  while (i < s.length) {
    if (s[i] === "\\") i += 2;
    else if (s[i] === quote) return i;
    else i++;
  }
  return s.length - 1;
};

const matchPair = (s, i, open, close) => {
  let depth = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"' || ch === "'") i = endOfString(s, i);
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return s.length - 1;
};

const matchParen = (s, i) => matchPair(s, i, "(", ")");
const matchBracket = (s, i) => matchPair(s, i, "[", "]");

/** Split on `sep` at nesting depth zero, ignoring separators inside strings. */
const splitTopLevel = (s, sep) => {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' || ch === "'") i = endOfString(s, i);
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === sep && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
};

/** Strip /* *\/ comments without eating anything inside a quoted string. */
export function stripComments(css) {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      const end = endOfString(css, i);
      out += css.slice(i, end + 1);
      i = end + 1;
    } else if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 2;
      out += " ";
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

// --- specificity ----------------------------------------------------------

// Single-colon spellings that are pseudo-ELEMENTS, not pseudo-classes. They
// count toward the type component, and CSS2 allowed one colon.
const LEGACY_PSEUDO_ELEMENTS = new Set(["before", "after", "first-line", "first-letter"]);

// Pseudo-classes whose specificity is that of their most specific argument.
const FUNCTIONAL_MAX = new Set(["not", "is", "has", "matches", "any", "-webkit-any", "-moz-any"]);

const cmpSpec = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const maxSpecificity = (argList) => {
  let best = [0, 0, 0];
  for (const branch of splitTopLevel(argList, ",")) {
    const s = specificity(branch.trim());
    if (cmpSpec(s, best) > 0) best = s;
  }
  return best;
};

/**
 * Specificity as [ids, classes, types], per the selectors spec.
 * `:where()` contributes zero; `:not()`/`:is()`/`:has()` contribute the
 * specificity of their most specific argument.
 */
export function specificity(selector) {
  let a = 0;
  let b = 0;
  let c = 0;
  let i = 0;
  const s = selector;

  while (i < s.length) {
    const ch = s[i];

    if (ch === '"' || ch === "'") {
      i = endOfString(s, i) + 1;
    } else if (ch === "#") {
      a++;
      i = skipIdent(s, i + 1);
    } else if (ch === ".") {
      b++;
      i = skipIdent(s, i + 1);
    } else if (ch === "[") {
      b++;
      i = matchBracket(s, i) + 1;
    } else if (ch === ":") {
      const isDouble = s[i + 1] === ":";
      const start = i + (isDouble ? 2 : 1);
      let j = skipIdent(s, start);
      const name = s.slice(start, j).toLowerCase();
      let arg = null;
      if (s[j] === "(") {
        const end = matchParen(s, j);
        arg = s.slice(j + 1, end);
        j = end + 1;
      }

      if (isDouble || LEGACY_PSEUDO_ELEMENTS.has(name)) c++;
      else if (name === "where") {
        /* contributes nothing, by definition */
      } else if (FUNCTIONAL_MAX.has(name)) {
        if (arg) {
          const m = maxSpecificity(arg);
          a += m[0];
          b += m[1];
          c += m[2];
        }
      } else b++;

      i = j;
    } else if (ch === "*") {
      i++;
    } else if (IDENT.test(ch)) {
      c++;
      i = skipIdent(s, i);
    } else {
      i++; // combinator or whitespace
    }
  }

  return [a, b, c];
}

// --- selector analysis ----------------------------------------------------

/**
 * Pseudo-classes that describe a transient state rather than a shape.
 * jsdom's matches() returns false for all of these unconditionally, so they are
 * stripped from the selector and recorded instead: a rule applies only when
 * every state it names has been requested.
 */
const DYNAMIC_PSEUDO = new Set([
  "hover",
  "focus",
  "focus-visible",
  "focus-within",
  "active",
  "disabled",
  "checked",
  "visited",
  "target",
  "placeholder-shown",
]);

/**
 * Rewrite a selector into something jsdom can match, pulling out the pieces it
 * cannot evaluate.
 *
 * Returns { matchSelector, pseudoElement, dynamic }.
 */
export function analyzeSelector(selector) {
  let out = "";
  let pseudoElement = null;
  const dynamic = [];
  let depth = 0;
  let i = 0;
  const s = selector;

  while (i < s.length) {
    const ch = s[i];

    if (ch === '"' || ch === "'") {
      const end = endOfString(s, i);
      out += s.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (ch === "[") {
      const end = matchBracket(s, i);
      out += s.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (ch === "(") {
      depth++;
      out += ch;
      i++;
      continue;
    }
    if (ch === ")") {
      depth--;
      out += ch;
      i++;
      continue;
    }

    if (ch === ":" && depth === 0) {
      const isDouble = s[i + 1] === ":";
      const start = i + (isDouble ? 2 : 1);
      let j = skipIdent(s, start);
      const name = s.slice(start, j).toLowerCase();
      if (s[j] === "(") j = matchParen(s, j) + 1;

      if (isDouble || LEGACY_PSEUDO_ELEMENTS.has(name)) {
        // Keep the first one. A selector cannot address two pseudo-elements.
        if (!pseudoElement) pseudoElement = `::${name}`;
        i = j;
        continue;
      }
      if (DYNAMIC_PSEUDO.has(name)) {
        dynamic.push(name);
        i = j;
        continue;
      }
      out += s.slice(i, j);
      i = j;
      continue;
    }

    out += ch;
    i++;
  }

  let matchSelector = out.trim();
  // `::-webkit-scrollbar` and `:hover` reduce to nothing; they apply to any
  // element, so `*` is the honest translation rather than dropping the rule.
  if (matchSelector === "") matchSelector = "*";
  else if (/[>+~]$/.test(matchSelector)) matchSelector = `${matchSelector} *`;

  return { matchSelector, pseudoElement, dynamic };
}

// --- stylesheet parsing ---------------------------------------------------

const parseDeclarations = (body) => {
  const decls = new Map();
  for (const raw of splitTopLevel(body, ";")) {
    const part = raw.trim();
    if (!part) continue;

    // The first colon at depth zero. Anything deeper belongs to a url() or a
    // nested function — `background: url(data:image/png;base64,…)` has three.
    let colon = -1;
    let depth = 0;
    for (let i = 0; i < part.length; i++) {
      const ch = part[i];
      if (ch === '"' || ch === "'") i = endOfString(part, i);
      else if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
      else if (ch === ":" && depth === 0) {
        colon = i;
        break;
      }
    }
    if (colon === -1) continue;

    const rawProp = part.slice(0, colon).trim();
    // Custom properties are case-sensitive; standard properties are not.
    const prop = rawProp.startsWith("--") ? rawProp : rawProp.toLowerCase();

    // Collapse internal whitespace. A multi-line box-shadow or gradient is the
    // same value however it is wrapped, and folding a declaration into another
    // rule reindents it — without this, every fold would report a false change.
    let value = part
      .slice(colon + 1)
      .trim()
      .replace(/\s+/g, " ");

    let important = false;
    const bang = value.toLowerCase().lastIndexOf("!important");
    if (bang !== -1 && !value.slice(bang + 10).trim()) {
      important = true;
      value = value.slice(0, bang).trim();
    }

    if (prop) decls.set(prop, { value, important });
  }
  return decls;
};

const makeRule = (selector, declarations, media, order) => ({
  selector,
  declarations,
  media,
  order,
  specificity: specificity(selector),
  match: analyzeSelector(selector),
});

const parseInto = (src, start, end, media, rules, counter) => {
  let i = start;
  while (i < end) {
    // Find the end of this construct's prelude.
    let j = i;
    while (j < end && src[j] !== "{" && src[j] !== ";" && src[j] !== "}") {
      if (src[j] === '"' || src[j] === "'") j = endOfString(src, j);
      j++;
    }
    if (j >= end) break;

    if (src[j] === ";" || src[j] === "}") {
      i = j + 1; // a statement at-rule (@import) or a stray brace
      continue;
    }

    const prelude = src.slice(i, j).trim();
    const bodyStart = j + 1;
    const bodyEnd = matchPair(src, j, "{", "}");
    if (bodyEnd <= j) break;

    if (prelude.startsWith("@")) {
      const name = prelude.slice(1).split(/[\s({]/)[0].toLowerCase();
      if (name === "media") {
        const condition = prelude.slice(prelude.indexOf(" ") + 1).trim();
        parseInto(src, bodyStart, bodyEnd, media ? `${media} and ${condition}` : condition, rules, counter);
      } else if (name === "supports" || name === "layer" || name === "scope") {
        // Assume support; the point is which declarations exist, not whether
        // this particular engine honours them.
        parseInto(src, bodyStart, bodyEnd, media, rules, counter);
      }
      // @keyframes, @font-face, @property, @theme: no cascading rules inside.
    } else {
      const declarations = parseDeclarations(src.slice(bodyStart, bodyEnd));
      if (declarations.size) {
        for (const raw of splitTopLevel(prelude, ",")) {
          const selector = raw.trim().replace(/\s+/g, " ");
          if (selector) rules.push(makeRule(selector, declarations, media, counter.n++));
        }
      }
    }

    i = bodyEnd + 1;
  }
};

// --- shorthand expansion --------------------------------------------------

/**
 * Shorthands, and the longhands they set.
 *
 * Without this the resolver treats `animation: none` and `animation-duration:
 * 0.01ms` as unrelated properties that never compete — and a browser very much
 * does have them compete. That gap caused a real miss: the audit reported the
 * prefers-reduced-motion block's !important as redundant and it was deleted,
 * which would have shipped an accessibility regression. `.typing-dot`'s
 * `animation` shorthand has higher specificity than the reduced-motion `*`
 * rule, so the force is exactly what makes the accessibility override win.
 *
 * Nested entries (border -> border-width -> border-top-width) expand
 * recursively.
 */
const SHORTHANDS = {
  animation: ["animation-name", "animation-duration", "animation-timing-function", "animation-delay",
    "animation-iteration-count", "animation-direction", "animation-fill-mode", "animation-play-state"],
  transition: ["transition-property", "transition-duration", "transition-timing-function", "transition-delay"],
  background: ["background-image", "background-position", "background-size", "background-repeat",
    "background-attachment", "background-origin", "background-clip", "background-color"],
  font: ["font-style", "font-variant", "font-weight", "font-stretch", "font-size", "line-height", "font-family"],
  margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
  padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
  inset: ["top", "right", "bottom", "left"],
  flex: ["flex-grow", "flex-shrink", "flex-basis"],
  "flex-flow": ["flex-direction", "flex-wrap"],
  overflow: ["overflow-x", "overflow-y"],
  gap: ["row-gap", "column-gap"],
  "place-items": ["align-items", "justify-items"],
  "place-content": ["align-content", "justify-content"],
  "place-self": ["align-self", "justify-self"],
  "grid-template": ["grid-template-rows", "grid-template-columns", "grid-template-areas"],
  "border-radius": ["border-top-left-radius", "border-top-right-radius",
    "border-bottom-right-radius", "border-bottom-left-radius"],
  "border-width": ["border-top-width", "border-right-width", "border-bottom-width", "border-left-width"],
  "border-style": ["border-top-style", "border-right-style", "border-bottom-style", "border-left-style"],
  "border-color": ["border-top-color", "border-right-color", "border-bottom-color", "border-left-color"],
  border: ["border-width", "border-style", "border-color"],
  "border-top": ["border-top-width", "border-top-style", "border-top-color"],
  "border-right": ["border-right-width", "border-right-style", "border-right-color"],
  "border-bottom": ["border-bottom-width", "border-bottom-style", "border-bottom-color"],
  "border-left": ["border-left-width", "border-left-style", "border-left-color"],
};

const expandShorthand = (prop, out = new Set()) => {
  for (const longhand of SHORTHANDS[prop] || []) {
    out.add(longhand);
    expandShorthand(longhand, out);
  }
  return out;
};

/**
 * Give every shorthand declaration a synthetic entry for each longhand it sets.
 *
 * Only longhands the stylesheet declares somewhere are materialised. A longhand
 * no rule ever sets cannot be contested, so expanding into it would triple the
 * snapshot for no detection value.
 *
 * The synthetic value carries the shorthand's full text, so editing the
 * shorthand still registers as a change on every longhand it controls.
 */
const expandShorthands = (rules) => {
  const declared = new Set();
  for (const rule of rules) for (const prop of rule.declarations.keys()) declared.add(prop);

  const done = new WeakSet(); // declaration maps are shared across a selector list
  for (const rule of rules) {
    if (done.has(rule.declarations)) continue;
    done.add(rule.declarations);

    // Within one rule, later declarations win — so an explicit longhand only
    // beats a shorthand if it is written after it.
    const positionOf = new Map([...rule.declarations.keys()].map((key, i) => [key, i]));

    for (const [prop, decl] of [...rule.declarations]) {
      if (!SHORTHANDS[prop]) continue;
      for (const longhand of expandShorthand(prop)) {
        if (!declared.has(longhand)) continue;
        const explicitAt = positionOf.get(longhand);
        if (explicitAt !== undefined && explicitAt > positionOf.get(prop)) continue;
        rule.declarations.set(longhand, { value: `<${prop}: ${decl.value}>`, important: decl.important });
      }
    }
  }
};

/** Parse a stylesheet into an ordered, flat list of rules. */
export function parseStylesheet(css) {
  const src = stripComments(css);
  const rules = [];
  parseInto(src, 0, src.length, null, rules, { n: 0 });
  expandShorthands(rules);
  return rules;
}

// --- media queries --------------------------------------------------------

const DEFAULT_ENV = { width: 1400, height: 900, reducedMotion: false, scheme: "dark" };

const matchFeature = (feature, env) => {
  const [rawName, rawValue] = splitTopLevel(feature, ":");
  const name = rawName.trim().toLowerCase();
  const value = (rawValue ?? "").trim().toLowerCase();

  switch (name) {
    case "max-width":
      return env.width <= parseFloat(value);
    case "min-width":
      return env.width >= parseFloat(value);
    case "max-height":
      return env.height <= parseFloat(value);
    case "min-height":
      return env.height >= parseFloat(value);
    case "prefers-reduced-motion":
      return value === "reduce" ? env.reducedMotion === true : env.reducedMotion !== true;
    case "prefers-color-scheme":
      return value === env.scheme;
    default:
      // An unknown feature is treated as matching. Dropping the rule instead
      // would hide its declarations from the snapshot entirely, which is the
      // one failure mode this harness must not have.
      return true;
  }
};

/** Evaluate a media condition against a synthetic environment. */
export function mediaMatches(condition, env = {}) {
  const e = { ...DEFAULT_ENV, ...env };

  return splitTopLevel(condition, ",").some((queryText) => {
    const query = queryText.trim().toLowerCase();
    if (!query) return false;

    let negated = false;
    let rest = query;
    if (rest.startsWith("not ")) {
      negated = true;
      rest = rest.slice(4).trim();
    } else if (rest.startsWith("only ")) {
      rest = rest.slice(5).trim();
    }

    const terms = rest.split(/\s+and\s+/).map((t) => t.trim()).filter(Boolean);
    const result = terms.every((term) => {
      if (term.startsWith("(")) return matchFeature(term.slice(1, -1), e);
      // A bare media type. Only screen output is ever rendered here.
      return term === "screen" || term === "all";
    });

    return negated ? !result : result;
  });
}

// --- cascade resolution ---------------------------------------------------

const matchesSafe = (el, selector) => {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
};

/**
 * The winning declaration for every property on `el`.
 *
 * Keys are property names; declarations targeting a pseudo-element are keyed
 * `::before/color` so they never compete with the element's own.
 */
export function resolve(el, rules, env = {}, state = []) {
  return applyRules(
    rules.filter((rule) => matchesSafe(el, rule.match.matchSelector)),
    env,
    state
  );
}

/**
 * The cascade over an already-matched rule list.
 *
 * Split out from `resolve` for the snapshot builder, which matches every rule
 * against the DOM once and then replays the cascade across the environment and
 * state matrix. Matching is the expensive half and does not depend on either.
 */
export function applyRules(rules, env = {}, state = []) {
  const winners = new Map();

  for (const rule of rules) {
    if (rule.media && !mediaMatches(rule.media, env)) continue;
    if (!rule.match.dynamic.every((d) => state.includes(d))) continue;

    const prefix = rule.match.pseudoElement ? `${rule.match.pseudoElement}/` : "";

    for (const [prop, decl] of rule.declarations) {
      const key = prefix + prop;
      const prev = winners.get(key);
      if (!prev || wins(decl.important, rule.specificity, rule.order, prev)) {
        winners.set(key, {
          value: decl.value,
          important: decl.important,
          specificity: rule.specificity,
          order: rule.order,
          selector: rule.selector,
        });
      }
    }
  }

  return winners;
}

const wins = (important, spec, order, prev) => {
  if (important !== prev.important) return important;
  const bySpec = cmpSpec(spec, prev.specificity);
  if (bySpec !== 0) return bySpec > 0;
  return order > prev.order;
};

/** Every custom property in scope on `el`, resolved through its ancestors. */
export function effectiveVars(el, rules, env = {}) {
  const chain = [];
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) chain.unshift(node);

  const vars = new Map();
  for (const node of chain) {
    for (const [key, decl] of resolve(node, rules, env, [])) {
      if (key.startsWith("--")) vars.set(key, decl.value);
    }
  }
  return vars;
}

/**
 * Replace every var() reference with its value.
 *
 * An unresolvable reference is left in place rather than blanked, so a missing
 * token is visible in the snapshot instead of silently reading as "no value".
 */
export function substituteVars(value, vars, maxDepth = 20) {
  let out = value;
  for (let i = 0; i < maxDepth; i++) {
    const next = substituteOnce(out, vars);
    if (next === out) return out;
    out = next;
  }
  return out; // cyclic reference; stop rather than recurse forever
}

const substituteOnce = (value, vars) => {
  const at = value.indexOf("var(");
  if (at === -1) return value;

  const end = matchParen(value, at + 3);
  const inner = value.slice(at + 4, end);
  const comma = splitTopLevel(inner, ",");
  const name = comma[0].trim();
  const fallback = comma.length > 1 ? comma.slice(1).join(",").trim() : null;

  if (vars.has(name)) return value.slice(0, at) + vars.get(name) + value.slice(end + 1);
  if (fallback !== null) return value.slice(0, at) + fallback + value.slice(end + 1);

  // Unresolvable. Keep it, but carry on substituting whatever follows.
  return value.slice(0, end + 1) + substituteOnce(value.slice(end + 1), vars);
};

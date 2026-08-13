/**
 * The arithmetic fast path: a sum answered without asking a model anything.
 *
 * WHY THIS EXISTS. "80 squared" took the same road as "compare Postgres and
 * MySQL" — a council of seats polled non-streaming, then a synthesis call to
 * reconcile drafts that all said 6400. Two model round-trips minimum, on free
 * seats measured between 2.1s and 23.9s, to compute something a CPU does in
 * nanoseconds. Worse than the wait: every turn spends OpenRouter REQUESTS, and
 * the account gets 50 per UTC day shared across all users. Arithmetic was
 * eating the budget that hard questions need.
 *
 * THE RULE THIS MODULE LIVES BY: it returns null far more readily than it
 * returns an answer. A wrong fast answer is worse than a slow right one, and
 * this thing sits in front of the entire product — anything it claims, the user
 * gets, with no model in the loop to disagree. So every ambiguity, every
 * unsupported form, every shape that might be a REASONING question wearing
 * arithmetic's clothes, returns null and falls through to the council
 * unchanged. Silence is the safe output.
 *
 * NO eval, NO Function, NO regex-and-hope. This is a tokeniser and a recursive
 * descent parser over a closed grammar. The input is a hostile string from an
 * authenticated stranger; the only thing that ever reaches a JS evaluator here
 * is BigInt arithmetic on numbers the parser itself built.
 *
 * EXACT RATIONALS, NOT FLOATS, and that decision buys more than it costs. Every
 * value is a BigInt numerator over a BigInt denominator, so 0.1 + 0.2 is
 * exactly 0.3 rather than 0.30000000000000004, 21600³ is exact rather than
 * "1.0077696e+13", and division by zero is a denominator test rather than an
 * Infinity that would have been rendered and shipped. The float version of this
 * file is shorter and wrong in ways only some inputs reveal.
 */

/* ── Rationals ───────────────────────────────────────────────────────────── */

const gcd = (a, b) => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) [x, y] = [y, x % y];
  return x;
};

/** Always normalised: denominator positive, terms coprime. Comparisons and the
 * integer test below are then plain equality rather than cross-multiplication. */
function rat(n, d = 1n) {
  if (d === 0n) return null; // division by zero — the caller falls through
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}

const add = (a, b) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a, b) => rat(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a, b) => rat(a.n * b.n, a.d * b.d);
const div = (a, b) => (b.n === 0n ? null : rat(a.n * b.d, a.d * b.n));
const isInt = (r) => r.d === 1n;

/**
 * Integer powers only, and bounded.
 *
 * A fractional exponent (80^0.5) is irrational in general and this module deals
 * only in exact values, so it falls through rather than being approximated —
 * an approximation is exactly the kind of quietly-wrong answer the module
 * exists to avoid.
 *
 * The size guard is not politeness. `2^10000000` is a single short message that
 * would otherwise pin a CPU inside a synchronous BigInt multiply, in-process,
 * on the request thread, with no timeout above it — a denial of service that
 * costs the sender nothing. The ceiling is on the RESULT's digit count,
 * estimated before any work happens, not on the exponent alone: 2^4000 is
 * cheap, 99999^4000 is not.
 */
const MAX_RESULT_DIGITS = 1000;

function pow(base, exp) {
  if (!isInt(exp)) return null;
  const e = exp.n;
  if (e > 20000n || e < -20000n) return null;
  if (base.n === 0n && e <= 0n) return null; // 0^0 is a convention, 0^-1 undefined

  const digits = (v) => String(v < 0n ? -v : v).length;
  const scale = e < 0n ? -e : e;
  if (BigInt(Math.max(digits(base.n), digits(base.d))) * scale > BigInt(MAX_RESULT_DIGITS)) return null;

  let n = base.n ** scale;
  let d = base.d ** scale;
  return e < 0n ? rat(d, n) : rat(n, d);
}

/* ── Reading the message ─────────────────────────────────────────────────── */

/**
 * Openers that mean "compute this", stripped so the rest can be parsed as an
 * expression. Anchored and word-bounded: only a message that OPENS with one of
 * these is a computation request. "tell me what is wrong with 2 + 2" keeps its
 * prose and therefore fails to parse, which is the correct outcome.
 */
const OPENERS =
  /^(?:please\s+)?(?:can you\s+|could you\s+)?(?:tell me\s+)?(?:what(?:'|’)?s|what is|what are|whats|how much is|how much are|calculate|compute|solve|work out|evaluate)\s+/i;

/**
 * Word operators, longest first so "divided by" is consumed before "by" could
 * ever be looked at, and "to the power of" before "of".
 *
 * `of` is NOT here. It is only ever read as part of the percent form, in the
 * parser, where a percent literal precedes it. On its own, "of" is English.
 */
const WORD_OPS = [
  [/^to the power of\b/i, '^'],
  [/^divided by\b/i, '/'],
  [/^multiplied by\b/i, '*'],
  [/^over\b/i, '/'],
  [/^times\b/i, '*'],
  [/^plus\b/i, '+'],
  [/^minus\b/i, '-'],
];

/**
 * Characters that are the same operator in another keyboard's clothes. This
 * product detects Arabic, Japanese, Chinese, Korean and Russian, so × and ÷ and
 * the unicode minus are not exotic here — they are what a user on a non-US
 * layout actually types, and rejecting them would send a genuine sum to the
 * council.
 *
 * Full-width digits are folded for the same reason. Arabic-Indic digits (٤٢)
 * deliberately are NOT: rendering the answer back in Western digits would be
 * answering in the wrong script, and the council handles the language question
 * properly. Falling through there is a better product, not a gap.
 */
const FOLD = { '×': '*', '⋅': '*', '·': '*', '÷': '/', '−': '-', '–': '-', '—': '-', '％': '%', '，': ',' };

function fold(text) {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code >= 0xff10 && code <= 0xff19) out += String(code - 0xff10); // full-width digits
    else out += FOLD[ch] ?? ch;
  }
  return out;
}

/**
 * TOKENS, or null the moment anything unrecognised appears.
 *
 * The null is the whole safety property: a token stream can only be built from
 * a message made ENTIRELY of numbers, operators and the handful of words above.
 * "80 squared and what is the capital of France" dies on `and`, which is how
 * the no-partial-matching rule is enforced — not by a second check that could
 * be forgotten, but because there is no way to express a partial parse.
 */
function tokenize(input) {
  const tokens = [];
  let s = input;

  while (s.length) {
    if (/^\s+/.test(s)) { s = s.replace(/^\s+/, ''); continue; }

    /* Thousands separators are stripped only in the unambiguous English shape
     * (groups of exactly three). "1.000,50" is a European decimal comma and is
     * NOT handled — it falls through, because reading it as 1.00050 would be
     * confidently wrong for the users most likely to type it. */
    const num = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?|^\d+(?:\.\d+)?|^\.\d+/.exec(s);
    if (num) {
      tokens.push({ t: 'num', v: num[0].replace(/,/g, ''), raw: num[0] });
      s = s.slice(num[0].length);
      continue;
    }

    const word = /^(squared|cubed|percent of|percent|per cent)\b/i.exec(s);
    if (word) {
      const w = word[0].toLowerCase();
      tokens.push({ t: w === 'squared' ? 'sq' : w === 'cubed' ? 'cu' : w === 'percent of' ? 'pctof' : 'pct' });
      s = s.slice(word[0].length);
      continue;
    }

    let matched = false;
    for (const [re, op] of WORD_OPS) {
      const m = re.exec(s);
      if (m) { tokens.push({ t: 'op', v: op }); s = s.slice(m[0].length); matched = true; break; }
    }
    if (matched) continue;

    const ch = s[0];
    if ('+-*/^'.includes(ch)) { tokens.push({ t: 'op', v: ch }); s = s.slice(1); continue; }
    if (ch === '%') { tokens.push({ t: 'pct' }); s = s.slice(1); continue; }
    if (ch === '(' || ch === ')') { tokens.push({ t: ch }); s = s.slice(1); continue; }
    if (/^of\b/i.test(s)) { tokens.push({ t: 'of' }); s = s.slice(2); continue; }

    return null; // one unknown character is enough to hand the whole message back
  }
  return tokens;
}

/* ── The grammar ─────────────────────────────────────────────────────────── */
/*
 * expr    := term (('+' | '-') term)*
 * term    := unary (('*' | '/') unary)*
 * unary   := '-' unary | power
 * power   := postfix ('^' unary)?          — right associative, as in maths
 * postfix := primary ('squared' | 'cubed' | '%' 'of' expr)*
 * primary := number | '(' expr ')'
 *
 * Precedence is the ordinary one, so "2 + 3 * 4" is 14 and not 20. That is not
 * a detail: a parser that gets it wrong is wrong on the most common shape there
 * is, and nothing downstream would catch it.
 *
 * Every node carries enough to render the expression BACK, because the answer
 * the user sees is `80² = 6400` — the echo is how they check the machine read
 * them correctly. Rendering from the tree rather than from their raw text is
 * deliberate: it shows what was actually computed, so a misread is visible
 * rather than hidden behind their own words.
 */

function parse(tokens) {
  let i = 0;
  const peek = () => tokens[i];
  const eat = (t, v) => {
    const tok = tokens[i];
    if (!tok || tok.t !== t || (v !== undefined && tok.v !== v)) return null;
    i++;
    return tok;
  };

  function primary() {
    if (eat('(')) {
      const e = expr();
      if (!e || !eat(')')) return null;
      return { k: 'paren', a: e };
    }
    const n = eat('num');
    if (!n) return null;
    return { k: 'num', v: n.v, raw: n.raw };
  }

  function postfix() {
    let node = primary();
    if (!node) return null;
    for (;;) {
      if (eat('sq')) { node = { k: 'sq', a: node }; continue; }
      if (eat('cu')) { node = { k: 'cu', a: node }; continue; }
      /* "15% of 80" and "15 percent of 80". The percent sign ALONE, with no
       * `of` after it, is not handled: "80 plus 15%" means "plus 15% of 80" to
       * a person and "plus 0.15" to a naive parser, and the two answers differ.
       * Ambiguous — so it falls through. */
      if (peek()?.t === 'pctof' || (peek()?.t === 'pct' && tokens[i + 1]?.t === 'of')) {
        i += peek().t === 'pctof' ? 1 : 2;
        const rhs = expr();
        if (!rhs) return null;
        return { k: 'pctof', a: node, b: rhs };
      }
      return node;
    }
  }

  function power() {
    const base = postfix();
    if (!base) return null;
    if (eat('op', '^')) {
      const e = unary(); // right associative: 2^3^2 is 2^(3^2)
      if (!e) return null;
      return { k: '^', a: base, b: e };
    }
    return base;
  }

  function unary() {
    if (eat('op', '-')) {
      const a = unary();
      return a && { k: 'neg', a };
    }
    return power();
  }

  function term() {
    let node = unary();
    if (!node) return null;
    for (;;) {
      const op = peek();
      if (op?.t === 'op' && (op.v === '*' || op.v === '/')) {
        i++;
        const rhs = unary();
        if (!rhs) return null;
        node = { k: op.v, a: node, b: rhs };
        continue;
      }
      return node;
    }
  }

  function expr() {
    let node = term();
    if (!node) return null;
    for (;;) {
      const op = peek();
      if (op?.t === 'op' && (op.v === '+' || op.v === '-')) {
        i++;
        const rhs = term();
        if (!rhs) return null;
        node = { k: op.v, a: node, b: rhs };
        continue;
      }
      return node;
    }
  }

  const tree = expr();
  return tree && i === tokens.length ? tree : null; // trailing junk is a refusal
}

/* ── Evaluation ──────────────────────────────────────────────────────────── */

/** A decimal literal as an exact rational: "2.5" is 25/10, not 2.5 the double. */
function numToRat(text) {
  const [whole, frac = ''] = text.split('.');
  return rat(BigInt(whole + frac), 10n ** BigInt(frac.length));
}

const TWO = { n: 2n, d: 1n };
const THREE = { n: 3n, d: 1n };
const HUNDRED = { n: 100n, d: 1n };

/** null propagates all the way out: one undefined sub-expression refuses the
 * whole message rather than being papered over with a zero or an Infinity. */
function evaluate(node) {
  switch (node.k) {
    case 'num': return numToRat(node.v);
    case 'paren': return evaluate(node.a);
    case 'neg': { const a = evaluate(node.a); return a && rat(-a.n, a.d); }
    case 'sq': { const a = evaluate(node.a); return a && pow(a, TWO); }
    case 'cu': { const a = evaluate(node.a); return a && pow(a, THREE); }
    case 'pctof': {
      const a = evaluate(node.a); const b = evaluate(node.b);
      if (!a || !b) return null;
      const frac = div(a, HUNDRED);
      return frac && mul(frac, b);
    }
    default: {
      const a = evaluate(node.a); const b = evaluate(node.b);
      if (!a || !b) return null;
      if (node.k === '+') return add(a, b);
      if (node.k === '-') return sub(a, b);
      if (node.k === '*') return mul(a, b);
      if (node.k === '/') return div(a, b); // null on /0 — the whole point
      if (node.k === '^') return pow(a, b);
      return null;
    }
  }
}

/* ── Rendering ───────────────────────────────────────────────────────────── */

const SUP = { 2: '²', 3: '³' };
const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 };

/** Parenthesise only where precedence demands it, so the echo reads the way a
 * person would write it: "2 + 3 × 4", not "(2 + (3 × 4))". */
function render(node, parentPrec = 0) {
  switch (node.k) {
    case 'num': return node.raw;
    case 'paren': return `(${render(node.a)})`;
    case 'neg': return `-${render(node.a, 3)}`;
    case 'sq': return `${render(node.a, 4)}²`;
    case 'cu': return `${render(node.a, 4)}³`;
    case 'pctof': return `${render(node.a, 4)}% of ${render(node.b)}`;
    case '^': {
      const exp = node.b.k === 'num' && SUP[node.b.raw] ? SUP[node.b.raw] : null;
      const body = exp ? `${render(node.a, 4)}${exp}` : `${render(node.a, 4)}^${render(node.b, 4)}`;
      return parentPrec > 4 ? `(${body})` : body;
    }
    default: {
      const sym = { '+': '+', '-': '-', '*': '×', '/': '÷' }[node.k];
      const p = PREC[node.k];
      const body = `${render(node.a, p)} ${sym} ${render(node.b, p + (node.k === '-' || node.k === '/' ? 1 : 0))}`;
      return parentPrec > p ? `(${body})` : body;
    }
  }
}

/**
 * The number as a person writes it.
 *
 * Exact when it can be — an integer prints whole however many digits it has
 * (21600³ is 10077696000000, never 1.0077696e+13), and a terminating fraction
 * prints in full (10 ÷ 4 is 2.5, not 2.50000000). Only a genuinely
 * non-terminating value is rounded, and when it is, it is marked with ≈ rather
 * than being passed off as exact. 100 ÷ 7 = 14.28571429 would be a lie; the
 * approximation sign is the difference between a calculator and a claim.
 */
const DECIMALS = 8;

function formatValue(r) {
  const neg = r.n < 0n;
  const n = neg ? -r.n : r.n;
  const sign = neg ? '-' : '';

  if (r.d === 1n) return sign + n.toString();

  const whole = n / r.d;
  let rem = n % r.d;
  let frac = '';
  let exact = false;
  for (let k = 0; k < DECIMALS; k++) {
    rem *= 10n;
    frac += (rem / r.d).toString();
    rem %= r.d;
    if (rem === 0n) { exact = true; break; }
  }

  /* Round the last digit rather than truncating: 2/3 is 0.66666667, not
   * 0.66666666. Half-up on the remainder, carried into the whole part when the
   * fraction is all nines. */
  let digits = frac;
  let carry = 0n;
  if (!exact && rem * 2n >= r.d) {
    const bumped = (BigInt(digits) + 1n).toString().padStart(digits.length, '0');
    if (bumped.length > digits.length) { carry = 1n; digits = bumped.slice(1); }
    else digits = bumped;
  }
  digits = digits.replace(/0+$/, '');
  const w = (whole + carry).toString();
  const body = digits ? `${w}.${digits}` : w;
  return { text: sign + body, exact };
}

/* ── The entry point ─────────────────────────────────────────────────────── */

/**
 * The message must be short. 200 characters is the same ceiling the router's
 * simple tier uses, and a genuine sum does not run longer; a long one is more
 * likely a word problem whose arithmetic is incidental to the question.
 */
const MAX_LENGTH = 200;

/**
 * @param {string} text the raw user message.
 * @returns {{expression: string, value: string, answer: string, exact: boolean}|null}
 *   null means NOT arithmetic — the caller must fall through to the council
 *   unchanged. Never throws: a parse failure is a null, not an exception, so a
 *   malformed message can never take the route down.
 */
function tryArithmetic(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim();
  if (!s || s.length > MAX_LENGTH) return null;

  s = fold(s);
  s = s.replace(/[?!.\s]+$/, '');          // trailing punctuation, never internal
  s = s.replace(OPENERS, '');
  s = s.replace(/^(?:is|are)\s+/i, '');    // "what is" already went; "is 2+2" reads oddly but parses
  s = s.replace(/\s*=\s*$/, '').replace(/\s+equals?$/i, '');
  if (!s) return null;

  const tokens = tokenize(s);
  if (!tokens || !tokens.length) return null;

  /* A bare number is not a computation. "what is 80" is a question about 80 —
   * possibly a very good one — and answering "80 = 80" would be a machine
   * mistaking a lookup for a sum. Require at least one operation. */
  if (!tokens.some((t) => ['op', 'sq', 'cu', 'pct', 'pctof'].includes(t.t))) return null;

  const tree = parse(tokens);
  if (!tree) return null;

  let value;
  try {
    value = evaluate(tree);
  } catch {
    return null; // BigInt can still throw on a pathological input; refuse, never 500
  }
  if (!value) return null;

  const formatted = formatValue(value);
  const isString = typeof formatted === 'string';
  const shown = isString ? formatted : formatted.text;
  const exact = isString ? true : formatted.exact;
  const expression = render(tree);

  return {
    expression,
    value: shown,
    exact,
    answer: `${expression} ${exact ? '=' : '≈'} ${shown}`,
  };
}

module.exports = { tryArithmetic };

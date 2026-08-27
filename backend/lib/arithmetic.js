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

const isInt = (r) => !isFloat(r) && r.d === 1n;

/* ── The second lane ─────────────────────────────────────────────────────── */
/*
 * TWO KINDS OF VALUE, AND THE DIFFERENCE IS VISIBLE IN THE ANSWER.
 *
 * A rational is `{n, d}`. A float is `{f}`. Everything above this comment stays
 * exact; sin, cos, tan, ln, exp and the roots that do not come out whole cannot
 * be, because their values are irrational — no pair of BigInts is sin(1).
 *
 * The alternative was to refuse them, which is what this module did until
 * 2026-08-13 and what its header still argues for in general. Refusing was the
 * right default while the grammar was four operators wide. It is the wrong one
 * for a calculator, because "sin 30" has an answer every pocket calculator has
 * given for fifty years and sending it to a council of language models to
 * approximate is worse in every dimension — slower, costlier, and less likely
 * to be right.
 *
 * WHAT KEEPS THIS HONEST is that a float NEVER claims to be exact. `=` is
 * reserved for the rational lane; anything that touches a float renders with
 * `≈`. The two lanes mix in one direction only — a rational is promoted to a
 * float when it meets one, never the reverse — so a single transcendental
 * anywhere in the expression marks the whole answer as approximate. That is the
 * correct reading: it IS approximate.
 *
 * A non-finite result is not a value. NaN and Infinity mean the input was
 * outside the function's domain (ln of a negative, asin of 2, tan at π/2 in
 * practice) or has overflowed the double. Both refuse, and refusing sends the
 * question to the council — which is the better answer to "what is ln(-1)"
 * anyway, because the real answer is a sentence about complex numbers.
 */

const isFloat = (v) => typeof v.f === 'number';

/** A float value, or null if the computation left the reals. */
const flt = (x) => (typeof x === 'number' && Number.isFinite(x) ? { f: x } : null);

/**
 * A value as a double, or null when it will not fit in one.
 *
 * A rational built from a thousand-digit numerator converts to Infinity, and
 * `Infinity / Infinity` is NaN — either way the guard catches it and the
 * expression refuses rather than reporting a number derived from nonsense.
 */
function toNum(v) {
  if (isFloat(v)) return v.f;
  const q = Number(v.n) / Number(v.d);
  return Number.isFinite(q) ? q : null;
}

/** Lift a binary float operation, refusing if either side will not convert. */
const fbin = (a, b, fn) => {
  const x = toNum(a);
  const y = toNum(b);
  return x === null || y === null ? null : flt(fn(x, y));
};

const exact2 = (a, b) => !isFloat(a) && !isFloat(b);

const add = (a, b) => (exact2(a, b) ? rat(a.n * b.d + b.n * a.d, a.d * b.d) : fbin(a, b, (x, y) => x + y));
const sub = (a, b) => (exact2(a, b) ? rat(a.n * b.d - b.n * a.d, a.d * b.d) : fbin(a, b, (x, y) => x - y));
const mul = (a, b) => (exact2(a, b) ? rat(a.n * b.n, a.d * b.d) : fbin(a, b, (x, y) => x * y));
const div = (a, b) => {
  if (exact2(a, b)) return b.n === 0n ? null : rat(a.n * b.d, a.d * b.n);
  const y = toNum(b);
  // Division by zero refuses in BOTH lanes. In the float lane it would
  // otherwise produce Infinity, which `flt` rejects — this is the explicit
  // version of the same refusal, kept explicit because it is the one failure
  // here that a user types on purpose.
  return y === 0 ? null : fbin(a, b, (x, yy) => x / yy);
};
const neg = (a) => (isFloat(a) ? flt(-a.f) : rat(-a.n, a.d));

/**
 * Powers. Exact when the exponent is a whole number, approximate otherwise.
 *
 * A fractional exponent (80^0.5) is irrational in general, so it takes the
 * float lane and renders with `≈`. It used to refuse outright; the comment that
 * stood here called an approximation "exactly the kind of quietly-wrong answer
 * the module exists to avoid", which is true of an approximation PRESENTED AS
 * EXACT and not of one marked as what it is. The mark is what makes the
 * difference, and the mark is enforced by the formatter, not by refusing.
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
  if (!isInt(exp) || isFloat(base)) {
    /* The float lane. `0 ** negative` is Infinity and `(-8) ** (1/3)` is NaN in
     * JavaScript; `flt` rejects both, so the domain holes refuse rather than
     * rendering a word where a number belongs. */
    return fbin(base, exp, (x, y) => x ** y);
  }
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

/* ── Exact answers that look like they need floats ───────────────────────── */

/**
 * The exact integer k-th root of a non-negative BigInt, or null if it has none.
 *
 * √16 IS 4, NOT 4.0000000. The float lane would compute `Math.sqrt(16)` and
 * mark it `≈`, which is a calculator apologising for a whole number — and the
 * ≈ then stops meaning anything, because it would appear on the answers that
 * are exact as often as on the ones that are not. So every root is tried
 * exactly first and only falls to the float lane when it genuinely has no
 * integer answer.
 *
 * Newton's method on BigInts, then VERIFIED by raising the result back. The
 * verification is the whole thing: Newton converges to a floor, so it returns
 * an answer for 17 as readily as for 16, and only `r**k === v` can tell those
 * apart. Seeded from the digit count rather than from v itself, because
 * `Number(v)` is Infinity for a large BigInt and a seed of Infinity does not
 * converge.
 */
function bigRoot(v, k) {
  if (v < 0n) return null;
  if (v < 2n) return v; // 0 and 1 are their own roots
  const bits = BigInt(v.toString(2).length);
  let x = 1n << (bits / k + 1n); // an over-estimate, which is where Newton wants to start
  for (;;) {
    const next = ((k - 1n) * x + v / x ** (k - 1n)) / k;
    if (next >= x) break;
    x = next;
  }
  return x ** k === v ? x : null;
}

/** A rational's exact k-th root: both terms must have one, since the fraction
 * is already in lowest terms and a root of a reduced fraction is the root of
 * each term. */
function exactRoot(v, k) {
  if (isFloat(v) || v.n < 0n) return null;
  const n = bigRoot(v.n, k);
  if (n === null) return null;
  const d = bigRoot(v.d, k);
  return d === null ? null : rat(n, d);
}

/**
 * Exact first, approximate second. `√16` is 4 and `√2` is ≈1.41421356.
 *
 * A NEGATIVE EVEN ROOT REFUSES rather than returning NaN through the float
 * lane, and the distinction matters to the user: "√-4" has an answer (2i) that
 * this module cannot express, and the council can say so.
 */
function nthRoot(v, k) {
  if (k < 2n || k > 64n) return null;
  const exact = exactRoot(v, k);
  if (exact) return exact;
  const x = toNum(v);
  if (x === null) return null;
  if (x < 0 && k % 2n === 0n) return null;
  // Math.cbrt-style sign handling: `(-8) ** (1/3)` is NaN, `-(8 ** (1/3))` is -2.
  return x < 0 ? flt(-((-x) ** (1 / Number(k)))) : flt(x ** (1 / Number(k)));
}

/**
 * Factorial, exact, integers only.
 *
 * The ceiling is on the ARGUMENT and not only on the result, because the result
 * guard runs after the multiplication. 1000! is 2568 digits and is refused
 * downstream by MAX_RESULT_DIGITS, but it has to be computed first to be
 * measured; 10000000! would not return at all. A thousand BigInt multiplies is
 * bounded work, so that is the line.
 */
function factorial(v) {
  if (!isInt(v) || v.n < 0n || v.n > 1000n) return null;
  let out = 1n;
  for (let i = 2n; i <= v.n; i++) out *= i;
  return rat(out);
}

/**
 * FLOORED modulo, so the result carries the divisor's sign: -7 mod 3 is 2.
 *
 * That is the number-theory convention and the one "mod" means when a person
 * writes it in a sentence. JavaScript's `%` truncates instead and would answer
 * -1, which is a different function with the same spelling. Integers only —
 * `7.5 mod 2` is defined but nobody means it, and the council can explain the
 * general form better than a bare number would.
 */
function mod(a, b) {
  if (!isInt(a) || !isInt(b) || b.n === 0n) return null;
  const r = ((a.n % b.n) + b.n) % b.n;
  return rat(r);
}

/** Whole-number operations, exact on a rational and pass-through on a float. */
const roundTo = (v, fn, bigFn) => {
  if (isFloat(v)) return flt(fn(v.f));
  if (isInt(v)) return v;
  return rat(bigFn(v.n, v.d));
};
// Floor division on BigInts truncates toward zero, so a negative quotient needs
// the extra step down. Ceiling is the mirror.
const bigFloor = (n, d) => (n < 0n && n % d !== 0n ? n / d - 1n : n / d);
const bigCeil = (n, d) => (n > 0n && n % d !== 0n ? n / d + 1n : n / d);

/**
 * THE FUNCTION TABLE. One entry per name the grammar accepts, and the table is
 * the whole vocabulary — a name absent here cannot be tokenised, so there is no
 * path by which an unknown function reaches evaluation.
 *
 * Trigonometry takes RADIANS, which is the mathematical convention and what
 * every programming language means by `sin`. Degrees are available and have to
 * be asked for: "sin 30 degrees", "sin(30°)". The echo says which was used —
 * `sin(30 rad)` versus `sin(30°)` — because a mode a calculator is silently in
 * is the oldest wrong-answer generator there is, and this module has no second
 * chance to be corrected.
 */
const fun1 = (v, fn) => {
  const x = toNum(v);
  return x === null ? null : flt(fn(x));
};

const FN = {
  sqrt: (v) => nthRoot(v, 2n),
  cbrt: (v) => nthRoot(v, 3n),

  sin: (v) => fun1(v, Math.sin),
  cos: (v) => fun1(v, Math.cos),
  tan: (v) => fun1(v, Math.tan),
  asin: (v) => fun1(v, Math.asin),
  acos: (v) => fun1(v, Math.acos),
  atan: (v) => fun1(v, Math.atan),
  sinh: (v) => fun1(v, Math.sinh),
  cosh: (v) => fun1(v, Math.cosh),
  tanh: (v) => fun1(v, Math.tanh),

  ln: (v) => fun1(v, Math.log),
  log: (v) => fun1(v, Math.log10), // "log" unqualified is base 10 outside a maths department
  log2: (v) => fun1(v, Math.log2),
  log10: (v) => fun1(v, Math.log10),
  exp: (v) => fun1(v, Math.exp),

  abs: (v) => (isFloat(v) ? flt(Math.abs(v.f)) : rat(v.n < 0n ? -v.n : v.n, v.d)),
  floor: (v) => roundTo(v, Math.floor, bigFloor),
  ceil: (v) => roundTo(v, Math.ceil, bigCeil),
  // Half-up, matching Math.round and matching what a person means by "round".
  round: (v) => roundTo(v, Math.round, (n, d) => bigFloor(2n * n + d, 2n * d)),
  sign: (v) => {
    const x = isFloat(v) ? Math.sign(v.f) : v.n < 0n ? -1 : v.n > 0n ? 1 : 0;
    return rat(BigInt(x));
  },
};

/** Constants. Irrational, so every one of them is a float and every expression
 * touching one renders with `≈` — π is 3.14159265, not 3.14159265 exactly. */
const CONST = {
  pi: Math.PI,
  tau: Math.PI * 2,
  e: Math.E,
};

/* ── Reading the message ─────────────────────────────────────────────────── */

/**
 * Openers that mean "compute this", stripped so the rest can be parsed as an
 * expression. Anchored and word-bounded: only a message that OPENS with one of
 * these is a computation request. "tell me what is wrong with 2 + 2" keeps its
 * prose and therefore fails to parse, which is the correct outcome.
 */
const OPENERS =
  /^(?:please\s+)?(?:can you\s+|could you\s+)?(?:tell me\s+)?(?:what(?:'|’)?s|what is|what are|whats|how much is|how much are|calculate|compute|solve|work out|evaluate)\s+/i;

/* A format instruction may follow a complete arithmetic question. It is
 * stripped only in this constrained suffix shape; arbitrary prose still makes
 * the whole parse fail and falls through to the council. */
const ANSWER_FORMAT_SUFFIX =
  /\?\s*(?:please\s+)?(?:answer|respond|reply|give|return)\s+(?:(?:with|using)\s+)?(?:just\s+)?(?:the\s+)?(?:number|result|answer)\s*[.!]*$/i;

/**
 * Word operators, longest first so "divided by" is consumed before "by" could
 * ever be looked at, and "to the power of" before "of".
 *
 * `of` is NOT here. It is only ever read as part of the percent form, in the
 * parser, where a percent literal precedes it. On its own, "of" is English.
 */
const WORD_OPS = [
  [/^raised to the power of\b/i, '^'],
  [/^to the (?:power|exponent) of\b/i, '^'],
  [/^raised to\b/i, '^'],
  [/^exponent of\b/i, '^'],
  [/^divided by\b/i, '/'],
  [/^multiplied by\b/i, '*'],
  [/^modulo\b/i, 'mod'],
  [/^mod\b/i, 'mod'],
  [/^over\b/i, '/'],
  [/^times\b/i, '*'],
  [/^plus\b/i, '+'],
  [/^minus\b/i, '-'],
];

/**
 * ORDINAL POWERS, which are how people say an exponent out loud.
 *
 * "2 to the 4th power" and "3 to the fourth power" both refused before this and
 * went to the council to compute 16. The pattern consumes the phrase AND the
 * exponent, because "to the" on its own leaves "4th power" behind and `th` is
 * not a token — the whole message would then refuse for a reason that has
 * nothing to do with what the user asked.
 */
const WORD_ORDINALS = {
  first: '1', second: '2', third: '3', fourth: '4', fifth: '5',
  sixth: '6', seventh: '7', eighth: '8', ninth: '9', tenth: '10',
  eleventh: '11', twelfth: '12', hundredth: '100',
};
const ORDINAL_POWER_RE =
  /^(?:raised\s+)?to\s+the\s+(\d{1,4})(?:st|nd|rd|th)?\s+power\b/i;
const WORD_ORDINAL_POWER_RE =
  new RegExp(`^(?:raised\\s+)?to\\s+the\\s+(${Object.keys(WORD_ORDINALS).join('|')})\\s+power\\b`, 'i');

/**
 * MULTIPLIER WORDS. "half of 60" is a multiplication by an exact rational, so
 * it stays in the exact lane and answers 30 rather than ≈30. `of` is consumed
 * here rather than left to the percent rule, which is the only other reader of
 * that word.
 */
const MULTIPLIER_WORDS = [
  [/^(?:a\s+)?half\s+of\b/i, '0.5'],
  [/^(?:a\s+)?quarter\s+of\b/i, '0.25'],
  [/^double\b/i, '2'],
  [/^twice\b/i, '2'],
  [/^triple\b/i, '3'],
  [/^quadruple\b/i, '4'],
];

/**
 * TYPO TOLERANCE FOR OPERATOR WORDS, and the length floor is the safety.
 *
 * Asked for on 2026-08-17 with the case that prompted it: "6 multipled by 8"
 * took a full council while "6 x 8" was answered locally in microseconds. The
 * words people mistype here are long ones — multiplied, divided, subtracted —
 * and a long word has room for an edit distance that no other word in the
 * vocabulary is within.
 *
 * NOTHING SHORTER THAN FIVE CHARACTERS IS FUZZY-MATCHED, and that rule is doing
 * real work: `and` is one edit from `add`, so "average of 4 and 10" would
 * otherwise tokenise as 4 + 10 and this module would confidently answer 14 to a
 * question it should have refused. Two- and three-letter operator words must be
 * spelled correctly or the message goes to the council, which is the safe
 * direction.
 *
 * A tie between two operators refuses. If a mistyped word is equally close to
 * `divided` and `dividend`, nobody knows which was meant, and guessing is the
 * one thing this module never does.
 */
const FUZZY_OPS = [
  ['multiplied', '*'], ['multiply', '*'], ['times', '*'], ['product', '*'],
  ['divided', '/'], ['divide', '/'], ['over', null],
  ['plus', null], ['minus', '-'], ['subtract', '-'], ['subtracted', '-'],
  ['modulo', 'mod'], ['squared', null], ['cubed', null],
].filter(([, op]) => op !== null);

/** Damerau-Levenshtein, bounded: it stops as soon as the distance exceeds the
 *  budget, because the only question ever asked here is "within k?". */
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let twoBack = null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      // One transposition is ONE edit: "mutliplied" is a swap, and a swap is the
      // most common typo shape there is. Plain Levenshtein charges two for it,
      // which puts it outside the budget for every word shorter than seven.
      if (i > 1 && j > 1 && twoBack && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, twoBack[j - 2] + 1);
      }
      row.push(v);
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
    twoBack = prev;
    prev = row;
  }
  return prev[b.length];
}

/** The operator a mistyped word unambiguously meant, or null. */
function fuzzyOperator(word) {
  const w = word.toLowerCase();
  if (w.length < 5) return null;
  const budget = w.length >= 7 ? 2 : 1;
  let best = null;
  let bestDistance = budget + 1;
  let tied = false;
  for (const [canonical, op] of FUZZY_OPS) {
    const d = editDistance(w, canonical, budget);
    if (d > budget) continue;
    if (d < bestDistance) { best = op; bestDistance = d; tied = false; }
    else if (d === bestDistance && op !== best) tied = true;
  }
  return tied ? null : best;
}

/**
 * FUNCTION NAMES, longest first, mapping every spelling a person uses onto one
 * key in `FN`. Longest-first is load bearing three times over: `cosh` before
 * `cos`, `log10` before `log`, and `square root of` before anything starting
 * `square`. Get the order wrong and `cosh 1` tokenises as cos, then dies on a
 * stray `h` — which at least refuses rather than answering the wrong function,
 * but only by luck.
 *
 * `\b` on every pattern, so `sin` does not match inside "sing" and `e` does not
 * match inside "exp".
 */
const FUNCTIONS = [
  [/^absolute value of\b/i, 'abs'],
  [/^square root of\b/i, 'sqrt'],
  [/^natural log(?:arithm)? of\b/i, 'ln'],
  [/^natural log(?:arithm)?\b/i, 'ln'],
  [/^cube root of\b/i, 'cbrt'],
  [/^square root\b/i, 'sqrt'],
  [/^factorial of\b/i, 'fact'],
  [/^cube root\b/i, 'cbrt'],
  [/^arcsin\b/i, 'asin'], [/^arccos\b/i, 'acos'], [/^arctan\b/i, 'atan'],
  [/^cosine\b/i, 'cos'], [/^tangent\b/i, 'tan'], [/^sine\b/i, 'sin'],
  [/^log10\b/i, 'log10'], [/^log2\b/i, 'log2'],
  [/^sinh\b/i, 'sinh'], [/^cosh\b/i, 'cosh'], [/^tanh\b/i, 'tanh'],
  [/^asin\b/i, 'asin'], [/^acos\b/i, 'acos'], [/^atan\b/i, 'atan'],
  [/^sqrt\b/i, 'sqrt'], [/^cbrt\b/i, 'cbrt'],
  [/^floor\b/i, 'floor'], [/^ceil(?:ing)?\b/i, 'ceil'], [/^round\b/i, 'round'],
  [/^sign\b/i, 'sign'], [/^abs\b/i, 'abs'], [/^exp\b/i, 'exp'],
  [/^sin\b/i, 'sin'], [/^cos\b/i, 'cos'], [/^tan\b/i, 'tan'],
  [/^log\b/i, 'log'], [/^ln\b/i, 'ln'],
];

/** Constants. `π` and `τ` are folded to their names before this runs. */
const CONSTANTS = [
  [/^tau\b/i, 'tau'],
  [/^pi\b/i, 'pi'],
  [/^e\b/, 'e'], // case-sensitive: `E` is exponent notation to too many people
];

/** Angle units. A bare trig argument is radians; these make it visible. */
const ANGLE_UNITS = [
  [/^degrees\b/i, 'deg'], [/^degree\b/i, 'deg'], [/^deg\b/i, 'deg'],
  [/^radians\b/i, 'rad'], [/^radian\b/i, 'rad'], [/^rad\b/i, 'rad'],
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
const FOLD = {
  '×': '*', '⋅': '*', '·': '*', '÷': '/', '−': '-', '–': '-', '—': '-', '％': '%', '，': ',',
  // Maths symbols a user pastes or types on a phone keyboard. Folded to the
  // spellings the tokeniser already knows rather than given cases of their own.
  '√': ' sqrt ', '∛': ' cbrt ', 'π': ' pi ', 'τ': ' tau ', '°': ' deg ',
};

/**
 * Superscripts, handled as a RUN rather than character by character.
 *
 * `2¹⁰` is two to the tenth. Folding each superscript on its own produces
 * `2^1^0`, which is (2^1)^0 = 1 — a wrong answer arrived at by a tidy-looking
 * substitution table, and one that would have shipped as `2^1^0 = 1` with the
 * echo showing an expression the user never wrote.
 */
const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const foldSuperscripts = (text) =>
  text.replace(new RegExp(`[${SUPERSCRIPT}]+`, 'g'), (run) =>
    `^${[...run].map((c) => SUPERSCRIPT.indexOf(c)).join('')}`);

function fold(text) {
  let out = '';
  for (const ch of foldSuperscripts(text)) {
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

    /* Postfix words. `factorial` is here as well as in the function table
     * because it is written both ways — "12 factorial" and "factorial of 12" —
     * and the negative lookahead is what keeps the two apart. Without it the
     * prefix form would tokenise as a postfix with nothing before it, then die
     * on the dangling `of`. */
    const word = /^(squared|cubed|percent of|percent|per cent|factorial(?! of))\b/i.exec(s);
    if (word) {
      const w = word[0].toLowerCase();
      tokens.push({
        t: w === 'squared' ? 'sq' : w === 'cubed' ? 'cu'
          : w === 'factorial' ? 'fact' : w === 'percent of' ? 'pctof' : 'pct',
      });
      s = s.slice(word[0].length);
      continue;
    }

    /* Angle units are POSTFIX and only mean anything after a value, so they are
     * matched before the constant table — otherwise `deg` would be read as
     * nothing at all and `radians` would die on the leading `r`. */
    let matched = false;
    for (const [re, unit] of ANGLE_UNITS) {
      const m = re.exec(s);
      if (m) { tokens.push({ t: unit }); s = s.slice(m[0].length); matched = true; break; }
    }
    if (matched) continue;

    for (const [re, name] of FUNCTIONS) {
      const m = re.exec(s);
      if (m) { tokens.push({ t: 'fn', v: name }); s = s.slice(m[0].length); matched = true; break; }
    }
    if (matched) continue;

    for (const [re, name] of CONSTANTS) {
      const m = re.exec(s);
      if (m) {
        /* IMPLICIT MULTIPLICATION, and only here. "2π" and "2 pi" mean twice pi
         * to everyone who writes them, and there is no other reading — a digit
         * cannot be juxtaposed with a constant for any other purpose.
         *
         * It is NOT extended to "2(3+4)" or "2 sin 1". Those are equally
         * conventional in a textbook and much less safe in a chat box, where the
         * bracket is as likely to be an aside as a factor. One narrow case that
         * users hit constantly beats a general rule that guesses. */
        if (tokens[tokens.length - 1]?.t === 'num') tokens.push({ t: 'op', v: '*' });
        tokens.push({ t: 'const', v: name });
        s = s.slice(m[0].length);
        matched = true;
        break;
      }
    }
    if (matched) continue;

    /* Ordinal powers, before WORD_OPS, because "to the 4th power" starts with
     * the same three words as "to the power of" and the shorter rule would
     * consume "to the" and leave "4th" behind. */
    const ordinalPower = ORDINAL_POWER_RE.exec(s) || WORD_ORDINAL_POWER_RE.exec(s);
    if (ordinalPower) {
      const exponent = WORD_ORDINALS[ordinalPower[1].toLowerCase()] || ordinalPower[1];
      // `raw` is the NUMERAL, not the word: it is what gets echoed back in the
      // rendered expression, and "3^fourth = 81" is not an expression.
      tokens.push({ t: 'op', v: '^' }, { t: 'num', v: exponent, raw: exponent });
      s = s.slice(ordinalPower[0].length);
      continue;
    }

    /* "half of 60", "double 21". A multiplier word is a number and a product,
     * and it only ever appears where a number could — juxtaposing it after a
     * value ("60 double") is not English and is not accepted. */
    for (const [re, factor] of MULTIPLIER_WORDS) {
      const m = re.exec(s);
      if (!m) continue;
      if (tokens.length) { matched = null; break; }  // not an opener: refuse the whole message
      // Rendered as the factor it is — "0.5 × 60 = 30" — because echoing the
      // phrase produces "half of × 60", which reads as a parse error.
      tokens.push({ t: 'num', v: factor, raw: factor }, { t: 'op', v: '*' });
      s = s.slice(m[0].length);
      matched = true;
      break;
    }
    if (matched === null) return null;
    if (matched) continue;

    for (const [re, op] of WORD_OPS) {
      const m = re.exec(s);
      if (m) { tokens.push({ t: 'op', v: op }); s = s.slice(m[0].length); matched = true; break; }
    }
    if (matched) continue;

    /* THE MISSPELLED OPERATOR, resolved only when it is unambiguous. A trailing
     * "by" is consumed with it so "6 multipled by 8" and the imperative "6
     * divide by 3" both work — every canonical two-word form above already
     * carries its own "by". */
    const maybeMisspelled = /^[a-z]+/i.exec(s);
    if (maybeMisspelled) {
      const op = fuzzyOperator(maybeMisspelled[0]);
      if (op) {
        tokens.push({ t: 'op', v: op });
        s = s.slice(maybeMisspelled[0].length).replace(/^\s+by\b/i, '');
        continue;
      }
    }

    /* `x` AS MULTIPLICATION, and only where it cannot be anything else.
     *
     * "185 x 3" is how most people type a product, and it was refused — the
     * message went to the council, which is the exact waste this module exists
     * to stop. It is accepted only directly after a completed value, so the `x`
     * of an algebra question ("solve for x", "2x + 1") never reaches it: those
     * have no value to its left, or have a letter to its right that no rule
     * here can tokenise. */
    const prev = tokens[tokens.length - 1]?.t;
    if (/^x\b/i.test(s) && ['num', ')', 'sq', 'cu', 'fact', 'deg', 'rad', 'const'].includes(prev)) {
      tokens.push({ t: 'op', v: '*' });
      s = s.slice(1);
      continue;
    }

    const ch = s[0];
    if ('+-*/^'.includes(ch)) { tokens.push({ t: 'op', v: ch }); s = s.slice(1); continue; }
    if (ch === '%') { tokens.push({ t: 'pct' }); s = s.slice(1); continue; }
    if (ch === '!') { tokens.push({ t: 'fact' }); s = s.slice(1); continue; }
    if (ch === '(' || ch === ')') { tokens.push({ t: ch }); s = s.slice(1); continue; }
    if (/^of\b/i.test(s)) { tokens.push({ t: 'of' }); s = s.slice(2); continue; }

    return null; // one unknown character is enough to hand the whole message back
  }
  return tokens;
}

/* ── The grammar ─────────────────────────────────────────────────────────── */
/*
 * expr    := term (('+' | '-') term)*
 * term    := unary (('*' | '/' | 'mod') unary)*
 * unary   := '-' unary | power
 * power   := postfix ('^' unary)?          — right associative, as in maths
 * postfix := primary ('squared' | 'cubed' | '!' | '°' | 'rad' | '%' 'of' term)*
 * primary := number | constant | fn power | '(' expr ')'
 *
 * A FUNCTION'S ARGUMENT IS A `power`, NOT A `term`, so "sin 30 + 2" is
 * sin(30) + 2 and "sqrt 16 x 3" is sqrt(16) x 3 = 12. That is how both read
 * aloud. It also means "sin 2^2" is sin(4) rather than sin(2)², which pocket
 * calculators disagree about — so the echo parenthesises every function call,
 * and a user who meant the other one can see that they did not get it.
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
    const f = eat('fn');
    if (f) {
      /* `unary`, not `power`, so a negative argument works: "abs -5" is 5 and
       * refused outright while the argument had to start with a value. It still
       * stops short of `term`, so "sqrt 16 + 9" is 13 rather than sqrt(25). */
      const arg = unary();
      return arg && { k: 'fn', v: f.v, a: arg };
    }
    const c = eat('const');
    if (c) return { k: 'const', v: c.v };
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
      if (eat('fact')) { node = { k: 'fact', a: node }; continue; }
      if (eat('deg')) { node = { k: 'deg', a: node }; continue; }
      if (eat('rad')) { node = { k: 'rad', a: node }; continue; }
      /* "15% of 80" and "15 percent of 80". The percent sign ALONE, with no
       * `of` after it, is not handled: "80 plus 15%" means "plus 15% of 80" to
       * a person and "plus 0.15" to a naive parser, and the two answers differ.
       * Ambiguous — so it falls through.
       *
       * THE RIGHT OPERAND IS A `term`, NOT AN `expr`, and the difference is a
       * wrong answer. Parsing it as a full expression made "of" swallow
       * everything after it: `15% of 80 + 2` computed 15% of (80 + 2) = 12.3
       * where a person means (15% of 80) + 2 = 14. Worse, the echo rendered as
       * "15% of 80 + 2", which is exactly what the user typed, so the misgrouping
       * was invisible in the one place designed to reveal it. Binding at `term`
       * gives "of" the same reach as multiplication, which is how it reads
       * aloud. */
      if (peek()?.t === 'pctof' || (peek()?.t === 'pct' && tokens[i + 1]?.t === 'of')) {
        i += peek().t === 'pctof' ? 1 : 2;
        const rhs = term();
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
      if (op?.t === 'op' && (op.v === '*' || op.v === '/' || op.v === 'mod')) {
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
    case 'const': return flt(CONST[node.v]);
    case 'paren': return evaluate(node.a);
    case 'neg': { const a = evaluate(node.a); return a && neg(a); }
    case 'sq': { const a = evaluate(node.a); return a && pow(a, TWO); }
    case 'cu': { const a = evaluate(node.a); return a && pow(a, THREE); }
    case 'fact': { const a = evaluate(node.a); return a && factorial(a); }
    case 'fn': { const a = evaluate(node.a); return a && (node.v === 'fact' ? factorial(a) : FN[node.v](a)); }
    // Degrees enter the float lane by construction: the conversion multiplies
    // by π/180 and π is irrational, so 30° is not a rational number of radians.
    case 'rad': return evaluate(node.a);
    case 'deg': {
      const a = evaluate(node.a);
      if (!a) return null;
      const x = toNum(a);
      return x === null ? null : flt((x * Math.PI) / 180);
    }
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
      if (node.k === 'mod') return mod(a, b);
      if (node.k === '^') return pow(a, b);
      return null;
    }
  }
}

/* ── Rendering ───────────────────────────────────────────────────────────── */

const SUP = { 2: '²', 3: '³' };
const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, mod: 2, '^': 4 };
const CONST_SYMBOL = { pi: 'π', tau: 'τ', e: 'e' };

/** The functions whose answer depends on an angle unit the user may not have
 * stated. Their echo says which unit was used; every other function's does not,
 * because there is nothing to be in the wrong mode about. */
const ANGULAR = new Set(['sin', 'cos', 'tan', 'sinh', 'cosh', 'tanh']);

/**
 * Does this argument already say what unit it is in?
 *
 * DESCENDS THROUGH SIGN AND BRACKETS, because "sin -30 degrees" parses as
 * neg(deg(30)) — the minus is outermost — and a test on the outermost node
 * alone rendered it `sin(-30° rad)`, an expression naming two units at once.
 * It does NOT descend into an operator: "sin(30° + 1)" is genuinely mixed, and
 * the honest echo for that is the one that says so.
 */
const statesAngle = (node) =>
  ['deg', 'rad'].includes(node.k) ||
  (['neg', 'paren'].includes(node.k) && statesAngle(node.a));

/** The base of an exponent, wrapped when it is itself an exponent — see the
 * `sq`/`cu`/`^` cases below for why juxtaposed superscripts lie. */
const powBase = (node) =>
  ['sq', 'cu', '^'].includes(node.k) ? `(${render(node)})` : render(node, 4);

/** Parenthesise only where precedence demands it, so the echo reads the way a
 * person would write it: "2 + 3 × 4", not "(2 + (3 × 4))". */
function render(node, parentPrec = 0) {
  switch (node.k) {
    case 'num': return node.raw;
    case 'paren': return `(${render(node.a)})`;
    case 'neg': return `-${render(node.a, 3)}`;
    /* A POWER WHOSE BASE IS ITSELF A POWER MUST BE PARENTHESISED, because
     * superscripts juxtapose into a different number. `2 squared^3` is (2²)³ =
     * 64, and rendering it "2²³" reads as 2²³ = 2^23, which is 8388608 — the
     * echo would have shown a true answer beside a false equation, which is
     * worse than showing nothing. */
    case 'sq': return `${powBase(node.a)}²`;
    case 'cu': return `${powBase(node.a)}³`;
    case 'pctof': return `${render(node.a, 4)}% of ${render(node.b, 2)}`;
    case 'const': return CONST_SYMBOL[node.v];
    // Factorial binds tighter than anything, so a compound argument has to be
    // wrapped: `(2 + 3)!` is 120 and `2 + 3!` is 8.
    case 'fact': return `${render(node.a, 5)}!`;
    case 'deg': return `${render(node.a, 5)}°`;
    case 'rad': return `${render(node.a)} rad`;
    /* ALWAYS PARENTHESISED, and for a trig call always carrying its unit.
     *
     * "sin 30" is 30 RADIANS here, as it is in every programming language and
     * every calculator in RAD mode — and it is -0.988, not the 0.5 most people
     * expect. The mode a calculator is silently in is the oldest wrong-answer
     * generator there is, so the echo names it: `sin(30 rad) ≈ -0.98803162`
     * shows a user who meant degrees exactly what to type instead. */
    case 'fn': {
      /* The call's own brackets are the ones that show, so a parenthesised
       * argument is unwrapped rather than doubled — `cos(0)`, never `cos((0))`.
       * Unwrapping before the unit test matters too: `cos(30 degrees)` parses
       * with the `deg` node INSIDE a paren, and testing the paren's own kind
       * would have stamped "rad" onto an expression that plainly says degrees. */
      const inner = node.a.k === 'paren' ? node.a.a : node.a;
      // "factorial of 5" and "5!" are one operation and get one rendering.
      if (node.v === 'fact') return `${render(inner, 5)}!`;
      return `${node.v}(${render(inner)}${ANGULAR.has(node.v) && !statesAngle(inner) ? ' rad' : ''})`;
    }
    case '^': {
      const exp = node.b.k === 'num' && SUP[node.b.raw] ? SUP[node.b.raw] : null;
      const body = exp ? `${powBase(node.a)}${exp}` : `${powBase(node.a)}^${render(node.b, 4)}`;
      return parentPrec > 4 ? `(${body})` : body;
    }
    default: {
      const sym = { '+': '+', '-': '-', '*': '×', '/': '÷', mod: 'mod' }[node.k];
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

/**
 * How far to look for an exact ending before giving up and rounding.
 *
 * A terminating decimal can be much longer than the eight places anyone wants
 * to read: 1/512 is exactly 0.001953125, and stopping at eight digits rounded
 * it to 0.00195313 and stamped it ≈ — an approximation sign on a number that
 * has an exact form, which is the opposite of the honesty this formatter is
 * for. So the expansion runs to 30 places looking for a clean end, and only a
 * value that has not terminated by then is rounded to DECIMALS and marked.
 *
 * 30 rather than unbounded because a denominator of 2^100 terminates too, after
 * a hundred digits nobody wants; past 30 the exact form has stopped being more
 * useful than the rounded one.
 */
const EXACT_SCAN = 30;

function formatValue(r) {
  /* THE FLOAT LANE IS NEVER EXACT, whatever it prints. `cos(0)` is 1 and this
   * renders it "≈ 1", which is pedantic and is the right way round to be wrong:
   * the only alternative is a table of the arguments at which each transcendental
   * function happens to be rational, and a table like that is a list of the cases
   * somebody remembered. `≈` on a true 1 costs a character. `=` on a rounded
   * value is a false claim, and this module's whole contract is that `=` means
   * exact. */
  if (isFloat(r)) {
    const fixed = r.f.toFixed(DECIMALS);
    const text = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
    return { text, exact: false };
  }

  const neg = r.n < 0n;
  const n = neg ? -r.n : r.n;
  const sign = neg ? '-' : '';

  if (r.d === 1n) return sign + n.toString();

  const whole = n / r.d;
  let rem = n % r.d;
  let frac = '';
  let exact = false;
  for (let k = 0; k < EXACT_SCAN; k++) {
    rem *= 10n;
    frac += (rem / r.d).toString();
    rem %= r.d;
    if (rem === 0n) { exact = true; break; }
  }

  /* Not exact within the scan: fall back to the readable ceiling, recomputing
   * the remainder that DECIMALS digits would have left so the rounding below
   * still asks the right question. */
  if (!exact && frac.length > DECIMALS) {
    frac = frac.slice(0, DECIMALS);
    rem = n % r.d;
    for (let k = 0; k < DECIMALS; k++) { rem = (rem * 10n) % r.d; }
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
 * The message must be short. A genuine sum does not run long; a long one is
 * more likely a word problem whose arithmetic is incidental to the question.
 *
 * 300 rather than the router's 200, because the grammar now spells things out:
 * "the square root of 144 plus the natural logarithm of 20 divided by 3" is 68
 * characters of English for 24 characters of symbols, and the word forms are
 * the ones a person types on a phone. The ceiling still exists — it bounds
 * tokenising and parsing work on a hostile string — it is just no longer set to
 * a width the supported grammar can exceed by being written out.
 */
const MAX_LENGTH = 300;

/**
 * A float too large or too small to print without exponent notation.
 *
 * `1e21` renders as "1e+21" from toFixed, and this module's whole output
 * contract is a number a person reads. Below 1e-8 everything rounds to "0" at
 * DECIMALS places, which the zero guard further down already refuses — this
 * bound refuses it earlier and for a stated reason.
 */
const FLOAT_MAX = 1e15;

/**
 * STRINGS THAT ARE NOT SUMS, however arithmetic they look to a tokeniser.
 *
 * `2026-08-13` parsed as 2026 − 8 − 13 and answered 2005. `2026/08/13` answered
 * 19.48. `555-0100` answered 455. Every one of those is a date or an identifier
 * a person typed to ASK ABOUT, and the fast path took it as a calculation and
 * skipped the council entirely — the exact false-positive failure this module's
 * header promises not to have, found by Sol in review rather than by a user.
 *
 * Two rules, because one is not enough:
 *
 * `DATE_LIKE` — three number groups joined by `-` or `/` with no spaces is a
 * date in every convention there is, and nobody writes a subtraction that way.
 *
 * A LEADING ZERO on any operand means the digits are a LABEL, not a quantity:
 * `08` in a date, `0100` in a phone number, `007`. Arithmetic does not write
 * numbers that way, so the zero is evidence about what the string is FOR.
 */
const DATE_LIKE = /^\s*\d{1,4}\s*[-/]\s*\d{1,2}\s*[-/]\s*\d{1,4}\s*$/;
const LEADING_ZERO = /(^|[^\d.])0\d/;

/**
 * "MINUS THREE SQUARED" IS TWO DIFFERENT NUMBERS, so it gets neither.
 *
 * Written as symbols, `-3^2` is -9 and every calculator agrees: the exponent
 * binds tighter than the sign. Said in WORDS, "negative three squared" is what
 * most people say when they mean (-3)² = 9. The symbolic form keeps the
 * mathematical convention, because the person who typed `^` is working in
 * symbols; the word form is genuinely ambiguous and this module's rule for
 * ambiguity is to say nothing and let the council explain the distinction —
 * which is a better answer to that question than either number alone.
 *
 * Parenthesise and it computes: `(-3) squared` is 9, `-(3 squared)` is -9.
 */
function hasAmbiguousNegativePower(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.k === 'neg' && (node.a?.k === 'sq' || node.a?.k === 'cu')) return true;
  return hasAmbiguousNegativePower(node.a) || hasAmbiguousNegativePower(node.b);
}

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
  s = s.replace(ANSWER_FORMAT_SUFFIX, '');
  /* Trailing punctuation, never internal — and `!` only when it cannot be a
   * factorial. "5!" is a computation; "5 + 5!" is excitement to one reader and
   * 125 to another, and the digit before the mark is the only signal there is.
   * So a `!` directly after a value STAYS and means factorial, and one after a
   * word or a space is punctuation and goes. A user who meant to shout has
   * written a sum with an exclamation mark, and gets the mathematician's
   * reading; the echo shows `5 + 5!` so the misread is at least visible. */
  s = s.replace(/[?.\s]+$/, '');
  s = s.replace(/(?<![\d)])!+\s*$/, '');
  s = s.replace(/[?.\s]+$/, '');
  s = s.replace(OPENERS, '');
  s = s.replace(/^(?:is|are)\s+/i, '');    // "what is" already went; "is 2+2" reads oddly but parses
  s = s.replace(/\s*=\s*$/, '').replace(/\s+equals?$/i, '');
  if (!s) return null;

  if (DATE_LIKE.test(s) || LEADING_ZERO.test(s)) return null;

  const tokens = tokenize(s);
  if (!tokens || !tokens.length) return null;

  /* A bare number is not a computation. "what is 80" is a question about 80 —
   * possibly a very good one — and answering "80 = 80" would be a machine
   * mistaking a lookup for a sum. Require at least one operation. */
  /* `const` is deliberately NOT in this list. "what is pi" is a lookup, and
   * "π ≈ 3.14159265" is a worse answer than the sentence the council writes
   * about what π is. `fn` and `fact` ARE computations on their own — "sqrt 16"
   * asks for a number and nothing else. */
  if (!tokens.some((t) => ['op', 'sq', 'cu', 'pct', 'pctof', 'fn', 'fact'].includes(t.t))) return null;

  const tree = parse(tokens);
  if (!tree) return null;
  if (hasAmbiguousNegativePower(tree)) return null;

  let value;
  try {
    value = evaluate(tree);
  } catch {
    return null; // BigInt can still throw on a pathological input; refuse, never 500
  }
  if (!value) return null;

  /* THE WHOLE RESULT, not each power in isolation. `pow` bounds what any one
   * exponent may produce, and 33 copies of `9^999` multiplied together fit
   * inside a 197-character message and inside every individual ceiling — Sol
   * got a 31,459-digit answer out of it. Fast, but an answer nobody asked for
   * measured in tens of kilobytes, streamed to the client and written to the
   * logs. The bound has to be on what leaves the function. */
  if (isFloat(value)) {
    if (Math.abs(value.f) >= FLOAT_MAX) return null;
  } else if (String(value.n).length > MAX_RESULT_DIGITS || String(value.d).length > MAX_RESULT_DIGITS) {
    return null;
  }

  const formatted = formatValue(value);
  const isString = typeof formatted === 'string';
  const shown = isString ? formatted : formatted.text;
  const exact = isString ? true : formatted.exact;

  /* A non-zero value that rounds to zero has nothing useful to show. "-1 ÷
   * 3000000000 ≈ -0" is a worse answer than no answer, and "-0" is not a number
   * anyone writes. The council can explain the magnitude instead. */
  if (!exact && /^-?0$/.test(shown)) return null;

  const expression = render(tree);

  return {
    expression,
    value: shown,
    exact,
    answer: `${expression} ${exact ? '=' : '≈'} ${shown}`,
  };
}

module.exports = { tryArithmetic };

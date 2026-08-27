const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { tryArithmetic } = require('./arithmetic');

/**
 * THE CONTRACT UNDER TEST, in one line: this module answers a sum or says
 * nothing. The dangerous direction is a false positive — a message it computes
 * that a person meant as a question — because there is no model downstream to
 * disagree with it. Most of what follows therefore asserts null.
 *
 * The adversarial cases came from Luna, who was asked to break the design
 * before it was written rather than to review it afterwards. Each one is
 * labelled with what a naive implementation returns, because that is the
 * failure this test exists to catch, and without it the assertion reads as
 * arbitrary six months from now.
 */

const answer = (s) => tryArithmetic(s)?.answer ?? null;

test('the shapes the owner asked for', async (t) => {
  await t.test('80 squared', () => assert.equal(answer('80 squared'), '80² = 6400'));
  await t.test('21600 cubed, exact and not scientific', () =>
    assert.equal(answer('21600 cubed'), '21600³ = 10077696000000'));
  await t.test('15% of 80', () => assert.equal(answer('15% of 80'), '15% of 80 = 12'));
  await t.test('80^2', () => assert.equal(answer('80^2'), '80² = 6400'));
  await t.test('what is 12 times 4', () => assert.equal(answer('what is 12 times 4'), '12 × 4 = 48'));
  await t.test('what is 15% of 80', () => assert.equal(answer('what is 15% of 80'), '15% of 80 = 12'));
  await t.test('15 * 80', () => assert.equal(answer('15 * 80'), '15 × 80 = 1200'));
  await t.test('12 + 34', () => assert.equal(answer('12 + 34'), '12 + 34 = 46'));
  await t.test('100 divided by 7', () => assert.equal(answer('100 divided by 7'), '100 ÷ 7 ≈ 14.28571429'));
  await t.test('whats 21600 cubed — the contraction the router itself misses', () =>
    assert.equal(answer('whats 21600 cubed'), '21600³ = 10077696000000'));
});

test('division', async (t) => {
  /* A reasonable decimal, and marked as an approximation when it is one. The
   * = / ≈ distinction is the difference between a calculator and a claim. */
  await t.test('100 / 7 is approximate and says so', () =>
    assert.equal(answer('100 / 7'), '100 ÷ 7 ≈ 14.28571429'));
  await t.test('an exact division does not print padding zeroes', () =>
    assert.equal(answer('10 / 4'), '10 ÷ 4 = 2.5'));
  await t.test('an exact whole division prints whole', () =>
    assert.equal(answer('100 / 4'), '100 ÷ 4 = 25'));
  await t.test('1/3 rounds the last digit rather than truncating', () =>
    assert.equal(answer('1 / 3'), '1 ÷ 3 ≈ 0.33333333'));
  await t.test('2/3 rounds up, which truncation would get wrong', () =>
    assert.equal(answer('2 / 3'), '2 ÷ 3 ≈ 0.66666667'));
  /* Naive: Infinity, ∞, or a throw. All three would reach the user. */
  await t.test('division by zero falls through, never Infinity', () =>
    assert.equal(tryArithmetic('100 / 0'), null));
  await t.test('division by zero inside a larger sum falls through too', () =>
    assert.equal(tryArithmetic('5 + 100 / 0'), null));
});

test('exactness — where floats would lie', async (t) => {
  /* Naive: 0.30000000000000004, shipped to the user as the answer. */
  await t.test('0.1 + 0.2 is exactly 0.3', () => assert.equal(answer('0.1 + 0.2'), '0.1 + 0.2 = 0.3'));
  await t.test('a decimal square is exact', () => assert.equal(answer('2.5 squared'), '2.5² = 6.25'));
  await t.test('a big power is exact to the last digit', () => {
    const got = tryArithmetic('2^100');
    assert.equal(got.value, (2n ** 100n).toString());
    assert.equal(got.exact, true);
  });
  await t.test('21600 cubed matches BigInt exactly', () =>
    assert.equal(tryArithmetic('21600 cubed').value, (21600n ** 3n).toString()));
});

test('precedence and unary minus', async (t) => {
  /* Naive: 20, by evaluating left to right. The most common shape there is. */
  await t.test('2 + 3 * 4 is 14, not 20', () => assert.equal(answer('2 + 3 * 4'), '2 + 3 × 4 = 14'));
  await t.test('parentheses override it', () => assert.equal(answer('(2 + 3) * 4'), '(2 + 3) × 4 = 20'));
  await t.test('10 - -3 is 13', () => assert.equal(answer('10 - -3'), '10 - -3 = 13'));
  /* -3^2 is -9 in ordinary mathematical convention: the exponent binds tighter
   * than the unary minus. Luna flagged this as ambiguous and worth refusing;
   * it is answered instead, deliberately, because every calculator and CAS
   * agrees on -9 and the parenthesised form is available to anyone who means
   * the other thing. The next line is the one that would break if that
   * convention were ever quietly changed. */
  await t.test('-3^2 is -9, the exponent binding tighter than the minus', () =>
    assert.equal(answer('-3^2'), '-3² = -9'));
  await t.test('(-3)^2 is 9', () => assert.equal(answer('(-3)^2'), '(-3)² = 9'));
  await t.test('(-8) cubed keeps its sign', () => assert.equal(answer('(-8) cubed'), '(-8)³ = -512'));
  await t.test('^ is right associative', () => assert.equal(answer('2^3^2'), '2^3² = 512'));
  await t.test('a negative exponent is exact, not a float', () =>
    assert.equal(answer('2^-1'), '2^-1 = 0.5'));
});

test('the traps — arithmetic-shaped messages that are NOT sums', async (t) => {
  const fallsThrough = {
    /* Naive: 6400, and the question about France is silently dropped. */
    'partial matching': '80 squared and what is the capital of France',
    /* Naive: 12. It is a reasoning question with arithmetic inside it. */
    'a why-question containing arithmetic': 'why is 15% of 80 the same as 80% of 15',
    /* Naive: 4, ignoring the half of the request that is the actual work. */
    'a requested representation': 'what is 2 + 2 in binary',
    /* Naive: 12. A person means 68 — the discounted price. */
    'percent OFF is not percent OF': '15% off 80',
    /* Naive: 92 or 95. The base of the percentage is not stated. */
    'a percentage with no stated base': '80 plus 15%',
    /* Naive: 15%, with the expression rendered backwards. */
    'solving for the percentage': 'what percent of 80 is 12',
    /* Naive: parses "5 minus ..." and stops at the prose. */
    'minus used as English': 'what is 5 minus the point of this',
    /* Naive: 6400. "squared metres" is a unit, not an operation. */
    'a unit that reads like an operator': '80 squared metres of carpet',
    /* Naive: 12, silently dropping the kilograms. */
    'a unit on the operand': 'what is 15% of 80 kg',
    /* Naive: 60, with the currency thrown away. */
    'currency': '$15 * 4',
    'implicit multiplication': '2(3 + 4)',
    'programming syntax is not this grammar': '2**3',
    'a European decimal comma': '1.000,50 + 1',
    'spaces as digit grouping': '1 000 + 1',
    'a bare number is not a computation': 'what is 80',
    'a bare number': '42',
    'empty': '   ',
    /* Convention-dependent, so the council gets to explain rather than this
     * module getting to assert. */
    '0^0': '0^0',
    '0^-1': '0^-1',
    /* Outside every function's domain. Each of these has an answer that is a
     * SENTENCE — a complex number, a limit, "undefined" — and a bare number
     * would be the wrong shape of reply even if one existed. */
    'the square root of a negative': 'sqrt -4',
    'the log of a negative': 'ln -1',
    'a bare constant': 'what is pi',
    'a constant with no operation': 'tau',
    'a word problem belongs to the model': 'A box has 17 apples and 3 are removed. How many remain?',
  };

  /* `'a fractional exponent': '80^0.5'` and `'a square root request': 'square
   * root of 80'` USED TO BE IN THIS LIST, and their removal is the point of the
   * 2026-08-13 widening rather than an oversight. The rule they encoded — this
   * module deals only in exact values, so anything irrational falls through —
   * was right while the grammar was four operators wide and wrong for a
   * calculator. What made it safe to reverse is the float lane's contract: an
   * approximation is never rendered with `=`. See the block below. */

  for (const [name, input] of Object.entries(fallsThrough)) {
    await t.test(name, () => assert.equal(tryArithmetic(input), null, `${JSON.stringify(input)} should fall through`));
  }
});

/**
 * EVERY ONE OF THESE SHIPPED, and Sol found them reviewing the diff after it
 * landed. They are grouped rather than scattered because what they have in
 * common is the lesson: the parser was right about arithmetic and wrong about
 * which strings ARE arithmetic, and about how to write down what it computed.
 */
test('the defects review found in the first version', async (t) => {
  await t.test('percent-of binds like multiplication, not to the end of the line', () => {
    /* Was: 15% of (80 + 2) = 12.3, echoed as "15% of 80 + 2" — the misgrouping
     * invisible in the very line meant to reveal it. */
    assert.equal(answer('15% of 80 + 2'), '15% of 80 + 2 = 14');
    assert.equal(answer('15% of 80 * 2'), '15% of 80 × 2 = 24');
  });

  await t.test('a date is not a subtraction', () => {
    /* Was: 2026 - 08 - 13 = 2005. */
    assert.equal(tryArithmetic('2026-08-13'), null);
    assert.equal(tryArithmetic('2026/08/13'), null);
    assert.equal(tryArithmetic('13-08-2026'), null);
    assert.equal(tryArithmetic('what is 2026-08-13'), null);
  });

  await t.test('a leading zero means the digits are a label, not a quantity', () => {
    /* Was: 555 - 0100 = 455. */
    assert.equal(tryArithmetic('555-0100'), null);
    assert.equal(tryArithmetic('007 + 1'), null);
    /* But a real decimal below one still computes — the zero there is a value. */
    assert.equal(answer('0.5 + 0.25'), '0.5 + 0.25 = 0.75');
    assert.equal(answer('0 + 1'), '0 + 1 = 1');
  });

  await t.test('a power raised to a power is parenthesised, never juxtaposed', () => {
    /* Was: "2²³ = 64" — a true answer beside a false equation, since 2²³ reads
     * as 2^23 = 8388608. */
    assert.equal(answer('2 squared^3'), '(2²)³ = 64');
    assert.equal(answer('2 squared squared'), '(2²)² = 16');
    assert.equal(answer('2^3^2'), '2^3² = 512');
  });

  await t.test('a long but exact decimal prints exactly, and says =', () => {
    /* Was: "1 ÷ 512 ≈ 0.00195313" — an approximation sign on an exact number. */
    assert.equal(answer('1 / 512'), '1 ÷ 512 = 0.001953125');
    assert.equal(answer('-1 / 1000000000'), '-1 ÷ 1000000000 = -0.000000001');
    assert.equal(tryArithmetic('1 / 512').exact, true);
  });

  await t.test('a non-zero value that rounds to zero falls through', () => {
    /* Was: "≈ -0", which is not a number anyone writes. */
    assert.equal(tryArithmetic('-1 / 3000000000'), null);
    assert.equal(tryArithmetic('1 / 3000000000'), null);
  });

  await t.test('the digit ceiling bounds the RESULT, not each power in it', () => {
    /* Was: 33 copies of 9^999 multiplied together — inside every individual
     * ceiling, 31,459 digits out. */
    const bomb = Array(33).fill('9^999').join('*');
    assert.ok(bomb.length < 200, 'the bomb has to fit inside the length ceiling to be a test');
    assert.equal(tryArithmetic(bomb), null);
  });

  await t.test('"minus three squared" in words is ambiguous and refuses', () => {
    /* Most people saying it mean (-3)² = 9; the symbols say -9. Neither, then. */
    assert.equal(tryArithmetic('-3 squared'), null);
    assert.equal(tryArithmetic('-2 cubed'), null);
    /* Parenthesised or symbolic, it is not ambiguous and still computes. */
    assert.equal(answer('(-3) squared'), '(-3)² = 9');
    assert.equal(answer('-3^2'), '-3² = -9');
  });
});

test('hostile input reaches no evaluator and no crash', async (t) => {
  const hostile = [
    '80^2; DROP TABLE users',
    'eval(1+1)',
    '`process.exit(1)`',
    'require("fs").rmSync("/")',
    '2 + 2 && process.exit(1)',
    '${7*7}',
    '__proto__ + 1',
    'constructor.constructor("return 1")()',
    '1' + '+1'.repeat(500),          // long but structurally valid: length ceiling refuses it
    '('.repeat(400) + '1' + ')'.repeat(400),
  ];
  for (const input of hostile) {
    await t.test(JSON.stringify(input.slice(0, 40)), () => {
      /* The assertion is BOTH that it refuses and that it does not throw — a
       * throw here is a 500 on the council route, which is a denial of service
       * one short message long. */
      assert.doesNotThrow(() => tryArithmetic(input));
      assert.equal(tryArithmetic(input), null);
    });
  }

  await t.test('the source contains no dynamic evaluator at all', () => {
    /* Belt and braces, and the one check that survives a future rewrite of the
     * parser: the greppable proof that no code path can reach eval. */
    const src = fs.readFileSync(path.join(__dirname, 'arithmetic.js'), 'utf8');
    assert.equal(/\beval\s*\(/.test(src), false, 'eval( appears in arithmetic.js');
    assert.equal(/\bnew Function\b/.test(src), false, 'new Function appears in arithmetic.js');
    assert.equal(/\bvm\b|child_process/.test(src), false, 'a code-execution module appears in arithmetic.js');
  });
});

test('resource ceilings — an answer may not cost more than the question', async (t) => {
  await t.test('a power bomb falls through rather than pinning the CPU', () => {
    const started = Date.now();
    assert.equal(tryArithmetic('2^1000000'), null);
    assert.equal(tryArithmetic('99999^999999'), null);
    assert.ok(Date.now() - started < 200, 'the refusal must be immediate, not computed first');
  });
  await t.test('2^1000 is inside the ceiling and exact', () => {
    const got = tryArithmetic('2^1000');
    assert.equal(got.value, (2n ** 1000n).toString());
  });
  await t.test('a long message falls through even if it is arithmetic', () =>
    assert.equal(tryArithmetic('1 + '.repeat(80) + '1'), null));
});

test('other keyboards', async (t) => {
  await t.test('unicode minus', () => assert.equal(answer('80 − 2'), '80 - 2 = 78'));
  await t.test('unicode times', () => assert.equal(answer('12 × 4'), '12 × 4 = 48'));
  await t.test('unicode divide', () => assert.equal(answer('100 ÷ 7'), '100 ÷ 7 ≈ 14.28571429'));
  await t.test('full-width digits', () => assert.equal(answer('２ × ３'), '2 × 3 = 6'));
  /* Arabic-Indic digits are refused ON PURPOSE: answering in Western digits
   * would be answering in the wrong script, and the council handles language
   * properly. A gap, chosen. */
  await t.test('Arabic-Indic digits fall through to the council', () =>
    assert.equal(tryArithmetic('٤٢ + ٨'), null));
});

test('punctuation and phrasing around a genuine sum', async (t) => {
  await t.test('a trailing question mark', () => assert.equal(answer('what is 80 squared?'), '80² = 6400'));
  await t.test('a trailing equals sign', () => assert.equal(answer('80 * 2 ='), '80 × 2 = 160'));
  await t.test('a polite opener', () => assert.equal(answer('please calculate 80 squared'), '80² = 6400'));
  await t.test('percent spelled out', () => assert.equal(answer('what is 15 percent of 80'), '15% of 80 = 12'));
  await t.test('a constrained answer-format suffix still uses the zero-seat path', () =>
    assert.equal(answer('What is 17% of 340? Answer with the number.'), '17% of 340 = 57.8'));
  await t.test('to the power of', () => assert.equal(answer('2 to the power of 10'), '2^10 = 1024'));
  await t.test('a trailing pleasantry still falls through', () =>
    assert.equal(tryArithmetic('80 squared for me please'), null));
});

/**
 * THE CLAIM THAT MATTERS MOST, and the one that would otherwise be taken on
 * trust: this path asks OpenRouter nothing.
 *
 * Asserting "zero calls to callModel" directly is impossible here — server.js
 * calls process.exit(1) at import time without its env, so nothing defined in
 * it can be required from a test (see AGENTS.md). With global.fetch replaced by
 * a throw, every network call THIS MODULE could make fails loudly, and
 * callModel, streamModel and every OpenRouter helper are built on fetch.
 *
 * WHAT THIS DOES NOT PROVE, because the first version of this comment claimed
 * it did: nothing here exercises `/api/council`. The route still does its own
 * Supabase work either side of this branch — `ensureUser` before it and
 * `auditLog` after — and those are network calls this test never sees. The
 * claim it supports is exactly "the parser asks no one anything", which is the
 * claim that matters for the request budget. The ordering test below is what
 * covers the route.
 */
test('the fast path performs no network I/O whatsoever', () => {
  const realFetch = global.fetch;
  let calls = 0;
  global.fetch = (...args) => {
    calls++;
    throw new Error(`arithmetic fast path made a network call: ${String(args[0])}`);
  };
  try {
    for (const input of ['80 squared', '21600 cubed', '15% of 80', '80^2', 'what is 12 times 4', '100 / 7']) {
      assert.ok(tryArithmetic(input), `${input} should have been answered locally`);
    }
    assert.equal(calls, 0, 'the fast path must not call fetch');
  } finally {
    global.fetch = realFetch;
  }
});

/**
 * THE ORDER IS THE FEATURE. A fast path that runs after the router has already
 * classified, or after a model call, saves nothing — and nothing else in the
 * suite would notice, because the answer would still be correct and only the
 * latency and the request budget would be wrong.
 *
 * Asserted against server.js as TEXT, which is the pattern AGENTS.md documents
 * for this file, and on ORDER rather than exact strings so a reflow does not
 * break it.
 */
test('server.js calls the fast path before the router and before any model', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const fast = src.indexOf('tryArithmetic(');
  const router = src.indexOf('classifyRequest(routingText');
  assert.ok(fast > 0, 'server.js never calls tryArithmetic');
  assert.ok(router > 0, 'the router call moved; this test needs updating');
  assert.ok(fast < router, 'the arithmetic fast path must run BEFORE classifyRequest');

  /* AND THE DAILY-CAP LATCH LETS IT THROUGH. When the account's model quota is
   * spent the route returns 503 before doing anything — which refused `80
   * squared`, an answer needing no model at all. The latch must consult the
   * parser before refusing. */
  const latch = src.indexOf('dailyLimitActive()');
  assert.ok(latch > 0, 'the daily-limit latch moved; this test needs updating');
  assert.match(
    src.slice(latch, latch + 120),
    /tryArithmetic/,
    'the daily-limit latch must not refuse a turn the fast path can answer for free',
  );

  const firstModelCall = Math.min(
    ...['streamModel(res', 'runCouncilWithWhip(', 'runAgentLoop('].map((needle) => {
      const at = src.indexOf(needle);
      return at === -1 ? Infinity : at;
    }),
  );
  assert.ok(fast < firstModelCall, 'the arithmetic fast path must run before any model call');
});

/**
 * THE 2026-08-13 WIDENING: exponents, roots, trigonometry, logarithms,
 * factorials, modulo, constants, and the shapes a person actually types.
 *
 * The owner's report was that the fast path answered "80 squared" and then sent
 * "185 x 3 plus 100 divided by 2" to a council of language models — which got it
 * right, slowly, for two model requests out of an account allowance of fifty a
 * day. The refusals were correct under the old grammar and the grammar was too
 * narrow.
 *
 * THE CONTRACT THAT MADE THIS SAFE, and the thing every test below is really
 * checking: `=` still means exact and `≈` still means rounded. Nothing in the
 * float lane may render with `=`.
 */
test('the widened grammar answers, and says which answers are exact', async (t) => {
  const exact = {
    // The two the owner reported.
    '185 x 3 plus 100 divided by 2': '185 × 3 + 100 ÷ 2 = 605',
    '182 multiplied by 3 divided by 2 exponent of 5': '182 × 3 ÷ 2^5 = 17.0625',

    // Roots that come out whole stay whole — the reason bigRoot exists.
    'sqrt 16': 'sqrt(16) = 4',
    '√144': 'sqrt(144) = 12',
    '∛27': 'cbrt(27) = 3',
    'sqrt 16 + 9': 'sqrt(16) + 9 = 13',

    '5!': '5! = 120',
    'what is 12 factorial': '12! = 479001600',
    'factorial of 5': '5! = 120',
    '(2+3)!': '(2 + 3)! = 120',

    '7 mod 3': '7 mod 3 = 1',
    'abs -5': 'abs(-5) = 5',
    'floor 7.8': 'floor(7.8) = 7',
    'ceiling 7.2': 'ceil(7.2) = 8',

    '2^10': '2^10 = 1024',
    '2¹⁰': '2^10 = 1024',   // a superscript RUN, not two folds
    // A word form reaching the same node the symbol does, superscript and all.
    '80 to the power of 3': '80³ = 512000',
    '80 raised to the power of 3': '80³ = 512000',
  };

  for (const [input, answer] of Object.entries(exact)) {
    await t.test(input, () => {
      const got = tryArithmetic(input);
      assert.ok(got, `${JSON.stringify(input)} should be answered`);
      assert.equal(got.answer, answer);
      assert.equal(got.exact, true, 'an exact answer must not be marked ≈');
    });
  }

  const approximate = {
    'square root of 2': 'sqrt(2) ≈ 1.41421356',
    '80 to the power of 0.5': '80^0.5 ≈ 8.94427191',
    'sin 30 degrees': 'sin(30°) ≈ 0.5',
    'tan 45 degrees': 'tan(45°) ≈ 1',
    'arctan 1': 'atan(1) ≈ 0.78539816',
    'log2 1024': 'log2(1024) ≈ 10',
    '2 pi': '2 × π ≈ 6.28318531',
    'pi squared': 'π² ≈ 9.8696044',
  };

  for (const [input, answer] of Object.entries(approximate)) {
    await t.test(input, () => {
      const got = tryArithmetic(input);
      assert.ok(got, `${JSON.stringify(input)} should be answered`);
      assert.equal(got.answer, answer);
      assert.equal(got.exact, false, 'a float-lane answer must be marked ≈');
    });
  }
});

/**
 * THE ANGLE MODE IS THE ONE THING A CALCULATOR CAN BE SILENTLY WRONG ABOUT.
 *
 * `sin 30` is 30 RADIANS, here as in every programming language, and it is
 * -0.988 rather than the 0.5 a person expects. That cannot be fixed by guessing
 * degrees — a guess is wrong for the other half of users and invisible either
 * way — so it is fixed by SAYING which mode was used, in the echo the user
 * already reads to check the machine understood them.
 */
test('every trig answer names the unit it used', async (t) => {
  const cases = [
    ['sin 30', 'sin(30 rad) ≈ -0.98803162'],
    ['sin 30 degrees', 'sin(30°) ≈ 0.5'],
    ['sin 30 radians', 'sin(30 rad) ≈ -0.98803162'],
    ['cos(0)', 'cos(0 rad) ≈ 1'],           // one set of brackets, not two
    ['cos(30 degrees)', 'cos(30°) ≈ 0.8660254'],
    // The minus is OUTSIDE the degree marker in the parse tree; a unit test on
    // the outermost node alone rendered this "sin(-30° rad)".
    ['sin -30 degrees', 'sin(-30°) ≈ -0.5'],
  ];

  for (const [input, answer] of cases) {
    await t.test(input, () => assert.equal(tryArithmetic(input)?.answer, answer));
  }
});

/**
 * `x` IS MULTIPLICATION ONLY WHERE IT CANNOT BE A VARIABLE. Accepting it
 * generally would take every algebra question off the council, which is the one
 * kind of question the council is better at than a calculator.
 */
test('x multiplies a value and is otherwise a variable', async (t) => {
  await t.test('after a number', () =>
    assert.equal(tryArithmetic('185 x 3')?.answer, '185 × 3 = 555'));
  await t.test('after a function call', () =>
    assert.equal(tryArithmetic('sqrt 16 x 3')?.answer, 'sqrt(16) × 3 = 12'));

  for (const input of ['x + 1', '2x + 1', 'solve for x', 'x times 3']) {
    await t.test(input, () => assert.equal(tryArithmetic(input), null));
  }
});

/**
 * The guards the widening had to leave standing. Each of these is bounded work
 * on a hostile string from an authenticated stranger, and each was found by
 * asking what the new grammar makes cheap to ask for.
 */
test('the widened grammar is still bounded', async (t) => {
  // 1000! is 2568 digits: computed, then refused by MAX_RESULT_DIGITS.
  await t.test('a large factorial', () => assert.equal(tryArithmetic('1000!'), null));
  // Above the argument ceiling, so it is refused BEFORE the multiplies happen.
  await t.test('an absurd factorial', () => assert.equal(tryArithmetic('99999999!'), null));
  await t.test('a float too large to print', () =>
    assert.equal(tryArithmetic('exp 500'), null));
  await t.test('division by zero in the float lane', () =>
    assert.equal(tryArithmetic('pi / 0'), null));
  await t.test('a value that rounds to zero', () =>
    assert.equal(tryArithmetic('tan(pi)'), null));
});

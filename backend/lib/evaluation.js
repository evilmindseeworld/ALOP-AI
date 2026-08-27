/**
 * THE EVALUATION PLATFORM: a dataset, graders, and one set of metrics.
 *
 * Ledger item 34. Until now "does the product still answer correctly" was
 * answered by asking it a question and reading the reply, which is not a
 * measurement — it has no dataset, no threshold and no record, so it cannot
 * fail and cannot be compared to last week.
 *
 * WHAT IS IN HERE AND WHAT IS NOT. This module is PURE: cases in, grades and
 * metrics out. It makes no HTTP request, reads no clock and spends no money, so
 * every grader in it is unit-testable against a fixture and the same grades
 * come out twice. `scripts/run-evals.mjs` is the part that talks to a running
 * server and produces the observations; `lib/release-gates.js` is the part that
 * turns these metrics into a pass or a refusal. Three modules because the
 * expensive one (the runner) is the one that cannot be tested cheaply, and it
 * should therefore contain as little judgement as possible.
 *
 * AN OBSERVATION is what the runner saw for one case:
 *
 *   {
 *     id: 'lookup-capability',      // the case it answers
 *     answer: '…',                  // concatenated `chunk` frames
 *     frames: [{type,…}],           // every SSE frame, in order
 *     latencyMs: 2410,              // request start to stream end
 *     firstByteMs: 640,             // request start to first body bytes
 *     firstAnswerTokenMs: 2410,     // request start to first answer chunk
 *     firstUsefulStageMs: 80,       // request start to first stage/tool event
 *     costCents: null,              // null when unobservable over HTTP
 *     textSource: null,             // 'cache' | 'content' | … | null
 *     error: null,                  // { code, text } from an `error` frame
 *   }
 *
 * `null` MEANS UNOBSERVED, AND IS NOT A ZERO. A metric with nothing behind it
 * is reported as `null` and the gate that reads it reports `inconclusive` —
 * never a pass. That distinction is the whole reason this file exists rather
 * than a script that prints "looks fine": cost per turn and cache precision are
 * NOT observable from the HTTP surface today (no frame carries the price, and
 * `textSource` reaches the client on no path), so a runner that reported them
 * as 0 would gate on a number it never measured.
 *
 * ponytail: cache precision and cost stay unobserved until either the turn
 * ledger's meta is exposed on `GET /api/turns/:operationId` or a closing `meta`
 * frame carries `textSource` and the settled price. Both are additive; neither
 * was worth changing eleven stream exits for before anything consumed it. When
 * one lands, the runner fills these two fields and the gates start biting with
 * no change here.
 *
 * A CASE looks like this (see `evals/core-v1.json`):
 *
 *   {
 *     "id": "arith-percent",              // unique, stable, cited in reports
 *     "question": "What is 17% of 340?",
 *     "tags": ["factuality", "arithmetic"],
 *     "expect": {
 *       "mustInclude": ["57.8"],          // case-insensitive substrings
 *       "mustMatch": ["\\b57\\.8\\b"],    // regex, when a substring is too loose
 *       "mustNotInclude": ["as an AI"],
 *       "mustCite": false,                // an answer URL backed by a source receipt
 *       "expectTools": ["web_search"],    // names seen in `tool_start` frames
 *       "expectNoTools": false,
 *       "expectErrorCode": null,          // for cases that SHOULD be refused
 *       "maxLatencyMs": 20000,
 *       "minChars": 20
 *     }
 *   }
 *
 * Every expectation is optional. A case with an empty `expect` is a smoke test:
 * it passes if the turn produced any answer at all and no error frame.
 */

/** Answers cite by URL. Deliberately not markdown-link-aware: a link whose text
 *  looks like a citation but whose href is missing is not a citation, and the
 *  URL form is the one `lib/council-tools.js` actually appends. */
const { URL_RE, extractUrls, canonicalUrl } = require('./citation-urls');

const KNOWN_EXPECT_KEYS = new Set([
  'mustInclude', 'mustMatch', 'mustNotInclude', 'mustCite',
  'expectTools', 'expectNoTools', 'expectErrorCode',
  'maxLatencyMs', 'minChars',
]);

/**
 * Case validation, because a dataset is code. A typo'd expectation key is the
 * failure this catches: `mustContain` instead of `mustInclude` silently grades
 * nothing, and the case then passes forever while checking nothing at all.
 * Unknown keys are REFUSED for the same reason `lib/schemas.js` refuses them.
 */
function validateCase(testCase, seen = new Set()) {
  const problems = [];
  const at = (msg) => problems.push(`${testCase?.id || '(no id)'}: ${msg}`);

  if (!testCase || typeof testCase !== 'object' || Array.isArray(testCase)) return ['case is not an object'];
  if (typeof testCase.id !== 'string' || !testCase.id.trim()) at('id must be a non-empty string');
  else if (seen.has(testCase.id)) at('duplicate id');
  if (typeof testCase.question !== 'string' || !testCase.question.trim()) at('question must be a non-empty string');
  if (testCase.tags !== undefined && !Array.isArray(testCase.tags)) at('tags must be an array');
  if (testCase.history !== undefined) {
    if (!Array.isArray(testCase.history)) at('history must be an array');
    else for (const message of testCase.history) {
      if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') {
        at('history entries must be user/assistant messages with string content');
      }
    }
  }

  const expect = testCase.expect ?? {};
  if (typeof expect !== 'object' || Array.isArray(expect)) at('expect must be an object');
  else {
    for (const key of Object.keys(expect)) {
      if (!KNOWN_EXPECT_KEYS.has(key)) at(`unknown expectation "${key}"`);
    }
    for (const key of ['mustInclude', 'mustMatch', 'mustNotInclude', 'expectTools']) {
      if (expect[key] !== undefined && !Array.isArray(expect[key])) at(`${key} must be an array`);
    }
    for (const pattern of expect.mustMatch ?? []) {
      try { new RegExp(pattern, 'i'); } catch { at(`mustMatch pattern is not a regex: ${pattern}`); }
    }
    for (const key of ['maxLatencyMs', 'minChars']) {
      if (expect[key] !== undefined && !(Number.isFinite(expect[key]) && expect[key] >= 0)) at(`${key} must be a non-negative number`);
    }
  }
  return problems;
}

/** A dataset is `{ name, cases }`. Returns the cases and every problem found;
 *  the runner refuses to spend money on a dataset with any problem in it. */
function loadDataset(raw) {
  const problems = [];
  if (!raw || typeof raw !== 'object') return { name: null, cases: [], problems: ['dataset is not an object'] };
  if (typeof raw.name !== 'string' || !raw.name.trim()) problems.push('dataset name must be a non-empty string');
  if (!Array.isArray(raw.cases) || raw.cases.length === 0) {
    problems.push('dataset must carry a non-empty cases array');
    return { name: raw.name ?? null, cases: [], problems };
  }
  const seen = new Set();
  for (const testCase of raw.cases) {
    problems.push(...validateCase(testCase, seen));
    if (typeof testCase?.id === 'string') seen.add(testCase.id);
  }
  return { name: raw.name ?? null, cases: raw.cases, problems };
}

const citationsIn = extractUrls;

function sourceUrlsIn(obs) {
  const rows = [];
  if (Array.isArray(obs?.provenance?.sources)) rows.push(...obs.provenance.sources);
  for (const frame of Array.isArray(obs?.frames) ? obs.frames : []) {
    if (Array.isArray(frame?.sources)) rows.push(...frame.sources);
    if (Array.isArray(frame?.evidence)) rows.push(...frame.evidence);
  }
  return new Set(rows.map((row) => canonicalUrl(row?.url)).filter(Boolean));
}

function citationReceiptCoverage(answer, obs) {
  const found = citationsIn(answer).map(canonicalUrl).filter(Boolean);
  const receipts = sourceUrlsIn(obs);
  const matched = found.filter((url) => receipts.has(url));
  const ungrounded = found.filter((url) => !receipts.has(url));
  return { found, receipts, matched, ungrounded };
}

const framesOfType = (obs, type) => (obs.frames || []).filter((f) => f && f.type === type);

/**
 * EVERY UNICODE SPACE SEPARATOR BECOMES AN ORDINARY SPACE.
 *
 * A model writing "Expert 1" with U+202F NARROW NO-BREAK SPACE between the word
 * and the digit walked straight past `mustNotInclude: ['Expert 1']` — the answer
 * named the council in a synthesis whose system prompt forbids ever mentioning
 * it, and the grader reported a clean pass. Measured 2026-08-19 on a real
 * synthesis output; the leak was found by reading the answer, not by the check
 * that exists to find it.
 *
 * Only Unicode compatibility forms, common editorial punctuation and spaces
 * are normalised. A needle and a haystack that disagree about content still
 * disagree; this only prevents typography from changing the meaning of a
 * content check.
 */
function flattenSpaces(text) {
  /* JavaScript's whitespace class already covers the exotic separators —
   * U+00A0, U+2000-200A, U+202F, U+205F, U+3000 — after compatibility
   * normalisation, so this needs no hand-kept list of code points. */
  return normaliseUnicodeText(text).replace(/\s+/g, ' ');
}

function normaliseUnicodeText(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201B\u2032\uFF07]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033\uFF02]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2212\uFE58\uFE63\uFF0D]/g, '-')
    .replace(/\s+%/g, '%');
}

const COMPLETE_SHORT_WORDS = new Set([
  'a', 'an', 'api', 'app', 'as', 'at', 'all', 'any', 'be', 'by', 'cpu', 'day', 'do', 'for', 'from',
  'go', 'how', 'if', 'in', 'is', 'it', 'less', 'ms', 'no', 'now', 'of', 'off', 'on', 'one', 'or',
  'out', 'per', 'ram', 'sql', 'the', 'to', 'too', 'two', 'up', 'url', 'use', 'via', 'way', 'web',
  'why', 'yes',
]);

function isLikelyComplete(text) {
  const answer = String(text ?? '').trim();
  if (!answer) return false;
  if ((answer.match(/```/g) || []).length % 2 !== 0) return false;

  const lastLine = answer.split(/\r?\n/).pop().trim();
  if (!lastLine || /[,;:([{]$/.test(lastLine)) return false;
  if (/[<]$/.test(lastLine) || /\|\s*<$/.test(lastLine)) return false;
  if (/(?:^|\s)(?:and|or|but|because|although|while|with|to|from|including|such as|if|when|that)$/.test(lastLine.toLowerCase())) return false;

  /* A stream cut can stop inside a word without leaving punctuation or an
   * obvious conjunction. Keep this conservative: only flag a short,
   * lowercase tail on a substantial answer, and allow common legitimate
   * two/three-letter endings such as `API`, `SQL`, `yes`, and `use`. */
  const trailingWord = lastLine.match(/([a-z]+)$/)?.[1]?.toLowerCase();
  if (answer.length >= 80 && trailingWord && trailingWord.length <= 3
    && !COMPLETE_SHORT_WORDS.has(trailingWord)
    && !/[.!?`|)]$/.test(lastLine)) return false;
  return true;
}

/**
 * Grade one observation against one case.
 *
 * Every check is named, and a check that could not be evaluated is `null`
 * rather than false — a case whose tool expectations cannot be judged because
 * the runner captured no frames must not read as a content failure. `passed`
 * is true only when no check is false; a case with an inconclusive check is
 * reported as `inconclusive` and, like an unsampled gate, does not count as a
 * pass.
 */
function gradeCase(testCase, obs) {
  const expect = testCase.expect ?? {};
  const answer = String(obs?.answer || '');
  const lower = flattenSpaces(answer.toLowerCase());
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok, detail });

  // An expected error is a normal graded outcome. An unexpected transport or
  // provider error is unobserved content, not a failed answer: classify the
  // case as inconclusive and keep it out of content, citation, and latency
  // quality metrics.
  const errorCode = obs?.error?.code ?? null;
  if (expect.expectErrorCode) {
    add('errorCode', errorCode === expect.expectErrorCode, `saw ${errorCode ?? 'no error'}`);
  } else if (errorCode) {
    return {
      id: testCase.id,
      tags: testCase.tags ?? [],
      checks: [{ name: 'transportError', ok: null, detail: `error frame: ${errorCode}` }],
      passed: false,
      inconclusive: true,
      failures: [],
    };
  }

  if (!expect.expectErrorCode) {
    add('nonEmpty', answer.trim().length > 0, `${answer.length} chars`);
    add('completeness', isLikelyComplete(answer), isLikelyComplete(answer) ? 'complete' : 'clear terminal fragment');
    if (expect.minChars !== undefined) add('minChars', answer.length >= expect.minChars, `${answer.length} chars`);

    for (const needle of expect.mustInclude ?? []) {
      add(`mustInclude:${needle}`, lower.includes(flattenSpaces(String(needle).toLowerCase())));
    }
    for (const pattern of expect.mustMatch ?? []) {
      add(`mustMatch:${pattern}`, new RegExp(normaliseUnicodeText(pattern), 'i').test(normaliseUnicodeText(answer)));
    }
    for (const needle of expect.mustNotInclude ?? []) {
      add(`mustNotInclude:${needle}`, !lower.includes(flattenSpaces(String(needle).toLowerCase())));
    }
    if (expect.mustCite) {
      const coverage = citationReceiptCoverage(answer, obs);
      add('mustCite', coverage.found.length > 0 && coverage.ungrounded.length === 0,
        `${coverage.found.length} url(s), ${coverage.matched.length} backed by ${coverage.receipts.size} receipt(s)`);
    }
  }

  if (expect.expectTools?.length || expect.expectNoTools) {
    const names = framesOfType(obs, 'tool_start').map((f) => f.name);
    const observed = Array.isArray(obs?.frames) ? true : null;
    if (observed === null) add('tools', null, 'no frames captured');
    else if (expect.expectNoTools) add('expectNoTools', names.length === 0, names.join(',') || 'none');
    else for (const want of expect.expectTools) add(`expectTool:${want}`, names.includes(want), names.join(',') || 'none');
  }

  if (expect.maxLatencyMs !== undefined) {
    const latency = obs?.latencyMs;
    add('maxLatencyMs', Number.isFinite(latency) ? latency <= expect.maxLatencyMs : null, `${latency ?? 'unmeasured'}ms`);
  }

  const failed = checks.filter((c) => c.ok === false);
  const inconclusive = checks.filter((c) => c.ok === null);
  return {
    id: testCase.id,
    tags: testCase.tags ?? [],
    checks,
    passed: failed.length === 0 && inconclusive.length === 0,
    inconclusive: failed.length === 0 && inconclusive.length > 0,
    failures: failed.map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ''}`),
  };
}

/** Nearest-rank percentile on a sorted copy. No interpolation: with twenty
 *  cases an interpolated p95 is a number no case produced. */
function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

const mean = (values) => {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : null;
};

/**
 * The release metrics, from grades plus observations.
 *
 * Each rate is `null` when its denominator is empty, and the gate for it then
 * reads inconclusive. `citationRate` is measured only over the cases that
 * REQUIRE a citation — averaging in the cases that must not cite would let a
 * dataset raise its own citation score by adding arithmetic questions.
 */
function summarise(grades, observations = []) {
  const total = grades.length;
  const rate = (num, den) => (den > 0 ? num / den : null);
  const evaluatedGrades = grades.filter((g) => !g.inconclusive);
  const evaluatedIds = new Set(evaluatedGrades.map((g) => g.id));
  const measuredObservations = observations.filter((o) => evaluatedIds.has(o.id));
  const evaluatedCases = evaluatedGrades.length;
  const passed = evaluatedGrades.filter((g) => g.passed).length;

  const tagged = (tag) => evaluatedGrades.filter((g) => (g.tags || []).includes(tag));
  const factual = tagged('factuality');

  const citing = evaluatedGrades.filter((g) => g.checks.some((c) => c.name === 'mustCite'));
  const citingOk = citing.filter((g) => g.checks.find((c) => c.name === 'mustCite')?.ok === true);

  const toolResults = measuredObservations.flatMap((o) => framesOfType(o, 'tool_result'));
  // Cache PRECISION, not hit rate: of the turns that were served from cache,
  // how many still answered the question correctly. A stale or mis-keyed cache
  // row is a hit and a wrong answer at the same time, and hit rate calls that a
  // success.
  const cacheObs = measuredObservations.filter((o) => o.textSource === 'cache');
  const cacheOk = cacheObs.filter((o) => grades.find((g) => g.id === o.id)?.passed);

  const latencies = measuredObservations.map((o) => o.latencyMs);
  const firstBytes = measuredObservations.map((o) => o.firstByteMs);
  const firstAnswerTokens = measuredObservations.map((o) => o.firstAnswerTokenMs);
  const firstUsefulStages = measuredObservations.map((o) => o.firstUsefulStageMs);
  const costs = measuredObservations.map((o) => o.costCents);

  return {
    cases: total,
    evaluatedCases,
    coverageRate: rate(evaluatedCases, total),
    passed,
    failed: evaluatedGrades.filter((g) => g.checks.some((c) => c.ok === false)).length,
    inconclusive: grades.filter((g) => g.inconclusive).length,
    acceptanceRate: rate(passed, evaluatedCases),
    factualityPassRate: rate(factual.filter((g) => g.passed).length, factual.length),
    citationRate: rate(citingOk.length, citing.length),
    toolSuccessRate: rate(toolResults.filter((f) => f.ok === true).length, toolResults.length),
    cachePrecision: rate(cacheOk.length, cacheObs.length),
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
    firstByteP50Ms: percentile(firstBytes, 50),
    firstByteP95Ms: percentile(firstBytes, 95),
    firstAnswerTokenP50Ms: percentile(firstAnswerTokens, 50),
    firstAnswerTokenP95Ms: percentile(firstAnswerTokens, 95),
    firstUsefulStageP50Ms: percentile(firstUsefulStages, 50),
    firstUsefulStageP95Ms: percentile(firstUsefulStages, 95),
    costCentsPerTurn: mean(costs),
    failures: evaluatedGrades.filter((g) => g.failures.length).map((g) => ({ id: g.id, failures: g.failures })),
  };
}

module.exports = {
  URL_RE, KNOWN_EXPECT_KEYS,
  validateCase, loadDataset, gradeCase, summarise, percentile, citationsIn,
  sourceUrlsIn, citationReceiptCoverage, isLikelyComplete,
};

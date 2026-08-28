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
 *       "mustDiscussTradeoff": true,      // a relational, diminishing-value rubric
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
  'mustDiscussTradeoff', 'maxLatencyMs', 'minChars',
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
    if (expect.mustDiscussTradeoff !== undefined && typeof expect.mustDiscussTradeoff !== 'boolean') {
      at('mustDiscussTradeoff must be a boolean');
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

/*
 * Completion is judged from the strongest evidence available. The runner's
 * provenance and provider finish state are authoritative for a clean stream;
 * a declared abort, length stop, or incomplete qualification is authoritative
 * for an incomplete stream. Text-only checks remain conservative and protect
 * only against unmistakable structural or grammatical cuts.
 */
const COMPLETE_FINISH_REASONS = new Set([
  'stop', 'eos', 'end_turn', 'complete', 'completed', 'finished', 'done', 'success',
]);
const INCOMPLETE_FINISH_REASONS = new Set([
  'length', 'max_tokens', 'token_limit', 'context_limit', 'timeout', 'deadline',
  'abort', 'aborted', 'cancel', 'cancelled', 'canceled', 'failed', 'failure',
  'error', 'incomplete', 'truncated', 'content_filter', 'running', 'streaming',
  'in_progress', 'pending',
]);
const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));

function completionToken(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[-\s:]+/g, '_')
    : '';
}

function statusForCompletionValue(value) {
  const token = completionToken(value);
  if (!token) return null;
  if (INCOMPLETE_FINISH_REASONS.has(token)
    || /(?:length|token|timeout|deadline|abort|cancel|truncat|incomplete|limit|context|error|fail)/.test(token)) {
    return 'incomplete';
  }
  if (COMPLETE_FINISH_REASONS.has(token)
    || /(?:complete|finish|success|stop|eos|end_turn|done)/.test(token)) {
    return 'complete';
  }
  return null;
}

function inspectCompletionMetadata(observation = {}) {
  const fields = [];
  const completeFields = [];
  const incompleteFields = [];
  const seen = new Set();
  const mark = (field, status) => {
    if (!status || seen.has(field)) return;
    seen.add(field);
    fields.push(field);
    if (status === 'complete') completeFields.push(field);
    if (status === 'incomplete') incompleteFields.push(field);
  };

  const scan = (value, prefix, allowBooleans = true) => {
    if (!isRecord(value)) return;
    const valueKeys = [
      'finishReason', 'finish_reason', 'providerFinishReason', 'provider_finish_reason',
      'completionStatus', 'completion_status', 'status', 'state', 'requestState',
      'request_state', 'streamState', 'stream_state', 'outputContractState',
      'output_contract_state', 'qualified', 'reason',
    ];
    for (const key of valueKeys) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        mark(prefix + '.' + key, statusForCompletionValue(value[key]));
      }
    }
    if (allowBooleans) {
      for (const key of ['complete', 'completed', 'done', 'finished', 'final', 'assembled',
        'streamComplete', 'stream_complete', 'providerComplete', 'provider_complete']) {
        if (typeof value[key] === 'boolean') mark(prefix + '.' + key, value[key] ? 'complete' : 'incomplete');
      }
    }
    for (const key of ['abortReason', 'abort_reason']) {
      if (value[key]) mark(prefix + '.' + key, 'incomplete');
    }
    for (const key of ['completion', 'outputContract', 'output_contract', 'answerContract',
      'answer_contract', 'stream', 'provenance']) {
      if (isRecord(value[key])) scan(value[key], prefix + '.' + key, allowBooleans);
    }
  };

  scan(observation, 'observation', true);
  if (isRecord(observation?.error)) mark('observation.error', 'incomplete');
  if (observation?.aborted === true) mark('observation.aborted', 'incomplete');
  if (observation?.cancelled === true || observation?.canceled === true) {
    mark('observation.cancelled', 'incomplete');
  }
  if (observation?.timedOut === true || observation?.timed_out === true) {
    mark('observation.timedOut', 'incomplete');
  }

  const provenance = observation?.provenance;
  if (isRecord(provenance)) {
    const requestState = completionToken(provenance.requestState ?? provenance.request_state);
    if (requestState === 'complete') mark('observation.provenance.requestState', 'complete');
    if (requestState && requestState !== 'complete'
      && /(?:running|streaming|pending|abort|cancel|fail|error|incomplete|partial)/.test(requestState)
      && requestState !== 'partial') {
      mark('observation.provenance.requestState', 'incomplete');
    }
    if (isRecord(provenance.failure)) {
      if (provenance.failure.occurred === true) mark('observation.provenance.failure.occurred', 'incomplete');
      if (provenance.failure.userAborted === true) {
        mark('observation.provenance.failure.userAborted', 'incomplete');
      }
    }
  }

  for (const [index, frame] of (Array.isArray(observation?.frames) ? observation.frames : []).entries()) {
    if (!isRecord(frame)) continue;
    const type = completionToken(frame.type);
    const terminal = /(?:done|complete|finish|final|eos|error|abort|cancel)/.test(type)
      || Object.keys(frame).some((key) => /^(?:finishReason|finish_reason|completed|complete|done|final)$/.test(key));
    if (type === 'error' || /(?:error|abort|cancel)/.test(type)) {
      mark('frames[' + index + '].type', 'incomplete');
    } else if (/(?:done|complete|finish|final|eos)/.test(type)) {
      mark('frames[' + index + '].type', 'complete');
    }
    scan(frame, 'frames[' + index + ']', terminal);
  }

  const status = incompleteFields.length > 0
    ? 'incomplete'
    : completeFields.length > 0
      ? 'complete'
      : 'unknown';
  return { status, available: fields.length > 0, fields, completeFields, incompleteFields };
}
/*
 * The tradeoff grader recognises a relation, not a bag of topical words:
 * additional or similar council seats are tied to diminishing informational
 * value or to redundancy of the same perspective. Cost, latency, and an
 * unrelated duplicate file are intentionally outside that relation.
 */
const TRADEOFF_SUBJECT_WORDS = new Set([
  'model', 'models', 'vote', 'votes', 'round', 'rounds', 'perspective', 'perspectives',
  'reasoning', 'bias', 'biases', 'result', 'results', 'response', 'responses',
  'candidate', 'candidates', 'seat', 'seats', 'opinion', 'opinions', 'sample', 'samples',
  'judge', 'judges', 'expert', 'experts', 'replica', 'replicas', 'view', 'views',
]);
const TRADEOFF_ADDITION_WORDS = new Set([
  'extra', 'additional', 'more', 'another', 'further', 'added', 'adding', 'new',
  'repeated', 'repeat', 'repeats', 'repeating', 'duplicate', 'duplicated', 'duplicates',
  'redundant', 'redundancy', 'identical', 'similar', 'same', 'alike', 'replica', 'replicas',
  'converge', 'converges', 'converging', 'convergent', 'overlapping', 'overlap',
  'nth', 'fifth', 'sixth',
]);
const TRADEOFF_VALUE_WORDS = new Set([
  'gain', 'gains', 'benefit', 'benefits', 'value', 'utility', 'return', 'returns',
  'novelty', 'insight', 'insights', 'contribution', 'improvement', 'coverage', 'accuracy',
  'usefulness', 'information', 'diversity', 'signal', 'evidence', 'confidence',
]);
const TRADEOFF_DECREASE_WORDS = new Set([
  'negligible', 'little', 'limited', 'minimal', 'hardly', 'barely', 'less', 'lower',
  'lowers', 'smaller', 'shrink', 'shrinks', 'shrinking', 'diminish', 'diminishes',
  'diminished', 'diminishing', 'decline', 'declines', 'declining', 'decrease',
  'decreases', 'decreasing', 'fall', 'falls', 'falling', 'drop', 'drops', 'dropping',
  'zero', 'nothing', 'flat', 'plateau', 'plateaus', 'saturate', 'saturates', 'saturating',
]);
const TRADEOFF_REDUNDANCY_WORDS = new Set([
  'redundant', 'redundancy', 'duplicate', 'duplicated', 'duplicates', 'replica', 'replicas',
  'repeat', 'repeats', 'repeated', 'repetition',
]);

const evaluatorTokens = (text) => normaliseUnicodeText(text)
  .toLowerCase()
  .match(/[a-z]+(?:'[a-z]+)?/g) || [];

const within = (left, right, distance) => Math.abs(left - right) <= distance;
const positionsOf = (tokens, vocabulary) => tokens
  .map((token, index) => vocabulary.has(token) ? index : -1)
  .filter((index) => index >= 0);

const hasCouncilAdditionBinding = (tokens) => {
  const subjects = positionsOf(tokens, TRADEOFF_SUBJECT_WORDS);
  const additions = positionsOf(tokens, TRADEOFF_ADDITION_WORDS);
  return subjects.length > 0 && additions.some((addition) =>
    subjects.some((subject) => within(addition, subject, 4)));
};

const hasInformationalDecrease = (tokens) => {
  const values = positionsOf(tokens, TRADEOFF_VALUE_WORDS);
  const decreases = positionsOf(tokens, TRADEOFF_DECREASE_WORDS);
  return values.some((value) => decreases.some((decrease) => within(value, decrease, 6)));
};

function hasBoundRedundancy(sentence, tokens) {
  const subjects = positionsOf(tokens, TRADEOFF_SUBJECT_WORDS);
  const additions = positionsOf(tokens, TRADEOFF_ADDITION_WORDS);
  const redundancies = positionsOf(tokens, TRADEOFF_REDUNDANCY_WORDS);
  if (!subjects.length || !additions.some((addition) =>
    subjects.some((subject) => within(addition, subject, 4)))) return false;
  if (!redundancies.some((redundancy) =>
    subjects.some((subject) => within(redundancy, subject, 3)))) return false;

  /* Property words are strong when attached to the subject. Bare repeat
   * language needs an existing/shared/same perspective, not any repeated file. */
  const directProperty = redundancies.some((redundancy) =>
    !['repeat', 'repeats', 'repeated', 'repetition'].includes(tokens[redundancy])
    && subjects.some((subject) => within(redundancy, subject, 3)));
  const contextualRepeat = /\b(?:extra|additional|another|more|new|added|repeated|duplicated|duplicate|replica|replicated)\s+(?:model|models|seat|seats|vote|votes|perspective|perspectives|view|views|reasoning|bias|biases)\b[^.!?;]*\b(?:repeat|repeats|repeated|duplicate|duplicates|duplicated)\b[^.!?;]*\b(?:existing|same|shared|another)\s+(?:perspective|view|reasoning|bias|biases|answer|output|context|evidence)\b/i.test(sentence);
  return directProperty || contextualRepeat;
}

function rejectsDiminishingRelation(sentence) {
  const text = normaliseUnicodeText(sentence);
  const noDecrease = /\b(?:not|never)\b[^.!?;]*\b(?:negligible|little|limited|minimal|less|lower|smaller|zero|diminish\w*|declin\w*|decreas\w*|fall\w*|drop\w*)\b/i;
  const noRedundancy = /\b(?:not|never)\b[^.!?;]*\b(?:redundant|redundancy|duplicate\w*|replica\w*|repeat\w*|repetition)\b/i;
  const deniedPredicate = /\b(?:does|do|did|will|would|can|could|should|may|might|is|are|was|were)\s+not\b[^.!?;]*\b(?:diminish\w*|declin\w*|decreas\w*|fall\w*|drop\w*|negligible|little|limited|minimal|zero)\b/i;
  const deniedProposition = /\bnot\s+(?:true|correct|the case)\s+that\b[^.!?;]*(?:additional|extra|more|another|model|models|seat|seats)\b/i;
  const personalDenial = /\b(?:i|we)\s+(?:would|will|do|does|did)\s+not\s+(?:say|call|consider|describe|claim)\b[^.!?;]*(?:model|models|seat|seats)\b[^.!?;]*(?:redundant|duplicate\w*|replica\w*)\b/i;
  const noReasonablePerson = /\bno\s+(?:reasonable\s+)?(?:person|one|expert|observer)\b[^.!?;]*\b(?:call|consider|describe|say)\b[^.!?;]*(?:model|models|seat|seats)\b[^.!?;]*(?:redundant|duplicate\w*|replica\w*)\b/i;
  const staysHigh = /\b(?:marginal|incremental)\s+(?:benefit|value|gain|contribution|information)\b[^.!?;]*\b(?:remain|remains|stays|stay|is|are)\s+(?:high|substantial|significant|large|strong)\b/i;
  const wrongContrast = /\b(?:call|called|consider|considered|describe|described)\b[^.!?;]*\b(?:redundant|duplicate\w*|replica\w*)\b[^.!?;]*\b(?:but|yet|however)\b[^.!?;]*\b(?:wrong|false|incorrect|mistaken)\b/i;
  const eachAdds = /\b(?:each|every|all|both|everyone)\b[^.!?;]*\b(?:add|adds|adding|contribute|contributes|provide|provides|offer|offers)\b[^.!?;]*\b(?:substantial|significant|meaningful|real|novel|new|high)\b[^.!?;]*\b(?:value|benefit|information|evidence|insight|novelty)\b/i;
  return noDecrease.test(text)
    || noRedundancy.test(text)
    || deniedPredicate.test(text)
    || deniedProposition.test(text)
    || personalDenial.test(text)
    || noReasonablePerson.test(text)
    || staysHigh.test(text)
    || wrongContrast.test(text)
    || eachAdds.test(text);
}

function hasDiminishingValueReasoning(text) {
  const sentences = normaliseUnicodeText(String(text ?? '')).split(/[.!?]+/);
  return sentences.some((sentence) => {
    if (rejectsDiminishingRelation(sentence)) return false;
    const clauses = sentence.split(/;|,\s*(?:but|yet|although|though|however|while)\b/i);
    return clauses.some((clause) => {
      const tokens = evaluatorTokens(clause);
      if (!tokens.length || !hasCouncilAdditionBinding(tokens)) return false;
      return hasInformationalDecrease(tokens) || hasBoundRedundancy(clause, tokens);
    });
  });
}
/*
 * Completion detection intentionally does not reject terminal auxiliaries,
 * modals, short words, or every punctuation-free fragment. Those are common
 * complete endings in technical prose. Strong text-only protection is limited
 * to an explicit dangling relation or an unmistakable structural cut.
 */
const TRAILING_COORDINATORS = new Set(['and', 'or', 'but', 'nor']);
const TRAILING_PREPOSITION_PATTERNS = [
  /\b(?:depend|depends|depending|rely|relies|relying|based|determined|determines|varies|varying)\b[^.!?]*\b(?:of|to|from|with|without|into|onto|between|among|against|toward|towards|via|through|within|beyond|across|on)\s*$/i,
  /\b(?:number|amount|set|kind|type|one|part|rest|some|most|all|each|every|result|answer|reason|cause|example|combination|choice|version|list|majority|subset|range)\s+(?:of|from|between|among|with|without|for)\s*$/i,
];
const TRAILING_INFINITIVE_PATTERN = /\b(?:configure|set|use|make|take|give|add|remove|choose|select|enable|disable|start|stop|run|check|verify|update|install|deploy|call|send|return|write|read|create|delete|transform|transformed|convert|converted|map|apply|applies|handle|provide|require|requires|ensure|consider|compare|explain|show|describe|tell|measure|support|include|reuse|replace|process|parse|load|save|build)\b(?:\s+[a-z0-9_$.[\]{}-]+){0,4}\s+to$/i;
const TRAILING_DETERMINER_PATTERN = /\b(?:is|are|was|were|be|been|being|has|have|had|as|not|than|of)\s+(?:a|an|the|this|these|those|each|every|another|either|neither|one|some|any)\s*$/i;
const TRAILING_SUBORDINATOR_PATTERN = /\b(?:because|although|though|unless|until|whereas|while|since|whether)\s*(?:it|this|that|they|he|she|we|you|the|a|an)?\s*$/i;
const TRAILING_ENUMERATION_PATTERN = /\bthe\s+following\s+(?:steps|items|points|reasons|rules|examples|considerations)\s+(?:is|are)\s*$/i;
const TRAILING_COPULA_VERB_PATTERN = /\b(?:is|are|was|were|be|been|being)\s+(?:add|use|make|take|give|set|put|call|send|keep|find|need|want|configure|enable|disable|start|stop|run|check|verify|update|install|deploy|return|write|read|create|delete|transform|convert|apply|handle|provide|require|ensure|compare|explain|show|describe|tell|measure|support|include|reuse|replace|process|parse|load|save|build)\s*$/i;

function isCodeShaped(line) {
  const trimmed = String(line ?? '').trim();
  if (!trimmed) return false;
  if (/^\s*[$#]\s+/.test(line)) return true;
  if (/^(?:const|let|var|return|throw|yield|function|class|import|export|def|async|await|public|private|protected)\b/i.test(trimmed)) return true;
  if (/^(?:if|for|while)\s*\(/i.test(trimmed)) return true;
  if (/^(?:if|for|while)\s+[^.!?]*[{};]\s*$/i.test(trimmed)) return true;
  if (/^[A-Za-z_$][\w$]*\s*=(?!=)/.test(trimmed)) return true;
  if (/(?:=>|===|!==|==|!=|&&|\|\||[+\-*/%]=?)\s*$/.test(trimmed)) return true;
  if (/\b(?:function|class|import|export)\b/.test(trimmed)) return true;
  if (/[A-Za-z_$][\w$]*\s*\([^)]*\)\s*;?$/.test(trimmed)) return true;
  return false;
}

function isJsonLikeLine(line) {
  const trimmed = String(line ?? '').trim();
  return /^\s*[\[{]/.test(trimmed)
    || /^\s*["']?[A-Za-z_$][\w$-]*["']?\s*:\s*/.test(trimmed);
}

function isTableContext(lines) {
  const pipeRows = lines.filter((line) => (line.match(/\|/g) || []).length >= 2);
  return pipeRows.length >= 2 && lines[lines.length - 1].includes('|');
}

function hasUnclosedDoubleQuote(text) {
  let escaped = false;
  let count = 0;
  for (const character of String(text ?? '')) {
    if (escaped) escaped = false;
    else if (character === '\\') escaped = true;
    else if (character === '"') count++;
  }
  return count % 2 === 1;
}

function hasUnbalancedDelimiters(text) {
  const stack = [];
  const pairs = { ')': '(', ']': '[', '}': '{' };
  for (const character of String(text ?? '')) {
    if ('([{'.includes(character)) stack.push(character);
    else if (')]}'.includes(character)) {
      if (stack.pop() !== pairs[character]) return true;
    }
  }
  return stack.length > 0;
}

function hasStrongStructuralTruncation(answer) {
  const lines = String(answer ?? '').split(/\r?\n/);
  if ((String(answer ?? '').match(/\x60\x60\x60/g) || []).length % 2 === 1) return true;
  const lastLine = lines[lines.length - 1].trim();
  if (!lastLine) return false;
  if (/^\s*(?:[-*+•]|\d+[.)])\s*$/.test(lastLine)) return true;

  const structured = isCodeShaped(lastLine) || isJsonLikeLine(lastLine) || isTableContext(lines);
  if (!structured) return false;
  if (/\|\s*(?:<|,)\s*$/.test(lastLine)) return true;
  if (/[,:;(\[{]\s*$/.test(lastLine)) return true;
  if (/(?:[+*/%=&|^-]|=>|===|!==|==|!=|&&|\|\||<)\s*$/.test(lastLine)) return true;
  if (hasUnbalancedDelimiters(answer)) return true;
  if (isJsonLikeLine(lastLine) && hasUnclosedDoubleQuote(answer)) return true;
  return false;
}

function hasStrongTextTruncation(answer) {
  const lines = String(answer ?? '').split(/\r?\n/);
  const lastLine = lines[lines.length - 1].trim();
  if (!lastLine || isCodeShaped(lastLine) || isJsonLikeLine(lastLine) || isTableContext(lines)) return false;
  if (/[.!?)]\s*$/.test(lastLine)) return false;
  if (/,\s*$/.test(lastLine)) return true;
  const tokens = evaluatorTokens(lastLine);
  const last = tokens[tokens.length - 1];
  if (!last) return false;
  if (TRAILING_COORDINATORS.has(last)) return true;
  if (TRAILING_PREPOSITION_PATTERNS.some((pattern) => pattern.test(lastLine))) return true;
  if (TRAILING_INFINITIVE_PATTERN.test(lastLine)) return true;
  if (TRAILING_DETERMINER_PATTERN.test(lastLine)) return true;
  if (TRAILING_SUBORDINATOR_PATTERN.test(lastLine)) return true;
  if (TRAILING_ENUMERATION_PATTERN.test(lastLine)) return true;
  if (TRAILING_COPULA_VERB_PATTERN.test(lastLine)) return true;
  return false;
}

function isLikelyComplete(text, observation = null) {
  const answer = String(text ?? '');
  if (!answer.trim()) return false;
  const metadata = inspectCompletionMetadata(observation);
  if (metadata.status === 'incomplete') return false;
  if (hasStrongStructuralTruncation(answer)) return false;
  if (metadata.status === 'complete') return true;
  return !hasStrongTextTruncation(answer);
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
    const complete = isLikelyComplete(answer, obs);
    add('completeness', complete, complete ? 'complete' : 'clear terminal fragment');
    if (expect.minChars !== undefined) add('minChars', answer.length >= expect.minChars, `${answer.length} chars`);

    for (const needle of expect.mustInclude ?? []) {
      add(`mustInclude:${needle}`, lower.includes(flattenSpaces(String(needle).toLowerCase())));
    }
    for (const pattern of expect.mustMatch ?? []) {
      add(`mustMatch:${pattern}`, new RegExp(normaliseUnicodeText(pattern), 'i').test(normaliseUnicodeText(answer)));
    }
    if (expect.mustDiscussTradeoff === true) {
      const discussesTradeoff = hasDiminishingValueReasoning(answer);
      add('mustDiscussTradeoff', discussesTradeoff,
        discussesTradeoff ? 'relational diminishing-value language found' : 'no subject/value/diminishing relation found');
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
  sourceUrlsIn, citationReceiptCoverage, isLikelyComplete, inspectCompletionMetadata,
  hasDiminishingValueReasoning,
};

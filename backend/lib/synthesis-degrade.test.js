'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const { degradeAnswer } = require('./synthesis-degrade');

/**
 * WHY THIS EXISTS, MEASURED RATHER THAN REASONED.
 *
 * Four production turns carry `meta.reliability` schemaVersion 1 (2026-08-20).
 * TWO of them ended with no answer at all: the synthesis stream opened, ran for
 * 31007ms and 46988ms respectively, emitted ZERO content tokens, and was cut by
 * `turn_deadline` with `msToFirstByte: null`. The council had already answered
 * on both — one usable draft on the first, two on the second — and those drafts
 * were paid for, sitting in `validResponses`, when the route wrote an error
 * frame instead.
 *
 * The synthesis fallback chain cannot help there: it is reached only after the
 * head fails, and the head fails BY exhausting the turn budget, so every rung
 * below it starts with nothing left. The drafts in hand cost nothing and are
 * already on the machine.
 *
 * The invariant: A TURN THAT HOLDS COUNCIL DRAFTS NEVER ENDS WITH NO ANSWER.
 */
test('a stalled synthesis degrades to the first usable draft', () => {
  const drafts = [{ model: 'a', content: 'Paris is the capital of France.' }, { model: 'b', content: 'Paris.' }];
  assert.equal(degradeAnswer({ wroteChars: 0, drafts }), 'Paris is the capital of France.');
});

test('a draft is trimmed, and an empty one is skipped rather than streamed blank', () => {
  const drafts = [{ content: '   ' }, { content: '  real answer  ' }];
  assert.equal(degradeAnswer({ wroteChars: 0, drafts }), 'real answer');
});

test('nothing to degrade to stays nothing — the error frame is still correct', () => {
  assert.equal(degradeAnswer({ wroteChars: 0, drafts: [] }), null);
  assert.equal(degradeAnswer({ wroteChars: 0, drafts: [{ content: '' }] }), null);
  assert.equal(degradeAnswer({}), null);
});

/**
 * The two refusals, both of which are ways this could make a turn WORSE.
 */
test('never after a partial answer has reached the socket', () => {
  // streamModel keeps the same rule for its fallback chain: appending a second,
  // different answer to the first half of one reads as an answer that changes
  // its mind mid-sentence.
  const drafts = [{ content: 'a whole other answer' }];
  assert.equal(degradeAnswer({ wroteChars: 12, drafts }), null);
});

test('never on an aborted turn', () => {
  // A cancelled turn is not a failed one. Writing a draft to a socket the user
  // has left spends nothing but says the turn completed when it did not.
  const drafts = [{ content: 'an answer nobody is waiting for' }];
  assert.equal(degradeAnswer({ aborted: true, wroteChars: 0, drafts }), null);
});

test('a bare string draft is accepted, so the shape of validResponses is not a coupling', () => {
  assert.equal(degradeAnswer({ wroteChars: 0, drafts: ['plain text draft'] }), 'plain text draft');
});

/**
 * THE WIRING, ASSERTED IN THE SOURCE, because `server.js` calls
 * `process.exit(1)` at import time and cannot be required in a test. Same seam
 * as `stream-open-order.test.js`; asserted by POSITION rather than by exact
 * text, so a reflowed line does not fail it.
 */
const SOURCE = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');

const at = (needle) => {
  const i = SOURCE.indexOf(needle);
  assert.notEqual(i, -1, `anchor vanished from server.js: ${needle}`);
  return i;
};

test('the synthesis stream is wrapped, and its failure reaches degradeAnswer', () => {
  assert.ok(SOURCE.includes("require('./lib/synthesis-degrade')"), 'server.js must load the degrade decision');
  const synth = at('await streamModel(res, synthesis.model');
  const call = at('degradeAnswer({');
  assert.ok(call > synth, 'the degrade decision belongs on the synthesis failure path, below the call it recovers');
  // Between the two: the catch that makes the failure reachable at all.
  const between = SOURCE.slice(synth, call);
  assert.match(between, /catch\s*\(/, 'the synthesis call must be wrapped in a catch or the throw leaves the route');
});

test('the degraded draft is written to the socket and the turn is not left open', () => {
  const call = at('degradeAnswer({');
  const after = SOURCE.slice(call, call + 1500);
  assert.match(after, /sendEvent\(res, \{ type: 'chunk'/, 'the draft must be sent as an ordinary chunk frame');
  /* TELEMETRY, NOT DECORATION. `msToFirstByte` is read from `firstChunkAt`, and
   * null is how the reliability rows say "this turn answered with nothing" —
   * the exact reading this path exists to stop being true. Unstamped, a
   * recovered turn is indistinguishable from the failure it recovered. */
  assert.ok(
    after.indexOf('res.locals.firstChunkAt = Date.now()') !== -1
    && after.indexOf('res.locals.firstChunkAt = Date.now()') < after.indexOf("sendEvent(res, { type: 'chunk'"),
    'the degraded answer must stamp firstChunkAt before it is written, or msToFirstByte stays null',
  );
  assert.match(after, /data: \[DONE\]/, 'the stream must be terminated like every other answer');
});

test('a degraded turn does not write the shared answer cache', () => {
  // The cache is shared across users and stores finished answers. A draft that
  // reached the user only because synthesis died is not one, and caching it
  // would serve the failure for the whole TTL.
  const call = at('degradeAnswer({');
  const after = SOURCE.slice(call, call + 1500);
  assert.doesNotMatch(after, /cacheAnswer\(/, 'a degraded answer must not be cached');
});

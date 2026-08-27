'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const { degradeAnswer, looksInternal, isSafeDraft } = require('./synthesis-degrade');
const { deadlineSignal } = require('./stream-deadline');

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
  const drafts = [
    { model: 'a', content: 'Paris is the capital of France.', textSource: 'content' },
    { model: 'b', content: 'Paris.', textSource: 'content' },
  ];
  assert.equal(degradeAnswer({ wroteChars: 0, drafts }), 'Paris is the capital of France.');
});

test('a draft is trimmed, and an empty one is skipped rather than streamed blank', () => {
  const drafts = [{ content: '   ', textSource: 'content' }, { content: '  real answer  ', textSource: 'content' }];
  assert.equal(degradeAnswer({ wroteChars: 0, drafts }), 'real answer');
});

test('nothing to degrade to stays nothing — the error frame is still correct', () => {
  assert.equal(degradeAnswer({ wroteChars: 0, drafts: [] }), null);
  assert.equal(degradeAnswer({ wroteChars: 0, drafts: [{ content: '', textSource: 'content' }] }), null);
  assert.equal(degradeAnswer({}), null);
});

/**
 * The two refusals, both of which are ways this could make a turn WORSE.
 */
test('never after a partial answer has reached the socket', () => {
  // streamModel keeps the same rule for its fallback chain: appending a second,
  // different answer to the first half of one reads as an answer that changes
  // its mind mid-sentence.
  const drafts = [{ content: 'a whole other answer', textSource: 'content' }];
  assert.equal(degradeAnswer({ wroteChars: 12, drafts }), null);
});

test('never on an aborted turn', () => {
  // A cancelled turn is not a failed one. Writing a draft to a socket the user
  // has left spends nothing but says the turn completed when it did not.
  const drafts = [{ content: 'an answer nobody is waiting for', textSource: 'content' }];
  assert.equal(degradeAnswer({ aborted: true, wroteChars: 0, drafts }), null);
});

/**
 * PROVENANCE, NOT PROSE-SNIFFING.
 *
 * `lib/model-reply.js` keeps the fallback from `content` to `reasoning` — some
 * models write the whole answer there when reasoning is excluded, and removing
 * it blanks those seats — and it LABELS the result: `textSource` is 'content'
 * or 'reasoning'. Its own header says why: "a caller that must not show
 * internal reasoning to a user, or must not write it into a shared answer
 * cache, can now test `textSource` instead of guessing."
 *
 * Before this feature every draft was read by the synthesiser, which wrote its
 * own words. Degradation is a NEW direct-to-user path, so this is the caller
 * that must test it. Reasoning is refused, never sanitised: there is no
 * deterministic edit that turns a scratchpad into an answer.
 */
test('a reasoning-sourced draft is skipped in favour of a content-sourced one', () => {
  const drafts = [
    { model: 'a', content: "Hmm, the user wants the capital. Let me think. It's Paris.", textSource: 'reasoning' },
    { model: 'b', content: 'Paris.', textSource: 'content' },
  ];
  assert.equal(degradeAnswer({ wroteChars: 0, drafts }), 'Paris.');
});

test('a reasoning-sourced draft alone degrades to NOTHING, and its text never leaves', () => {
  const scratchpad = "Okay, so the user is asking... wait, no. Let me reconsider. Actually the answer is 42.";
  const drafts = [{ model: 'a', content: scratchpad, textSource: 'reasoning' }];
  assert.equal(degradeAnswer({ wroteChars: 0, drafts }), null);
});

test('provenance that is missing or unknown is refused, not assumed safe', () => {
  // A path that does not plumb `textSource` must lose the recovery, not gain a
  // silent exemption from it. That is what makes this a provenance check
  // rather than a naming convention.
  assert.equal(degradeAnswer({ wroteChars: 0, drafts: ['plain text draft'] }), null);
  assert.equal(degradeAnswer({ wroteChars: 0, drafts: [{ content: 'no label' }] }), null);
  assert.equal(degradeAnswer({ wroteChars: 0, drafts: [{ content: 'empty label', textSource: 'none' }] }), null);
});

test('isSafeDraft is the single predicate, so the solo branch cannot drift from this one', () => {
  assert.equal(isSafeDraft({ content: 'Paris.', textSource: 'content' }), true);
  assert.equal(isSafeDraft({ content: 'thinking out loud', textSource: 'reasoning' }), false);
  assert.equal(isSafeDraft({ content: 'As an expert in the ALOP-AI Council, Paris.', textSource: 'content' }), false);
  assert.equal(isSafeDraft({ content: '   ', textSource: 'content' }), false);
  assert.equal(isSafeDraft(undefined), false);
});

test('a provider-truncated draft is not safe for direct degradation', () => {
  const truncated = { content: 'The rollout should begin with a baseline', textSource: 'content', finishReason: 'length' };
  const complete = { content: 'The rollout should begin with a baseline.', textSource: 'content', finishReason: 'stop' };
  assert.equal(isSafeDraft(truncated), false);
  assert.equal(degradeAnswer({ wroteChars: 0, drafts: [truncated, complete] }), 'The rollout should begin with a baseline.');
});

/**
 * ROWS 2 AND 3, REPRODUCED AT THE SEAM THAT DECIDES THEM.
 *
 * The failure is not "the turn was aborted". `turns.meta.reliability` for both
 * rows reads `"aborted": false, "abortReason": null` at TURN level; the
 * `aborted: true` / `abortReason: "turn_deadline"` pair the incident is
 * remembered by lives inside the `synthesis` object, which is one stream's row
 * and not the turn's. The two fields are different questions and this test is
 * the one that stops them being conflated: conflating them silently switches
 * the whole recovery off, because a deadline-derived `aborted: true` takes the
 * first refusal below and rethrows exactly as the old code did.
 */
test('THE PRODUCTION CASE: turn deadline, zero content, drafts in hand, client still connected', () => {
  const deadlineError = new Error('Stream exceeded the turn deadline');
  deadlineError.code = 'OPENROUTER_DEADLINE';
  // What server.js holds at the instant streamModel rethrows this.
  const turnSignalAborted = false; // only turnController.abort() sets it — client disconnect
  const decision = degradeAnswer({
    aborted: turnSignalAborted,
    wroteChars: 0, // msToFirstByte was null: not one content token reached the socket
    drafts: [{ model: 'nvidia/nemotron-3-nano-30b-a3b:free', content: 'The council draft that was already paid for.', textSource: 'content' }],
  });
  assert.equal(decision, 'The council draft that was already paid for.',
    'a synthesis killed by the TURN DEADLINE must degrade — this is the whole incident');
  assert.equal(deadlineError.name, 'Error', 'a deadline error is not an AbortError; only a client abort is');
});

test('the turn deadline aborts the stream and does NOT abort the turn signal', () => {
  /* The load-bearing fact under the test above, asserted against the real
   * module rather than assumed from a variable name. If lib/stream-deadline.js
   * ever aborts the parent instead of the composite, `aborted` above becomes
   * true in production and the recovery goes quiet — with every test still
   * green, because every other test passes the flag in by hand. */
  let fire = null;
  const timers = {
    now: () => 1_000,
    setTimer: (fn) => { fire = fn; return { unref() {} }; },
    clearTimer: () => { fire = null; },
  };
  const turn = new AbortController();
  const { signal } = deadlineSignal(turn.signal, 1_000 + 75_000, timers);
  fire();
  assert.equal(signal.aborted, true, 'the stream must be cut at the turn deadline');
  assert.equal(signal.reason?.code, 'OPENROUTER_DEADLINE');
  assert.equal(turn.signal.aborted, false,
    'the TURN signal must survive the deadline, or degradeAnswer sees a cancelled turn and refuses');
});

/**
 * ANSWER SAFETY. A draft is written for the Chief Synthesiser, whose rule 6 is
 * never to mention the panel. Sending one to the reader removes that filter,
 * and the seat prompt hands the model the framing: "You are an elite AI expert
 * in the ALOP-AI Council. If outside your expertise, reply ONLY 'SKIP'."
 */
test('a draft carrying council framing is skipped, and the next clean one answers', () => {
  const drafts = [
    { content: 'As an elite AI expert in the ALOP-AI Council, I would say Paris.', textSource: 'content' },
    { content: 'Paris.', textSource: 'content' },
  ];
  assert.equal(degradeAnswer({ wroteChars: 0, drafts }), 'Paris.');
});

test('a SKIP with a reason never reaches the user', () => {
  // isUsableAnswer only rejects a BARE "skip", so this one is long enough to
  // have counted as an answer all the way to synthesis.
  assert.equal(looksInternal('SKIP — this is outside my expertise.'), true);
  assert.equal(degradeAnswer({ wroteChars: 0, drafts: [{ content: 'SKIP — outside my expertise.', textSource: 'content' }] }), null);
});

test('the synthesiser\'s own input format is refused if a seat echoes it', () => {
  assert.equal(looksInternal('[Expert 1]: the answer is 42.'), true);
  assert.equal(looksInternal('**Expert 2** disagrees.'), true);
});

test('a tool fence never streams, even though every producer already strips them', () => {
  assert.equal(looksInternal('Let me check.\n```tool_call\n{"name":"web_search"}\n```'), true);
});

test('ordinary English about councils and experts is NOT refused', () => {
  // The patterns are self-referential on purpose. Rejecting these would turn a
  // recovery into a second failure on exactly the questions people ask.
  assert.equal(looksInternal('The Council of Trent met from 1545 to 1563.'), false);
  assert.equal(looksInternal('Experts disagree about the optimal protein intake.'), false);
  assert.equal(looksInternal('Skipping breakfast is not linked to weight loss.'), false);
  assert.equal(looksInternal('The city council votes on Thursday.'), false);
});

test('a roster of nothing but internal framing lands on the error frame, not on a blank answer', () => {
  const drafts = [{ content: 'SKIP.', textSource: 'content' }, { content: 'As a member of the ALOP-AI Council, I abstain.', textSource: 'content' }];
  assert.equal(degradeAnswer({ wroteChars: 0, drafts }), null);
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
  /* THE ARGUMENT THAT DECIDES WHETHER ROWS 2 AND 3 ARE COVERED AT ALL.
   * `turnSignal.aborted` is client cancellation and nothing else. A flag
   * derived from the turn deadline — `err.code === 'OPENROUTER_DEADLINE'`, the
   * stream row's `aborted`, anything of that family — passed here would refuse
   * every deadline case, which is the only case this path exists for, and no
   * unit test would notice because they all pass the flag in by hand. */
  const args = SOURCE.slice(call, call + 400);
  assert.match(args, /aborted: turnSignal\.aborted/,
    'the abort argument must be the CLIENT abort; a deadline-derived flag disables the recovery');
  assert.doesNotMatch(args.split('})')[0], /OPENROUTER_DEADLINE|abortReason/,
    'the deadline must not be folded into the abort argument');
});

test('the degraded draft is written to the socket and the turn is not left open', () => {
  const call = at('degradeAnswer({');
  const after = SOURCE.slice(call, call + 2600);
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

test('every seat producer records where its text came from', () => {
  /* The provenance exists in lib/model-reply.js and was being dropped at the
   * council boundary: `callModel` returns a STRING by default, and the tools
   * path reads `parseToolRequests(reply).text`. Both discard `textSource`.
   * These are the four places a seat's text is produced; each must record it,
   * or `validResponses` carries answers with no provenance and the recovery
   * refuses them. */
  assert.match(SOURCE, /seatTextSource\.set\(/, 'the provenance map must actually be written');
  const recorded = SOURCE.match(/noteSeatSource\(/g) || [];
  // Four producers: the tools seat, the native seat, the tool plain fallback,
  // and the plain council (which the progressive council also runs through).
  assert.ok(recorded.length >= 4,
    `expected four seat producers to record provenance; found ${recorded.length}`);
  assert.match(SOURCE, /textSource: seatTextSource\.get\(/,
    'validResponses entries must carry the recorded provenance to degradeAnswer');
});

test('the solo branch answers from the SAME predicate, so it cannot expose reasoning either', () => {
  /* The one-seat branch streams a draft straight to the reader and writes it
   * into the SHARED answer cache. It is the other direct-to-user path and it
   * predates this work; a second copy of the rule here would drift from the
   * one degradeAnswer uses. */
  const solo = at('const soleDraft =');
  const synth = at('// 6. SYNTHESIS');
  const branch = SOURCE.slice(solo, synth);
  assert.match(branch, /isSafeDraft\(/,
    'the solo branch must use the shared safety predicate before streaming a seat draft');
});

test('a degraded turn does not write the shared answer cache', () => {
  // The cache is shared across users and stores finished answers. A draft that
  // reached the user only because synthesis died is not one, and caching it
  // would serve the failure for the whole TTL.
  const call = at('degradeAnswer({');
  const after = SOURCE.slice(call, call + 2600);
  assert.doesNotMatch(after, /cacheAnswer\(/, 'a degraded answer must not be cached');
});

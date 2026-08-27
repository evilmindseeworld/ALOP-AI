'use strict';

/**
 * THE LARGEST PHASE IN A TURN WAS THE ONE WITH THE LEAST TELEMETRY.
 *
 * Traced on the production turn 2026-08-19T01:21:03.9Z (commit 09dcd6e):
 * `synthesisMs: 37402` — 50.8% of a 73 651 ms turn — with `providerRequests: 6`
 * and `byOutcome {ok:3, bad_body:2, http_error:1}` for the WHOLE turn. Nothing
 * in the row said how many of those six requests synthesis made, how long any
 * one took, or whether the 37.4s was one slow call or several sequential ones.
 *
 * The data existed the whole time. `streamOnce` passes `answerOptions.onAttempt`
 * (server.js, `answerOptions` carries `recordAttempt('synthesis')`) and
 * `recordProviderAttempt` stores a phase-tagged row per physical request —
 * `snapshot()` then emitted only the aggregate. That half is fixed in
 * turn-telemetry.js and covered by its own tests.
 *
 * This file covers the half that lives in `server.js`, which cannot be
 * `require`d in a test (it calls `process.exit(1)` at import time on missing
 * env), so it asserts on the SOURCE the way seat-audit-wiring and cors-wiring
 * already do.
 *
 * WHAT IS STILL MISSING WITHOUT IT: `streamModel` walks a fallback chain and
 * reports the landing model through `onModelUsed`, which OVERWRITES. A turn
 * that fell head -> rung2 -> rung3 is indistinguishable from one that never
 * fell, so `synthesisMs` covering three sequential attempts reads exactly like
 * one slow model. The reason must be CLASSIFIED rather than quoted: a provider
 * refusal can echo the request it refused, and `audit_owner_read` makes the
 * audit bag user-visible.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SOURCE = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
const between = (from, to) => SOURCE.slice(SOURCE.indexOf(from), SOURCE.indexOf(to));
const STREAM_MODEL = between('const streamModel = async', 'const callGeminiVision');

test('streamModel reports every fallback rung it takes', () => {
  assert.ok(
    /onFallback\?\.\(/.test(STREAM_MODEL),
    'the fallback loop must announce the rung it is about to take; `onModelUsed` overwrites and cannot show a chain',
  );
  assert.ok(
    /from:/.test(STREAM_MODEL) && /to: entry\.model/.test(STREAM_MODEL),
    'a fallback record names both ends, or it cannot reconstruct the ladder',
  );
});

test('the fallback reason is classified, never the provider message', () => {
  const call = STREAM_MODEL.slice(STREAM_MODEL.indexOf('onFallback?.('));
  const record = call.slice(0, call.indexOf('\n', call.indexOf('})')) + 1);
  assert.ok(
    !/lastError\.message|err\.message|fallbackErr\.message/.test(record),
    'a provider message can quote the request it refused and this bag is user-visible',
  );
  assert.ok(
    /classifyFallbackReason|reason: [a-zA-Z]/.test(record),
    'the reason must come from a classifier, not from free text',
  );
});

test('the classifier maps the outcomes this turn actually produced', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('const classifyFallbackReason'));
  const body = fn.slice(0, fn.indexOf('\n};') + 3);
  assert.ok(body.length > 0, 'classifyFallbackReason must exist');
  for (const expected of ['deadline', 'aborted', 'http_']) {
    assert.ok(body.includes(expected), `the classifier must name \`${expected}\``);
  }
});

test('synthesis routes its fallbacks into the audit row under its own phase', () => {
  assert.ok(
    /synthesisOptions\.onFallback\s*=/.test(SOURCE),
    'the synthesis call must wire onFallback, or the chain is recorded nowhere',
  );
  const wire = SOURCE.slice(SOURCE.indexOf('synthesisOptions.onFallback'));
  const stmt = wire.slice(0, wire.indexOf('\n') + 1);
  assert.ok(/recordModelFallback/.test(stmt), 'it must land in the turn telemetry');
  assert.ok(/phase: 'synthesis'/.test(stmt), 'and be attributable to the synthesis phase');
});

/* The counterpart already in place, asserted so a refactor cannot quietly drop
 * the per-attempt sink that makes the rest of this measurable. */
test('synthesis still reports every physical provider attempt', () => {
  assert.ok(
    /onAttempt: recordAttempt\('synthesis'\)/.test(SOURCE),
    'answerOptions must carry the synthesis attempt sink',
  );
});

/* THREE PATHS SYNTHESISE, NOT ONE. The council path is the common one, but a
 * searched turn and a Wikipedia turn each run their own synthesis with their
 * own fallback chain, and each was losing the ladder the same way. Distinct
 * phase labels, so the rollup can tell a slow search synthesis from a slow
 * council one instead of averaging them into a single unattributable number. */
test('every synthesis path records its fallback chain under a distinct phase', () => {
  const phases = [...SOURCE.matchAll(/onFallback = \(row\) => telemetry\.recordModelFallback\(\{ \.\.\.row, phase: '([a-z_]+)' \}\)/g)]
    .map((m) => m[1]);
  assert.deepEqual(phases.sort(), ['search_synthesis', 'synthesis', 'wiki_synthesis']);
  assert.equal(new Set(phases).size, phases.length, 'two paths sharing a label cannot be told apart');
});

/* THE HANDSHAKE IS NOT THE GENERATION, AND ONLY ONE OF THEM WAS TIMED.
 *
 * `fetchOpenRouterStream` reports its attempt at handoff and clears the timer
 * that bounded opening in the same `finally`. Everything after that — the whole
 * body — is read by `streamOnce` under no bound of its own.
 *
 * Traced turn: synthesis began with 40 463 ms of nominal budget left and spent
 * 37 402 ms of it, 92.4%, from ONE stream with zero retries and zero rungs. An
 * attempt row would have said "a few hundred ms to open" and nothing about the
 * 37 seconds that followed.
 *
 * `streamOnce` stamps the clocks onto `meta` and `streamModel` reports from
 * them. That split is load-bearing rather than stylistic: a stream cut by the
 * turn signal after 70s of crawling has no return value to carry timings out
 * in, and it is the single most important stream to have timed. `meta.stream`
 * is created only once a stream has actually opened, so a non-streaming call
 * can never stamp a body time.
 */
/* BARE identifier only. `st.firstContentAt` and `meta.stream.firstContentAt`
 * are property reads on an object passed by reference and are legal anywhere;
 * an unqualified `firstContentAt` outside this function is the ReferenceError. */
const BARE = /(?<![.\w])firstContentAt/;

const STREAM_ONCE = between('const streamOnce = async', 'const classifyFallbackReason');

test('streamOnce stamps the body clocks where a throw can still reach them', () => {
  assert.ok(/meta\.stream = \{/.test(STREAM_ONCE), 'the clocks must live on meta, by reference');
  for (const field of ['requestedAt', 'openedAt', 'firstContentAt', 'endedAt', 'completed']) {
    assert.ok(new RegExp(`${field}[:.]`).test(STREAM_ONCE), `meta.stream must carry ${field}`);
  }
  assert.ok(
    STREAM_ONCE.indexOf('meta.stream = {') > STREAM_ONCE.indexOf('if (!response.body)'),
    'the ledger must be created AFTER the stream opens, or a failed handshake would report a body time',
  );
});

test('streamModel reports a stream timing on the success AND the failure path', () => {
  const calls = (STREAM_MODEL.match(/reportStream\(/g) || []).length;
  assert.ok(calls >= 6, `every streamOnce call needs a report on both outcomes; found ${calls}`);
  assert.ok(
    /outcome: err \? \(wasAborted \? 'aborted' : 'failed'\) : 'ok'/.test(STREAM_MODEL),
    'a cut stream and a broken one are different diagnoses',
  );
  assert.ok(/aborted: wasAborted/.test(STREAM_MODEL), 'the turn-signal abort must be recorded as such');
});

test('the three boundaries are measured from the right marks', () => {
  assert.ok(/streamOpenMs: st\.openedAt - st\.requestedAt/.test(STREAM_MODEL),
    'open = request start -> handoff');
  assert.ok(/streamBodyMs: \(st\.endedAt \?\? Date\.now\(\)\) - st\.openedAt/.test(STREAM_MODEL),
    'body = handoff -> consumed or aborted; an unfinished stream ends now, not never');
  assert.ok(/msToFirstToken: st\.firstContentAt === null \? null : st\.firstContentAt - st\.openedAt/.test(STREAM_MODEL),
    'first token is measured from the handoff and is null when nothing was emitted');
});

test('the first-token clock starts at content, not at any frame', () => {
  assert.ok(
    /noteFirstContent/.test(STREAM_ONCE) && BARE.test(STREAM_ONCE),
    'reasoning frames are held and never shown, so a first-token time measured from any frame would be a lie about what the user saw',
  );
});

test('the attempt sink is forwarded untouched, so the spend ceiling still sees every row', () => {
  assert.ok(/answerOptions\.onAttempt\(row\)/.test(STREAM_ONCE), 'every attempt row must still reach the original sink');
  assert.ok(/openedAttempt = row/.test(STREAM_ONCE), 'and the opening row is what names the attempt number and provider');
});

test('every synthesis path routes its stream timing into the audit row', () => {
  const phases = [...SOURCE.matchAll(/onStreamTiming = \(row\) => telemetry\.recordStreamTiming\(\{ \.\.\.row, phase: '([a-z_]+)' \}\)/g)]
    .map((m) => m[1]);
  assert.deepEqual(phases.sort(), ['search_synthesis', 'synthesis', 'wiki_synthesis']);
});

/* THE STREAM CLOCK IS A LOCAL, AND IT ESCAPED ONCE ALREADY.
 *
 * `firstContentAt` is declared inside `streamOnce`. The stamp that sets it sits
 * beside `res.locals.firstChunkAt = Date.now()`, and that line appears EIGHT
 * times in this file — three inside streamOnce and five in the cache-hit,
 * greeting and arithmetic branches. A blind edit that paired the two put five
 * references to an undeclared `firstContentAt` into those branches; `node -c`
 * passes, because a ReferenceError is a runtime fault, and every fast branch —
 * the ones that answer without a council — would have thrown on the next
 * request.
 *
 * Watched fail by putting one back: 4 references outside streamOnce. */
test('the stream clock is never referenced outside the function that declares it', () => {
  const declaredIn = SOURCE.slice(SOURCE.indexOf('const streamOnce = async'), SOURCE.indexOf('const classifyFallbackReason'));
  const everywhere = SOURCE.split('\n')
    .map((line, i) => ({ line: line.trim(), number: i + 1 }))
    .filter(({ line }) => BARE.test(line) && !line.startsWith('*'));
  const inside = declaredIn.split('\n').filter((l) => BARE.test(l) && !l.trim().startsWith('*')).length;
  assert.equal(
    everywhere.length,
    inside,
    `firstContentAt is a local of streamOnce; a reference outside it is a ReferenceError at runtime. Leaked at lines: ${
      everywhere.map((e) => e.number).join(', ')}`,
  );
  assert.ok(inside >= 4, 'the declaration, the stamps and the report should all be present');
});
/* THE DEADLINE MUST REACH THE BODY, NOT JUST THE HANDSHAKE.
 *
 * `streamOnce` used to hand its raw turn signal to `fetchOpenRouterStream`,
 * whose own deadline timer is cleared at handoff. Composing the deadline into
 * the signal is what makes the abort link that survives handoff carry it. See
 * lib/stream-deadline.js and its tests for the behaviour; this asserts the
 * wiring, because server.js cannot be required in a test.
 */
test('streamOnce hands the gateway a signal that carries the turn deadline', () => {
  assert.ok(/deadlineSignal/.test(STREAM_ONCE), 'the composed signal must be built here');
  assert.ok(
    /deadlineSignal\(signal, turnDeadlineAt/.test(STREAM_ONCE),
    'from the signal and the deadline the caller already passes — not a new timeout',
  );
  const fetchCall = STREAM_ONCE.slice(STREAM_ONCE.indexOf('await fetchOpenRouterStream('));
  const args = fetchCall.slice(0, fetchCall.indexOf('    );'));
  assert.ok(
    /deadlineSignal|streamSignal/.test(args),
    'the gateway must receive the composed signal, or the deadline dies at the handshake again',
  );
  assert.ok(!/^\s*signal,\s*$/m.test(args), 'the raw turn signal must not be what the gateway gets');
});

test('the composed deadline is always released, on success and on failure', () => {
  assert.ok(/releaseDeadline/.test(STREAM_ONCE), 'streamOnce must keep a disposer');
  assert.ok(
    /releaseDeadline/.test(STREAM_MODEL),
    'and streamModel must release it on every exit path, the way it reports on every exit path',
  );
});

test('streamed synthesis validates the complete answer before committing it', () => {
  const guard = STREAM_ONCE.indexOf('const answerGuard');
  const commit = STREAM_ONCE.indexOf('commitChunk(emitted.join');
  assert.ok(guard >= 0 && commit > guard, 'the final answer must pass its guard before one buffered chunk reaches the socket');
  assert.ok(/answerGuard: answerOutputGuard/.test(SOURCE), 'synthesis must wire the output/evidence guard');
  assert.ok((SOURCE.match(/deferOutput: answerNeedsBuffer/g) || []).length >= 3, 'fallback, search, and council synthesis must use the same buffering decision');
});

test('each searched or synthesized stream keeps deferred output enabled at its call site', () => {
  for (const anchor of [
    'const searchAnswer = await streamModel',
    'const wikiAnswer = await streamModel',
    'synthAnswer = await streamModel',
  ]) {
    const start = SOURCE.indexOf(anchor);
    assert.ok(start >= 0, `stream call vanished: ${anchor}`);
    const end = SOURCE.indexOf(');', start);
    assert.ok(end > start, `stream call is not closed: ${anchor}`);
    assert.match(
      SOURCE.slice(start, end),
      /deferOutput:\s*answerNeedsBuffer/,
      `${anchor} must defer commit until its output/evidence guard has run`,
    );
  }
});

test('a substituted stream is wired as degraded provenance and loses discarded model identity', () => {
  const options = SOURCE.slice(SOURCE.indexOf('const answerOptions = {'), SOURCE.indexOf('const clientHistory ='));
  assert.match(options, /streamSubstitution\s*=\s*substituted\s*\?\s*\{ \.\.\.substitution \}/);
  assert.match(options, /provenanceSynthesisFailed\s*=\s*true/);
  assert.match(options, /provenanceCompletionQuality\s*=\s*'incomplete'/);
  assert.match(options, /lastAnswerAssessment\s*=\s*substituted[\s\S]+ok:\s*false/);
  assert.match(options, /finishReason:\s*actualFinishReason/);

  for (const model of ['searchSynthesisModelUsed', 'wikiSynthesisModelUsed', 'synthesisModelUsed']) {
    const substituted = model.replace('SynthesisModelUsed', 'Substituted').replace('synthesisModelUsed', 'synthesisSubstituted');
    assert.ok(SOURCE.includes(`if (${substituted}) ${model} = null`), `${model} must not describe discarded stream text`);
  }

  const cache = SOURCE.slice(SOURCE.indexOf('const cacheAnswer ='), SOURCE.indexOf('const answerOutputGuard ='));
  assert.match(cache, /lastAnswerAssessment\s*&&\s*!lastAnswerAssessment\.ok/);
});

test('a deadline error cannot enter the stream fallback ladder', () => {
  assert.ok((STREAM_MODEL.match(/canRetryStream\(/g) || []).length >= 2, 'the head and each fallback rung must share the terminal-deadline policy');
  assert.ok(/error:\s*err/.test(STREAM_MODEL), 'the head error must reach the retry policy');
  assert.ok(/error:\s*fallbackErr/.test(STREAM_MODEL), 'a later rung deadline must stop the remaining ladder too');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSinkResponse, createSinkRequest } = require('./sink-response');

test('the answer is recovered from the SSE frames the route writes', () => {
  const res = createSinkResponse();
  res.setHeader('Content-Type', 'text/event-stream');
  res.write('data: {"type":"stage","key":"council","text":"Asking 3 seats"}\n\n');
  res.write('data: {"type":"chunk","text":"Ninety "}\n\n');
  res.write('data: {"type":"chunk","text":"days."}\n\n');
  res.write('data: [DONE]\n\n');
  res.end();

  const out = res.result();
  assert.equal(out.answer, 'Ninety days.');
  assert.equal(out.stages, 1, 'progress frames must not land in the answer');
  assert.equal(out.ended, true);
});

test('a frame that does not parse is ignored rather than thrown on', () => {
  // This is a sink for a background job. Its one contract is that it cannot be
  // the reason a turn fails, and a route that writes a comment line or a
  // half-frame must not take the job down with it.
  const res = createSinkResponse();
  res.write(': OPENROUTER PROCESSING\n\n');
  res.write('data: {"type":"chunk","text":"kept"\n\n');
  res.write('data: {"type":"chunk","text":"also kept"}\n\n');
  assert.equal(res.result().answer, 'also kept');
});

test('a refusal is kept, not swallowed', () => {
  // The route answers 402 when a ceiling is hit and 503 when the account's
  // daily model quota is gone. A job that read those as "an empty answer" would
  // write an empty answer into a cache row a real user then reads.
  const res = createSinkResponse();
  res.status(402).json({ error: 'Daily or monthly usage limit reached.' });

  const out = res.result();
  assert.equal(out.status, 402);
  assert.match(out.refusal.error, /usage limit/);
  assert.equal(out.answer, '');
  assert.equal(out.ended, true, 'a refusal ends the response; a job must not wait for more');
});

test('writes after end are dropped', () => {
  const res = createSinkResponse();
  res.write('data: {"type":"chunk","text":"first"}\n\n');
  res.end();
  assert.equal(res.write('data: {"type":"chunk","text":"second"}\n\n'), false);
  assert.equal(res.result().answer, 'first');
});

test('the disconnect handlers the route registers exist and fire once', () => {
  // The route calls res.once('close', ...) and res.once('finish', ...) BEFORE
  // it does any work. Missing them is a TypeError on the first line of every
  // background turn.
  const res = createSinkResponse();
  let finishes = 0;
  const onFinish = () => { finishes++; };
  res.once('finish', onFinish);
  res.end();
  res.end();
  assert.equal(finishes, 1, 'end() is idempotent, so a second end must not re-fire');
});

test('a sink request carries an identity and nothing borrowed', () => {
  const req = createSinkRequest({ message: 'what is a monad', userId: 'brain', userRow: { id: 'u1' } });
  assert.equal(req.body.message, 'what is a monad');
  assert.deepEqual(req.body.history, [], 'history must be empty — a turn with history is never cacheable');
  assert.equal(req.auth.userId, 'brain');
  assert.equal(req.userRow.id, 'u1');
});

test('the country reaches the route the way a real request carries it', () => {
  // The country is part of the answer-cache key. A refresh that could not set
  // it would rewrite a different row than the one expiring: the job would log a
  // success and leave the stale row exactly where it was.
  const req = createSinkRequest({ message: 'what does it cost', userId: 'brain', country: 'AE' });
  assert.equal(req.headers['cf-ipcountry'], 'AE');
  assert.deepEqual(createSinkRequest({ message: 'q', userId: 'brain' }).headers, {});
});

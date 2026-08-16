const test = require('node:test');
const assert = require('node:assert/strict');
const { describeImage, visionModels, _resetLastGood } = require('./vision');

const IMG = Buffer.from('hello').toString('base64');

const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const said = (text) => reply(200, { candidates: [{ content: { parts: [{ text }] } }] });

const stub = (responses) => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url.match(/models\/([^:]+):/)[1]);
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra fetch');
    return next;
  };
  return { fetchImpl, calls };
};

const run = (fetchImpl, models = ['gemini-2.5-flash', 'gemini-2.0-flash']) => describeImage({
  apiKey: 'k', models, prompt: 'describe', base64: IMG, fetchImpl,
});

test.beforeEach(() => _resetLastGood());

test('a retired model id falls through to the next candidate', async () => {
  const { fetchImpl, calls } = stub([
    reply(404, '{"error":{"message":"models/gemini-2.5-flash is not found for API version v1beta, or is not supported for generateContent. Call ListModels"}}'),
    said('a keyboard'),
  ]);
  assert.equal(await run(fetchImpl), 'a keyboard');
  assert.deepEqual(calls, ['gemini-2.5-flash', 'gemini-2.0-flash']);
});

test('the model that answered is tried first next time', async () => {
  const first = stub([reply(404, 'not found'), said('one')]);
  await run(first.fetchImpl);
  const second = stub([said('two')]);
  assert.equal(await run(second.fetchImpl), 'two');
  assert.deepEqual(second.calls, ['gemini-2.0-flash'], 'the retired id was tried again');
});

test('a rate limit fails the turn instead of downgrading the model', async () => {
  const { fetchImpl, calls } = stub([reply(429, 'quota exceeded')]);
  await assert.rejects(run(fetchImpl), /429/);
  assert.deepEqual(calls, ['gemini-2.5-flash'], 'a 429 must not fall through to a weaker model');
});

test('every candidate refusing surfaces the last error', async () => {
  const { fetchImpl } = stub([reply(404, 'not found'), reply(404, 'not found')]);
  await assert.rejects(run(fetchImpl), /gemini-2\.0-flash: 404/);
});

test('pro gets a stronger first candidate than free, and neither pins a preview id', () => {
  assert.equal(visionModels('pro')[0], 'gemini-pro-latest');
  assert.equal(visionModels('free')[0], 'gemini-flash-latest');
  for (const plan of ['pro', 'free']) {
    for (const model of visionModels(plan)) {
      assert.doesNotMatch(model, /preview/, `${model} is a preview id and will be retired`);
    }
  }
});

test('THE FIRST CANDIDATE IS AN ALIAS, because a dated id expires under you', () => {
  // Measured 2026-08-16: every dated id this list previously held answered 404,
  // two of them "no longer available to new users" — a list that works on one
  // account and refuses every image on another. An alias is the only id Google
  // repoints rather than retires, so it belongs at the head of both ladders.
  for (const plan of ['pro', 'free']) {
    assert.match(visionModels(plan)[0], /-latest$/, `${plan} leads with a dated id`);
  }
});

test('an oversize image is refused before any request is made', async () => {
  const { fetchImpl, calls } = stub([]);
  await assert.rejects(
    describeImage({ apiKey: 'k', models: ['gemini-2.5-flash'], prompt: 'p', base64: 'A'.repeat(12 * 1024 * 1024), fetchImpl }),
    /Image too large/,
  );
  assert.deepEqual(calls, []);
});

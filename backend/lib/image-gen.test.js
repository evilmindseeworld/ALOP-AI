const test = require('node:test');
const assert = require('node:assert/strict');
const { generateImage, IMAGE_MODELS, _resetLastGood } = require('./image-gen');

const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const drew = (data = 'AAAA', mime = 'image/png') =>
  reply(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: mime, data } }] } }] });

const stub = (responses) => {
  const calls = [];
  const bodies = [];
  const fetchImpl = async (url, init) => {
    calls.push(url.match(/models\/([^:]+):/)[1]);
    bodies.push(JSON.parse(init.body));
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra fetch');
    return next;
  };
  return { fetchImpl, calls, bodies };
};

const run = (fetchImpl, extra = {}) =>
  generateImage({ apiKey: 'k', prompt: 'a cat', fetchImpl, ...extra });

test.beforeEach(() => _resetLastGood());

test('the drawn image comes back as base64 with its own mime type', async () => {
  const { fetchImpl } = stub([drew('QUJD', 'image/jpeg')]);
  assert.deepEqual(await run(fetchImpl), { base64: 'QUJD', mime: 'image/jpeg', model: IMAGE_MODELS[0] });
});

test('snake_case inline_data is read too, because the REST shape uses it', async () => {
  const { fetchImpl } = stub([
    reply(200, { candidates: [{ content: { parts: [{ inline_data: { mime_type: 'image/png', data: 'Zm9v' } }] } }] }),
  ]);
  assert.equal((await run(fetchImpl)).base64, 'Zm9v');
});

test('a retired model id falls through to the next candidate', async () => {
  const { fetchImpl, calls } = stub([reply(404, 'is not found for API version v1beta'), drew()]);
  await run(fetchImpl);
  assert.deepEqual(calls, [IMAGE_MODELS[0], IMAGE_MODELS[1]]);
});

test('a safety refusal is surfaced in words, not turned into a blank image', async () => {
  const { fetchImpl } = stub([
    reply(200, { candidates: [{ content: { parts: [{ text: "I can't create that image." }] } }] }),
  ]);
  await assert.rejects(run(fetchImpl), /returned no image: I can't create that image\./);
});

test('a 200 with no parts at all still fails instead of returning undefined', async () => {
  const { fetchImpl } = stub([reply(200, { promptFeedback: { blockReason: 'SAFETY' } })]);
  await assert.rejects(run(fetchImpl), /returned no image: SAFETY/);
});

test('an edit sends the source image alongside the instruction', async () => {
  const { fetchImpl, bodies } = stub([drew()]);
  await run(fetchImpl, { inputImages: [{ base64: 'SU1H', mime: 'image/png' }] });
  const parts = bodies[0].contents[0].parts;
  assert.equal(parts[0].text, 'a cat');
  assert.deepEqual(parts[1].inline_data, { mime_type: 'image/png', data: 'SU1H' });
});

test('a rate limit fails instead of retrying on a different model', async () => {
  const { fetchImpl, calls } = stub([reply(429, 'quota exceeded')]);
  await assert.rejects(run(fetchImpl), /429/);
  assert.deepEqual(calls, [IMAGE_MODELS[0]]);
});

test('an empty prompt is refused before any request is made', async () => {
  const { fetchImpl, calls } = stub([]);
  await assert.rejects(generateImage({ apiKey: 'k', prompt: '   ', fetchImpl }), /prompt is required/);
  assert.deepEqual(calls, []);
});

test('a missing key is refused before any request is made', async () => {
  const { fetchImpl, calls } = stub([]);
  await assert.rejects(generateImage({ apiKey: '', prompt: 'a cat', fetchImpl }), /GOOGLE_API_KEY/);
  assert.deepEqual(calls, []);
});

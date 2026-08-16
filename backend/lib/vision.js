'use strict';

/* WHY THIS IS A LIST AND NOT A NAME.
 *
 * The council pinned `gemini-2.5-flash-preview-05-06` and
 * `gemini-2.5-pro-preview-05-06`. Google retires preview ids on its own
 * schedule and answers a retired one with 404, which this route surfaces as
 * "Couldn't analyse the attached image" — a permanent failure that looks like
 * a transient one, on every image the user sends. Pinning a preview id is a
 * bug with a fuse in it.
 *
 * So: stable id first, older stable ids behind it, and fall through only on a
 * model-not-found. A 429, a 500 or a timeout still fails the turn, because
 * those say nothing about the model and retrying them on a different one would
 * quietly downgrade the answer.
 */
/* MEASURED 2026-08-16 against the account's own key, one PDF per id.
 *
 * Every id this list held was 404 — `gemini-2.5-flash`, `gemini-2.5-pro` and
 * `gemini-2.0-flash` alike, the first two with "no longer available to NEW
 * USERS". So the same list can work for an older key and refuse every image on
 * this one, and the list written to survive a retirement had itself expired.
 *
 * Two things follow. The head of each list is an ALIAS (`-latest`), which is
 * the only kind of id Google repoints instead of retiring. And ListModels is
 * not evidence: it still advertises `gemini-2.5-flash`, which generateContent
 * then refuses. Only a real call to the endpoint you will use proves an id.
 *
 * Measured: gemini-flash-latest 200; gemini-flash-lite-latest 200 (861ms);
 * gemini-3.1-flash-lite 200 (3.9s); gemini-pro-latest 429 — a live id out of
 * quota, which is why it is kept and why a 429 must not fall through.
 */
const VISION_MODELS = {
  pro: ['gemini-pro-latest', 'gemini-flash-latest', 'gemini-flash-lite-latest'],
  free: ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite'],
};

const visionModels = (plan) => (plan === 'pro' ? VISION_MODELS.pro : VISION_MODELS.free);

const MODEL_GONE = /not found|is not supported|not supported for|unsupported|call ListModels/i;
const isModelGone = (status, body) => status === 404 || (status === 400 && MODEL_GONE.test(body));

/* Whichever id answered last, tried first next time. One retired-model 404 per
 * process instead of one per image. */
let lastGood = null;

const orderCandidates = (models) => {
  const list = Array.isArray(models) ? models.filter(Boolean) : [models];
  return lastGood && list.includes(lastGood) ? [lastGood, ...list.filter((m) => m !== lastGood)] : list;
};

/**
 * Describe an image with the first Gemini model that answers.
 *
 * Returns the description text (possibly empty — the caller decides whether an
 * empty read is an error). Throws on a real failure, with the last model's
 * status and body in the message so the log says which id was refused.
 */
async function describeImage({
  apiKey,
  models,
  prompt,
  base64,
  mime = 'image/png',
  maxTokens = 2048,
  signal,
  fetchImpl = fetch,
}) {
  if (!apiKey) throw new Error('GOOGLE_API_KEY not configured');
  if (Buffer.byteLength(base64, 'base64') / (1024 * 1024) > 8) throw new Error('Image too large');

  const candidates = orderCandidates(models);
  let lastError = null;
  for (const model of candidates) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: base64 } }] }],
        generationConfig: { temperature: 0.0, maxOutputTokens: maxTokens },
      }),
      signal,
    });
    if (res.ok) {
      const data = await res.json();
      lastGood = model;
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
    const body = await res.text();
    lastError = new Error(`Gemini ${model}: ${res.status} ${body.slice(0, 300)}`);
    if (!isModelGone(res.status, body)) throw lastError;
    if (lastGood === model) lastGood = null;
  }
  throw lastError || new Error('Gemini: no vision model configured');
}

// Tests only: the memo is process-wide state and a test that sets it would
// otherwise leak into the next one.
const _resetLastGood = () => { lastGood = null; };

module.exports = { describeImage, visionModels, VISION_MODELS, _resetLastGood };

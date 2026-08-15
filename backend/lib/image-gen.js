'use strict';

/**
 * Making a picture, rather than reading one.
 *
 * Same endpoint, same key and the same candidate-list discipline as
 * `lib/vision.js` — see that file for why a single pinned preview id is a bug
 * with a fuse in it. Gemini's image models answer `generateContent` with an
 * `inline_data` part instead of text, so the only real difference here is
 * which part of the response is the answer.
 */

/* Image editing and text-to-image are the same call: an input image just adds
 * a part. So one model list serves both. */
const IMAGE_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-2.5-flash-image-preview',
  'gemini-2.0-flash-preview-image-generation',
];

const MODEL_GONE = /not found|is not supported|not supported for|unsupported|call ListModels/i;
const isModelGone = (status, body) => status === 404 || (status === 400 && MODEL_GONE.test(body));

let lastGood = null;

const orderCandidates = (models) => {
  const list = (Array.isArray(models) ? models : [models]).filter(Boolean);
  return lastGood && list.includes(lastGood) ? [lastGood, ...list.filter((m) => m !== lastGood)] : list;
};

const findImagePart = (data) => {
  for (const part of data?.candidates?.[0]?.content?.parts || []) {
    const inline = part.inlineData || part.inline_data;
    if (inline?.data) return { base64: inline.data, mime: inline.mimeType || inline.mime_type || 'image/png' };
  }
  return null;
};

/**
 * Generate (or edit) one image.
 *
 * @param {object}   input
 * @param {string}   input.apiKey
 * @param {string}   input.prompt   what to draw, or what to change
 * @param {Array<{base64:string, mime:string}>} [input.inputImages] edit sources
 * @returns {Promise<{base64:string, mime:string, model:string}>}
 *
 * Throws when every candidate refuses, when the model answers with no image
 * at all, and when it refuses on safety grounds — the caller must NOT convert
 * an empty answer into a blank image. A picture that is not there is not a
 * picture, and pretending otherwise is the failure this whole file is careful
 * about.
 */
async function generateImage({
  apiKey,
  prompt,
  inputImages = [],
  models = IMAGE_MODELS,
  signal,
  fetchImpl = fetch,
}) {
  if (!apiKey) throw new Error('GOOGLE_API_KEY not configured');
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('An image prompt is required');

  const parts = [
    { text: prompt },
    ...inputImages.map((img) => ({ inline_data: { mime_type: img.mime, data: img.base64 } })),
  ];

  let lastError = null;
  for (const model of orderCandidates(models)) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
      signal,
    });
    if (res.ok) {
      const data = await res.json();
      const image = findImagePart(data);
      if (image) {
        lastGood = model;
        return { ...image, model };
      }
      /* A 200 with no image is a refusal wearing a success code — usually a
       * safety block, sometimes the model answering in words. Surface whatever
       * it said, because "it would not draw that" is an answer the user can
       * act on and a generic failure is not. */
      const said = data?.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text
        || data?.promptFeedback?.blockReason
        || data?.candidates?.[0]?.finishReason;
      throw new Error(`Gemini ${model} returned no image${said ? `: ${String(said).slice(0, 300)}` : ''}`);
    }
    const body = await res.text();
    lastError = new Error(`Gemini ${model}: ${res.status} ${body.slice(0, 300)}`);
    if (!isModelGone(res.status, body)) throw lastError;
    if (lastGood === model) lastGood = null;
  }
  throw lastError || new Error('Gemini: no image model configured');
}

const _resetLastGood = () => { lastGood = null; };

module.exports = { generateImage, IMAGE_MODELS, _resetLastGood };

'use strict';

// Parsing for base64 image data URLs sent by the browser (canvas.toDataURL and
// FileReader.readAsDataURL both produce this shape).
//
// This exists because /api/overlay hardcoded 'image/png' when calling Gemini
// regardless of what was actually attached. Screenshots happen to be PNG, so it
// went unnoticed — but a JPEG upload would be described to Gemini under the
// wrong MIME type. The type is read from the payload here instead of assumed.

const MAX_IMAGE_MB = 8;

// Anchored, and the base64 body is matched strictly, so a malformed or
// truncated payload fails here rather than at the Gemini call.
const DATA_URL_RE = /^data:(image\/(?:png|jpeg|jpg|webp|gif|heic|heif));base64,([A-Za-z0-9+/]+={0,2})$/;

/**
 * @returns {{mime: string, base64: string, bytes: number} | null} null if the
 *   input is not a well-formed image data URL, is empty, or exceeds the limit.
 */
const parseDataUrl = (input, maxMb = MAX_IMAGE_MB) => {
  if (typeof input !== 'string') return null;

  const match = DATA_URL_RE.exec(input.trim());
  if (!match) return null;

  const [, rawMime, base64] = match;
  // 'image/jpg' is not a registered type but browsers and users produce it;
  // Gemini expects 'image/jpeg'.
  const mime = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;

  const bytes = Buffer.byteLength(base64, 'base64');
  if (bytes === 0) return null;
  if (bytes > maxMb * 1024 * 1024) return null;

  return { mime, base64, bytes };
};

module.exports = { parseDataUrl, MAX_IMAGE_MB };

'use strict';

/**
 * One attachment or several, one shape for the route.
 *
 * `image` is the single data URL the shipped frontend sends; `images` is the
 * array. Both are client input, so nothing here trusts a type. The route reads
 * only what comes back from `collectAttachedImages`, which is what keeps the
 * eight downstream branches that ask "is there an attachment?" from each
 * having to ask which field the client used.
 */

/* Four, because vision is billed per image and the 50 MB body ceiling is
 * shared: four 8 MB attachments already sit inside it with room over. */
const MAX_IMAGES_PER_TURN = 4;

/**
 * @returns {string[]} the data URLs, in order. Over the limit is the caller's
 * problem to refuse — this does NOT slice, because answering about the first
 * four of five photos looks exactly like answering about all five.
 */
function collectAttachedImages({ image, images } = {}) {
  const list = Array.isArray(images) ? images : image ? [image] : [];
  return list.filter((v) => typeof v === 'string' && v.trim());
}

/**
 * Join per-image descriptions into the block the prompt carries.
 *
 * A single image keeps its unlabelled text, byte for byte, so the prompt that
 * shipped is unchanged for the only case that existed before.
 */
function combineImageDescriptions(texts) {
  if (texts.length === 1) return texts[0];
  return texts.map((t, i) => `--- Image ${i + 1} of ${texts.length} ---\n${t}`).join('\n\n');
}

module.exports = { collectAttachedImages, combineImageDescriptions, MAX_IMAGES_PER_TURN };

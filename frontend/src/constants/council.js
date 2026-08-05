/**
 * The council, as the sign-in page shows it.
 *
 * MIRRORS `COUNCIL` in backend/server.js. It is duplicated rather than fetched
 * because the sign-in page renders before the user has a token, so there is no
 * authenticated call it could make, and an unauthenticated endpoint that lists
 * the roster is a new public surface for a marketing detail.
 *
 * The drift risk is real and bounded: if a model is added or renamed on the
 * server, this list is wrong until someone updates it. It is wrong in a way
 * that is visible on the first screen of the product, which is the best kind of
 * wrong to have.
 *
 * The temperatures are the honest reason a council works. They are not
 * decoration and they are not a "01 / 02 / 03" sequence dressed up — the spread
 * from 0.2 to 0.8 is literally why seven models disagree usefully instead of
 * producing one answer seven times.
 */
export const COUNCIL = [
  { model: "glm-5.2", temperature: 0.2, free: false },
  { model: "deepseek-v4-pro", temperature: 0.4, free: false },
  { model: "kimi-k2.7-code", temperature: 0.3, free: true },
  { model: "qwen3.5", temperature: 0.5, free: true },
  { model: "nemotron-3-ultra", temperature: 0.5, free: false },
  { model: "gemma4", temperature: 0.7, free: true },
  { model: "minimax-m3", temperature: 0.8, free: false },
]
  // Sorted by temperature so the ladder reads literal at the top and lateral at
  // the bottom. That ordering IS the explanation; alphabetical would be a list
  // of names, and this is meant to be an argument.
  .sort((a, b) => a.temperature - b.temperature);

export const FREE_COUNT = COUNCIL.filter((m) => m.free).length;

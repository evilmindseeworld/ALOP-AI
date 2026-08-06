/**
 * The Council, as the sign-in page shows it.
 *
 * MIRRORS `COUNCIL` in backend/server.js. It is duplicated rather than fetched
 * because the sign-in page renders before the user has a token, so there is no
 * authenticated call it could make, and an unauthenticated endpoint that lists
 * the roster is a new public surface for a marketing detail.
 *
 * That drift risk used to be a comment saying "it is wrong until someone
 * updates it". It is now checked: backend/lib/council-roster.test.js compares
 * this file against server.js on model, temperature and tier.
 *
 * ---
 *
 * WHAT THE PAGE SHOWS, AND WHY IT IS NOT THE MODEL ID.
 *
 * Each seat is a TITLE and a COMPANY. `glm-5.2` told a visitor nothing unless
 * they already knew it, and if they already knew it, our first screen was
 * advertising someone else's product. A title says what the seat is FOR.
 *
 * The titles run the same axis the temperatures do — The Architect holds to
 * what is literally there, The Oracle is furthest from it, and the five between
 * move along that line in order. That ordering is the argument the page makes:
 * seven identical models would return one answer seven times.
 *
 * The COMPANY is named and the MODEL is not. That is a real distinction and it
 * is deliberate: which vendor is behind a seat is stable and worth stating,
 * while which of their models fills it changes and is nobody's decision but
 * ours.
 *
 * ---
 *
 * `blurb` IS AN ADVERTISING CLAIM ON A PAID PRODUCT. Treat it as one.
 *
 * The brief was "Powered by [company]'s most powerful model" on every seat.
 * Five say that. Two do not, because for those two it is false:
 *
 *   - GEMMA IS NOT GOOGLE'S MOST POWERFUL MODEL. Gemma is Google's open,
 *     lightweight family; Gemini is the flagship. This is not a close call or a
 *     matter of benchmark choice — the two lines exist to be different things.
 *   - KIMI K2.7 CODE IS A CODE-SPECIALISED VARIANT, not Moonshot's top general
 *     model. Its strength is real and it is not generality.
 *
 * The other five say "most powerful" as briefed. They are not independently
 * verified here — those model versions could not be checked — so if any turns
 * out not to be that vendor's flagship, the line has to change with it.
 *
 * Why this is worth being careful about on a login page: the product charges
 * AED 30/month, which makes every line here a claim made to induce a purchase.
 * And this page's whole design premise, recorded through every rewrite of it,
 * is that its claims are CHECKABLE. One false superlative costs more than it
 * buys, because it makes the temperature column look like decoration too.
 *
 * ---
 *
 * WHAT DOES NOT CHANGE: the PRIVACY POLICY still names every subprocessor by
 * its real model and service name, including Ollama. Marketing may choose what
 * to foreground; a privacy policy may not. Hiding a subprocessor there was the
 * exact defect the legal rewrite in 00daf6a fixed.
 *
 * `model` stays in this file because the parity test needs it and because a
 * display layer that has forgotten what it is displaying cannot be checked
 * against anything. It is never rendered — SignInPage.test.jsx asserts that.
 */
export const COUNCIL = [
  {
    model: "glm-5.2",
    temperature: 0.2,
    free: false,
    title: "The Architect",
    company: "Zhipu AI",
    blurb: "Zhipu AI's most powerful model",
  },
  {
    model: "kimi-k2.7-code",
    temperature: 0.3,
    free: true,
    title: "The Engineer",
    company: "Moonshot AI",
    // NOT "most powerful": this is the code-specialised model, and saying
    // otherwise would be false. The honest claim is the stronger one anyway —
    // it says what the seat is actually good at.
    blurb: "Moonshot AI's sharpest model for code",
  },
  {
    model: "deepseek-v4-pro",
    temperature: 0.4,
    free: false,
    title: "The Analyst",
    company: "DeepSeek",
    blurb: "DeepSeek's most powerful model",
  },
  {
    model: "qwen3.5",
    temperature: 0.5,
    free: true,
    title: "The Strategist",
    company: "Alibaba",
    blurb: "Alibaba's most powerful model",
  },
  {
    model: "nemotron-3-ultra",
    temperature: 0.5,
    free: false,
    title: "The Scholar",
    company: "NVIDIA",
    blurb: "NVIDIA's most powerful model",
  },
  {
    model: "gemma4",
    temperature: 0.7,
    free: true,
    title: "The Alchemist",
    company: "Google",
    // NOT "most powerful": Gemma is Google's open lightweight family and Gemini
    // is the flagship. Claiming otherwise on a paid product's landing page is a
    // false advertising claim, not a stretch.
    blurb: "Google's open model family",
  },
  {
    model: "minimax-m3",
    temperature: 0.8,
    free: false,
    title: "The Oracle",
    company: "MiniMax",
    blurb: "MiniMax's most powerful model",
  },
]
  // Sorted by temperature so the ladder reads literal at the top and lateral at
  // the bottom. That ordering IS the explanation; alphabetical would be a list
  // of names, and this is meant to be an argument.
  .sort((a, b) => a.temperature - b.temperature);

export const FREE_COUNT = COUNCIL.filter((m) => m.free).length;

/** Every real model id, for the test that asserts none of them reach the DOM. */
export const MODEL_IDS = COUNCIL.map((m) => m.model);

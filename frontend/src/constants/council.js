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
 * Each seat is a TITLE and a COMPANY. A raw model id tells a visitor nothing unless
 * they already knew it, and if they already knew it, our first screen was
 * advertising someone else's product. A title says what the seat is FOR.
 *
 * The titles run the same axis the temperatures do — The Architect holds to
 * what is literally there, The Explorer is furthest from it, and the five
 * between move along that line in order. That ordering is the argument the page
 * makes: seven identical models would return one answer seven times.
 *
 * The last seat was "The Oracle" and was renamed on evidence. Research on
 * anthropomorphism in AI splits persona names into ones that signal a ROLE and
 * ones that signal AUTHORITY: role names calibrate what a user expects, while
 * authority names inflate it and are punished harder when the system is wrong.
 * "Oracle" promises foresight, and it sat on the 0.8 seat — the most lateral,
 * the likeliest to be wrong, and Pro-only. It was the seat most likely to
 * disappoint wearing the name that promised most. "Explorer" carries the same
 * lateral meaning without claiming to be right.
 *
 * The COMPANY is named and the MODEL is not. That is a real distinction and it
 * is deliberate: which vendor is behind a seat is stable and worth stating,
 * while which of their models fills it changes and is nobody's decision but
 * ours.
 *
 * ---
 *
 * THERE IS NO SUPERLATIVE HERE, AND THAT IS DELIBERATE. DO NOT ADD ONE BACK.
 *
 * An earlier draft read "Powered by [company]'s most powerful model" under every
 * seat. It was removed, and the reasons are worth keeping because the line is
 * tempting and the objection is not obvious.
 *
 * 1. IT WAS FALSE ON TWO SEATS. gemma-4-26b-a4b is Google's small MoE,
 *    and gpt-oss-20b is OpenAI's open-weights model, not GPT.
 *
 * 2. IT WAS UNVERIFIABLE ON THE OTHER FIVE. Nobody here has checked that these
 *    versions are their vendors' flagships, and a claim you cannot check is one
 *    you cannot defend.
 *
 * 3. IT DID NOT MATCH HOW THE SERVICE ACTUALLY ROUTES, which is the objection
 *    that survives even if every seat really were a flagship. Greetings never
 *    reach the council at all. The search and Wikipedia paths answer from a
 *    single PRIMARY_MODEL. The fallback is one model. runCouncilWithWhip
 *    resolves at a quorum of 3, so a Pro user routinely gets three of seven and
 *    a free user only ever has three seats. "Powered by the most powerful
 *    model" describes none of that.
 *
 * Under FTC standards a line like that is a source claim AND a comparative
 * performance claim, and both require substantiation. The product charges
 * AED 30/month, so every line here is made to induce a purchase. And this page's
 * whole premise — kept through every rewrite of it — is that its claims are
 * CHECKABLE. One unverifiable superlative makes the temperature column read as
 * decoration too, which costs more than the superlative buys.
 *
 * Naming the COMPANY has the marketing value anyway. Only about a quarter of
 * AI products hide their vendors; naming them is the norm and reads as a
 * quality signal. The company is a fact, it needs no substantiation, and it
 * does not have to be revisited every time a model is swapped.
 *
 * ---
 *
 * WHAT DOES NOT CHANGE: the PRIVACY POLICY still names every subprocessor by
 * its real model and service name, including OpenRouter and its upstream
 * providers. Marketing may choose what
 * to foreground; a privacy policy may not. Hiding a subprocessor there was the
 * exact defect the legal rewrite in 00daf6a fixed.
 *
 * `model` stays in this file because the parity test needs it and because a
 * display layer that has forgotten what it is displaying cannot be checked
 * against anything. It is never rendered — SignInPage.test.jsx asserts that.
 */
export const COUNCIL = [
  {
    model: "nvidia/nemotron-3-super-120b-a12b:free",
    temperature: 0.2,
    free: false,
    title: "The Architect",
    company: "NVIDIA",
  },
  {
    model: "inclusionai/ling-3.0-tiny:free",
    temperature: 0.3,
    free: true,
    title: "The Engineer",
    company: "InclusionAI",
  },
  {
    model: "openai/gpt-oss-20b:free",
    temperature: 0.4,
    free: false,
    title: "The Analyst",
    company: "OpenAI",
  },
  {
    model: "poolside/laguna-s-2.1:free",
    temperature: 0.5,
    free: false,
    title: "The Strategist",
    company: "Poolside",
  },
  {
    model: "google/gemma-4-31b-it:free",
    temperature: 0.6,
    free: false,
    title: "The Scholar",
    company: "Google",
  },
  {
    model: "google/gemma-4-26b-a4b-it:free",
    temperature: 0.7,
    free: true,
    title: "The Alchemist",
    company: "Google",
  },
  {
    model: "nvidia/nemotron-3-nano-30b-a3b:free",
    temperature: 0.8,
    free: true,
    title: "The Explorer",
    company: "NVIDIA",
  },
]
  // Sorted by temperature so the ladder reads literal at the top and lateral at
  // the bottom. That ordering IS the explanation; alphabetical would be a list
  // of names, and this is meant to be an argument.
  .sort((a, b) => a.temperature - b.temperature);

export const FREE_COUNT = COUNCIL.filter((m) => m.free).length;

/** Every real model id, for the test that asserts none of them reach the DOM. */
export const MODEL_IDS = COUNCIL.map((m) => m.model);

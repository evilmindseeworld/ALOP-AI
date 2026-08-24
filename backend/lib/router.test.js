const test = require("node:test");
const assert = require("node:assert/strict");
const {
  detectLanguage,
  wantsDetailedAnswer,
  needsWikiCheck,
  classifyRequest,
  routeByRule,
  assessComplexity,
  ROUTING_RULES,
  ROUTING_POLICY,
  modelDesignations,
  namesSpecificModel,
  DETAIL_PHRASES,
  escalateForResearch,
  narrowRoster,
  rosterForPlan,
  MAX_FREE_SEATS,
  withToolSeat,
} = require("./router");

// ===== language: the overlap bug =====
//
// Every case in this block returned the WRONG language before the router was
// extracted, and none of them produced an error. The failure was a German
// question answered fluently in French.

test("German is not claimed by French because they share ü", () => {
  assert.equal(detectLanguage("Über die Straße, Herr Müller"), "German");
  assert.equal(detectLanguage("Grüße aus München"), "German");
  assert.equal(detectLanguage("Zürich ist schön"), "German");
});

test("Spanish is not claimed by French because they share é", () => {
  assert.equal(detectLanguage("El café está más frío"), "Spanish");
  assert.equal(detectLanguage("¿Dónde está la estación?"), "Spanish");
  assert.equal(detectLanguage("Mañana quizás sí"), "Spanish");
});

test("French still wins where the evidence is French", () => {
  assert.equal(detectLanguage("Bonjour, ça va très bien"), "French");
  assert.equal(detectLanguage("Le déjeuner à Zürich était très bon"), "French");
});

test("the count decides, not the order — one distinctive character is enough", () => {
  // "Straße": ü is shared and settles nothing, ß is German and settles it.
  assert.equal(detectLanguage("Straße"), "German");
  assert.equal(detectLanguage("¿Qué?"), "Spanish");
  assert.equal(detectLanguage("ça"), "French");
});

test("a shared-only sentence falls to French, the declared tie-break", () => {
  // Two é and nothing else. French and Spanish score identically; the tie is
  // resolved by declaration order and documented as such.
  assert.equal(detectLanguage("J'ai réservé"), "French");
});

// ===== language: scripts =====

test("Japanese is not claimed by Chinese because it also uses Han", () => {
  // The reason kana are checked first. Nearly every real Japanese sentence
  // contains a kanji, so a Han-first check claimed nearly all of them.
  assert.equal(detectLanguage("私は日本語を話します"), "Japanese");
  assert.equal(detectLanguage("東京に行きたい"), "Japanese");
  assert.equal(detectLanguage("カタカナのテスト"), "Japanese");
});

test("Han with no kana is reported as Chinese — the documented ceiling", () => {
  assert.equal(detectLanguage("你好，世界"), "Chinese");
  assert.equal(detectLanguage("我想去北京"), "Chinese");
});

test("the unambiguous scripts are unambiguous", () => {
  assert.equal(detectLanguage("مرحبا كيف حالك"), "Arabic");
  assert.equal(detectLanguage("안녕하세요"), "Korean");
  assert.equal(detectLanguage("Привет, как дела"), "Russian");
});

test("plain text is English, and so is anything unrecognised", () => {
  assert.equal(detectLanguage("Hello there"), "English");
  assert.equal(detectLanguage(""), "English");
  assert.equal(detectLanguage(undefined), "English");
  assert.equal(detectLanguage(null), "English");
  // The documented ceiling: unaccented German reads as English. That is the
  // safe direction — no "Respond in X" line is added, so the model follows the
  // user's own language rather than being pointed at the wrong one.
  assert.equal(detectLanguage("Guten Tag, wie geht es Ihnen"), "English");
});

test("detection is stateless across calls", () => {
  // The Latin patterns carry /g, which makes a shared RegExp object stateful
  // via lastIndex. String.match resets it; a .test loop would not have.
  for (let i = 0; i < 3; i++) assert.equal(detectLanguage("Grüße"), "German");
  for (let i = 0; i < 3; i++) assert.equal(detectLanguage("ça va"), "French");
});

// ===== detail =====

test("a request to write something SHORT is not marked detailed", () => {
  // `write a` was a trigger, so every one of these set "Be thorough".
  for (const t of ["write a haiku", "write a tweet", "write a commit message"]) {
    assert.equal(wantsDetailedAnswer(t), false, t);
  }
});

test("phrases that name length still set the flag", () => {
  for (const t of [
    "explain in detail",
    "give me a comprehensive overview",
    "walk me through it step by step",
    "I want an in-depth answer",
    "write an essay about the treaty",
  ]) {
    assert.equal(wantsDetailedAnswer(t), true, t);
  }
});

test("every remaining phrase names length, so none can mean the opposite", () => {
  // The guard on the fix: if someone re-adds a phrase like "write a", this
  // fails. Each entry must contain a word about size or depth.
  const LENGTH_WORDS =
    /detail|depth|comprehensive|thorough|step|deep|elaborate|full|essay/;
  for (const p of DETAIL_PHRASES) {
    assert.match(p, LENGTH_WORDS, `"${p}" does not name length`);
  }
});

test("detail matching is case-insensitive and survives odd input", () => {
  assert.equal(wantsDetailedAnswer("Explain In Detail please"), true);
  assert.equal(wantsDetailedAnswer(""), false);
  assert.equal(wantsDetailedAnswer(null), false);
});

// ===== wikipedia =====

test("word boundaries stop the substring false positives", () => {
  // Each of these added a Wikipedia provider to the fan-out for nothing.
  // `origin` was the expensive one: it matched "original" and "originally".
  assert.equal(needsWikiCheck("the original plan"), false);
  assert.equal(needsWikiCheck("originally it was blue"), false);
  assert.equal(needsWikiCheck("airborne particles"), false);
  assert.equal(needsWikiCheck("reborn as a startup"), false);
});

test("generic factual questions stay with the plain council", () => {
  for (const t of [
    "What is machine learning?",
    "what are neural networks?",
    "explain photosynthesis",
    "definition of entropy",
    "tell me about caching",
    "who is the CEO?",
    "clear my browser history",
  ]) {
    assert.equal(needsWikiCheck(t), false, t);
  }
});

test("explicit encyclopedic lookups still fire", () => {
  for (const t of [
    "look this up on Wikipedia: Ada Lovelace",
    "give me an encyclopedic overview of black holes",
    "write a biography of Ada Lovelace",
    "the history of the printing press",
    "where was she born",
    "the origins of jazz",
  ]) {
    assert.equal(needsWikiCheck(t), true, t);
  }
});

// ===== classification =====

const ROSTER = [
  { model: "a", temperature: 0.2 },
  { model: "b", temperature: 0.5 },
  { model: "c", temperature: 0.8 },
  { model: "d", temperature: 0.4 },
];

test("a bare greeting gets no council", () => {
  assert.equal(classifyRequest("hi", ROSTER).category, "greeting");
  assert.equal(classifyRequest("Hello!", ROSTER).category, "greeting");
  assert.equal(classifyRequest("  good morning  ", ROSTER).category, "greeting");
  assert.deepEqual(classifyRequest("hi", ROSTER).members, []);
});

test("a question that merely contains a greeting word is a council question", () => {
  // The whole reason the pattern is anchored: these were answered by one model
  // at 200 tokens because "hi" appeared inside them.
  for (const t of ["which one?", "you sure?", "summary?", "hi, what is a tensor?"]) {
    assert.equal(classifyRequest(t, ROSTER).category, "council", t);
  }
});

test("quorum never exceeds the seats the user actually has", () => {
  // A quorum ABOVE the seat count could never resolve early at all — the whip
  // would be reduced to its timer on every single message.
  assert.equal(classifyRequest("q", ROSTER.slice(0, 1)).quorum, 1);
  assert.equal(classifyRequest("q", []).quorum, 0);
});

test("a full free roster does NOT need unanimity", () => {
  // The regression this guards is the one that made every free-plan message
  // wait for the slowest of three models: at quorum 3 on a 3-seat roster the
  // whip can only fire on unanimity or on its 30s timer, so the early-resolve
  // path — the entire point of the whip — was dead code for that tier.
  const s = classifyRequest("q", ROSTER);
  assert.ok(s.quorum < ROSTER.length, `quorum ${s.quorum} of ${ROSTER.length} seats is unanimity`);
  assert.equal(s.quorum, 2);
});

test("the council's token ceiling follows the length the user asked for", () => {
  // A member told "Be concise" and given 2000 tokens pays for a ceiling it will
  // not reach, on the one leg the whole request blocks on. The two decisions
  // come from the same wantsDetailedAnswer call in the caller, so they cannot
  // disagree — a member told to be thorough is never the one that gets cut off.
  assert.equal(classifyRequest("q", ROSTER).tokenLimit, 1000);
  assert.equal(classifyRequest("q", ROSTER, false).tokenLimit, 1000);
  assert.equal(classifyRequest("q", ROSTER, true).tokenLimit, 2000);
  // A greeting is answered by one streaming model and reads neither number.
  assert.equal(classifyRequest("hi", ROSTER, true).tokenLimit, 200);
});

test("document-generation requests use the complex tier", () => {
  for (const text of [
    "write a story about a dragon",
    "write me a cover letter",
    "draft a project proposal for school",
    "summarise chapter 4 and write my report",
    "make a lesson plan",
    "write an essay on photosynthesis",
    "write my homework",
    "write my assignment",
    "translate this passage and write a commentary",
  ]) {
    const result = classifyRequest(text, ROSTER);
    assert.equal(result.complexity, "complex", text);
    assert.equal(result.members.length, ROSTER.length, text);
    assert.equal(result.tokenLimit, 4000, text);
  }
});

test("answer-seeking lookups stay short without a document request", () => {
  for (const text of [
    "which monitor should I buy",
    "what is a good laptop",
    "what is the best monitor for coding",
    "which laptop is good for school",
    "translate hello to Spanish",
  ]) {
    const result = classifyRequest(text, ROSTER);
    assert.equal(result.complexity, "simple", text);
    assert.equal(result.members.length, 1, text);
    assert.equal(result.tokenLimit, 400, text);
  }
});

test("generation escalation is one-directional", () => {
  const plain = classifyRequest("help with my project", ROSTER);
  const generated = classifyRequest("draft my project proposal", ROSTER);
  assert.ok(generated.members.length >= plain.members.length);
  assert.notEqual(generated.complexity, "simple");
});

// This test used to assert `members` deepEqual ROSTER — "the roster is passed
// through untouched". That invariant was deliberately retired when complexity
// tiering landed: the whole point is that an easy question does NOT get the
// whole roster. It is rewritten rather than deleted, because the half of it
// that still matters is the half that was never the headline.
test("a narrowed roster is always a SUBSET of the seats the caller allowed", () => {
  // THE ENTITLEMENT BOUNDARY. The caller decides plan → roster and hands it in;
  // this function may only ever hand seats back. If it could add one, a free
  // user could type their way onto a Pro seat, and the check that stops that
  // lives nowhere else — server.js passes `userPlan === 'pro' ? COUNCIL :
  // FREE_COUNCIL` and then trusts what comes back.
  for (const q of ["what is 2+2", "fix it", "compare React and Vue", "q"]) {
    const { members } = classifyRequest(q, ROSTER);
    assert.ok(members.length >= 1, `${q} got no seats`);
    assert.ok(members.length <= ROSTER.length, `${q} got more seats than the roster has`);
    for (const seat of members) {
      assert.ok(ROSTER.includes(seat), `${q} was given a seat that is not in the roster: ${seat.model}`);
    }
    assert.equal(new Set(members.map((m) => m.model)).size, members.length, `${q} got a duplicated seat`);
  }
});

test("only confidently simple questions narrow; uncertain questions keep the full council", () => {
  // The feature itself, stated as the inequality it has to satisfy. Written as
  // a comparison rather than as three exact counts so it keeps meaning if the
  // tier sizes are retuned — the ORDER is the contract, the numbers are policy.
  const simple = classifyRequest("what is the capital of France", ROSTER).members.length;
  const moderate = classifyRequest("my code is not working", ROSTER).members.length;
  const complex = classifyRequest("compare React and Vue", ROSTER).members.length;
  assert.ok(simple < moderate, `simple ${simple} is not fewer than moderate ${moderate}`);
  assert.equal(moderate, ROSTER.length, "an uncertain question must keep the whole roster");
  assert.equal(moderate, complex, "uncertain and explicitly complex questions both use the full council");
  assert.equal(complex, ROSTER.length, "the hardest tier must still get the whole roster");
});

test("quorum counts the seats actually dispatched, not the roster", () => {
  // THE BUG THIS TIERING WOULD OTHERWISE HAVE SHIPPED. Quorum read
  // `roster.length`, so the one-seat tier kept a quorum of 2 — unreachable, so
  // the whip could only ever fire on its 30-SECOND TIMER. The tier that exists
  // to be fast would have been the slowest path in the product, and nothing
  // would have errored: the answer still arrives, half a minute late.
  //
  // It is the same defect as "a full free roster does NOT need unanimity"
  // above, one level down, which is why that test did not catch it.
  const simple = classifyRequest("what is 2+2", ROSTER);
  assert.equal(simple.members.length, 1);
  assert.ok(
    simple.quorum <= simple.members.length,
    `quorum ${simple.quorum} exceeds the ${simple.members.length} seats dispatched — the whip can never fire`,
  );
  for (const q of ["what is 2+2", "fix it", "compare React and Vue"]) {
    const s = classifyRequest(q, ROSTER);
    assert.ok(s.quorum >= 1, `${q} got quorum 0 with ${s.members.length} seats`);
    assert.ok(s.quorum <= s.members.length, `${q}: quorum ${s.quorum} > ${s.members.length} seats`);
  }
});

test("narrowing never costs MORE wall-clock than not narrowing", () => {
  // The trap that makes this feature worth testing at all. Slicing evenly
  // across the temperature ladder picks seats 0, 3, 6 of seven — and seat 0 is
  // the slowest model on the measured roster, so the middle tier waited ~8.9s
  // where the full council resolves in ~2.1s. A tier that is slower than the
  // tier above it is absurd, and it is invisible without a stopwatch on both.
  //
  // Modelled on the real measurements, since the ROSTER above carries no
  // latencies. What a turn actually waits for is the quorum-th FASTEST seat.
  const MEASURED = [
    { model: "super-120b", temperature: 0.2, medianMs: 23900 },
    { model: "ling-tiny", temperature: 0.3, medianMs: 1200 },
    { model: "gpt-oss-20b", temperature: 0.4, medianMs: 2500 },
    { model: "laguna-s", temperature: 0.5, medianMs: 8900 },
    { model: "gemma-31b", temperature: 0.6 }, // never completed a paced call
    { model: "gemma-26b", temperature: 0.7, medianMs: 2400 },
    { model: "nano-30b", temperature: 0.8, medianMs: 2100 },
  ];
  const waitOf = (sel) =>
    sel.members
      .map((m) => m.medianMs ?? 30000)
      .sort((a, b) => a - b)[Math.max(1, sel.quorum) - 1];

  const simple = waitOf(classifyRequest("what is 2+2", MEASURED));
  const moderate = waitOf(classifyRequest("fix it", MEASURED));
  const complex = waitOf(classifyRequest("compare React and Vue", MEASURED));
  assert.ok(simple <= complex, `simple waits ${simple}ms vs complex ${complex}ms`);
  assert.ok(moderate <= complex, `moderate waits ${moderate}ms vs complex ${complex}ms — narrowing made it SLOWER`);
});

test("the narrowed roster keeps the temperature spread", () => {
  // Seats are narrowed by BAND, not by taking the n fastest, and this is why:
  // the synthesiser's prompt is about reconciling disagreement, and three seats
  // clustered at one end of the ladder are three ways of saying one thing. The
  // multi-seat tiers must therefore span the ladder rather than huddle on it.
  // Asserted as LADDER POSITIONS rather than as a temperature span, for two
  // reasons. Positions are integers, so there is no float comparison to get
  // wrong — the first draft of this test compared 0.5-0.2 against 0.6/2 and
  // failed on the last bit of a double. And positions are what the design
  // actually guarantees: bands are contiguous slices of the sorted roster, so
  // "one seat per region" is exactly "no two picks share a band", whichever
  // member of a band ends up being the fastest.
  const members = narrowRoster(ROSTER, 3);
  assert.ok(members.length >= 2, "this assertion is meaningless on a single seat");

  const ladder = [...ROSTER].sort((a, b) => a.temperature - b.temperature);
  const positions = members.map((m) => ladder.indexOf(m));
  assert.ok(!positions.includes(-1), "a picked seat is not in the roster");

  const ascending = [...positions].sort((a, b) => a - b);
  assert.deepEqual(positions, ascending, "picks are not in ladder order");
  assert.equal(new Set(positions).size, positions.length, "two picks came from the same seat");

  // Each pick sits in its own band, so together they cover the ladder rather
  // than huddling at one end. A pick may be anywhere WITHIN its band — that is
  // the latency rule doing its job — so the bound is the band, not the seat.
  const n = members.length;
  positions.forEach((pos, i) => {
    const start = Math.floor((i * ladder.length) / n);
    const end = Math.max(start + 1, Math.floor(((i + 1) * ladder.length) / n));
    assert.ok(pos >= start && pos < end, `pick ${i} at ladder position ${pos} is outside its band [${start}, ${end})`);
  });

  // And the ends of the ladder are genuinely reachable: the first pick comes
  // from the literal end, the last from the lateral end. Without this the test
  // above would pass on three seats crammed into the bottom third.
  assert.ok(positions[0] < ladder.length / n, "the first pick is not from the literal end of the ladder");
  assert.ok(positions[n - 1] >= ladder.length - Math.ceil(ladder.length / n), "the last pick is not from the lateral end");
});

test("a missing roster does not throw", () => {
  const s = classifyRequest("q", undefined);
  assert.deepEqual(s.members, []);
  assert.equal(s.quorum, 0);
});

test("the plan boundary caps free users while pro retains the full roster", () => {
  const configured = ROSTER.map((seat) => ({ ...seat, free: true }));
  const free = rosterForPlan("free", configured);
  const pro = rosterForPlan("pro", configured);

  assert.equal(MAX_FREE_SEATS, 3);
  assert.equal(free.length, 3);
  assert.deepEqual(free, configured.slice(0, 3));
  assert.equal(pro, configured);
});

// ===== zero-model routing =====

test("stable questions are settled without buying a router model call", () => {
  const stable = [
    "Name one colour of the sky",
    "define photosynthesis",
    "spell accommodation",
    "translate hello to Spanish",
    "write a haiku about rain",
    "tell me a joke about penguins",
    "explain how quicksort works",
    "What is a monad?",
    "What are prime numbers?",
    "function add(a, b) { return a + b; } explain this code",
  ];

  const decided = stable.map((text) => routeByRule(text, { hasConversationContext: false }));
  assert.equal(decided.filter(Boolean).length, stable.length, "the rule missed a labelled stable case");
  assert.ok(decided.every((route) => route.memory === false && route.queries === null));
});

test("the zero-model rule does not swallow questions whose answer can move", () => {
  const needsPlanner = [
    "latest React version",
    "who is the CEO of OpenAI",
    "best gaming monitor under 500 dollars",
    "iPhone 17 price in UAE",
    "2026 tax brackets",
    "what is OpenAI?",
    "write a report about OpenAI's current strategy",
    "is Framework 16 still available?",
    "summarize https://example.com/release-notes",
    "what is XG27AQWMG?",
    "what is iPhone?",
    "what is qzxwvb?",
  ];

  /* The property is "never answered WITHOUT live information", which is not the
   * same as "always handed to the planner" — and that difference is the whole
   * point of the product-model rule below. Three of these name a specific model,
   * and the rule now routes them straight to search instead of asking a small
   * model whether they need one. What must never appear is a no-search
   * decision. */
  const swallowed = needsPlanner.filter((text) => {
    const route = routeByRule(text, { hasConversationContext: false });
    return route && !route.memory && !route.queries?.length;
  });
  assert.deepEqual(swallowed, [], "a volatile or named-entity case was answered with no search");

  const forcedToSearch = needsPlanner.filter((text) => routeByRule(text, {})?.queries?.length);
  assert.deepEqual(
    forcedToSearch,
    ["iPhone 17 price in UAE", "is Framework 16 still available?", "what is XG27AQWMG?"],
    "only the named-model cases may bypass the planner, and only towards search",
  );
});

test("an explicit web-search instruction deterministically produces a bounded query", () => {
  const route = routeByRule(
    "What are the latest developments in AI classroom technology? Search the web and summarize what you find.",
    { hasConversationContext: false },
  );
  assert.deepEqual(route, {
    memory: false,
    queries: ["What are the latest developments in AI classroom technology?"],
  });

  const prefixed = routeByRule("Please search the web for current classroom AI tools", {});
  assert.deepEqual(prefixed, { memory: false, queries: ["current classroom AI tools"] });

  const long = routeByRule(`Search the web for ${"x".repeat(400)}`, {});
  assert.equal(long.queries[0].length, 200);
});

/* THE FOUR QUESTIONS ARE THE EVALUATION DATASET'S OWN, VERBATIM, and three of
 * them were answered with no search at all by production on 2026-08-18 — the
 * first live eval run. Keeping the exact wording is the point: a paraphrase
 * would test the rule against a sentence that never failed. */
test("asking for a citation is asking for the web, and the planner was measured missing it", () => {
  const asked = [
    ["What happened in the news today? Cite your sources.", "What happened in the news today?"],
    [
      "What is the latest stable Node.js LTS version right now? Link where you read it.",
      "What is the latest stable Node.js LTS version right now?",
    ],
    [
      "What does OpenRouter currently charge for Claude Sonnet input tokens? Cite the page.",
      "What does OpenRouter currently charge for Claude Sonnet input tokens?",
    ],
    ["What is the weather in London today? Include a source link.", "What is the weather in London today?"],
  ];
  for (const [question, query] of asked) {
    assert.deepEqual(
      routeByRule(question, { hasConversationContext: false }),
      { memory: false, queries: [query] },
      question,
    );
  }
});

test("a citation demand does not drag code, creative work or the identity question to the web", () => {
  const refused = [
    "add a link to the source file in this snippet: const a = 1;",
    "Write a haiku about rain with a link to nowhere",
    'translate "cite" into French',
    "What is ALOP-AI? Cite sources.",
  ];
  for (const text of refused) {
    const route = routeByRule(text, { hasConversationContext: false });
    assert.equal(route?.queries ?? null, null, text);
  }
  /* Memory is decided above every web rule, so "cite it" about this
   * conversation is still a memory question and not a search. */
  assert.deepEqual(
    routeByRule("What did I ask you earlier? Cite it.", { hasConversationContext: true }),
    { memory: true, queries: null },
  );
});

test("first-party ALOP-AI identity questions never go to web search", () => {
  for (const text of [
    "What is ALOP-AI?",
    "What can ALOP AI do?",
    "Tell me about ALOP-AI",
    "What features does ALOP-AI have?",
    "What tools are available in ALOP-AI?",
    "How does ALOP-AI work?",
    "ALOP-AI platform capabilities",
  ]) {
    assert.deepEqual(routeByRule(text, {}), { memory: false, queries: null }, text);
  }
});

test("an explicit request to search for ALOP-AI still honors the user's instruction", () => {
  assert.deepEqual(routeByRule("Search the web for ALOP-AI", {}), {
    memory: false,
    queries: ["ALOP-AI"],
  });
});

test("generic improvement words do not buy the whole council", () => {
  assert.equal(classifyRequest("make this better", ROSTER).complexity, "moderate");
  assert.equal(classifyRequest("what are the implications of a semicolon", ROSTER).complexity, "simple");
});

test("explicit conversation references bypass the model only when context exists", () => {
  for (const text of ["what did I ask you earlier?", "summarise what we discussed"]) {
    assert.deepEqual(routeByRule(text, { hasConversationContext: true }), { memory: true, queries: null }, text);
    assert.equal(routeByRule(text, { hasConversationContext: false }), null, text);
  }
});

test("the labelled difficulty corpus routes 15 of 15 questions to the intended roster tier", () => {
  const labelled = [
    ["Name one colour of the sky", "simple"],
    ["What is photosynthesis?", "simple"],
    ["Who wrote Hamlet?", "simple"],
    ["When was the Moon landing?", "simple"],
    ["Translate hello to Arabic", "simple"],
    ["Why is the sky blue?", "moderate"],
    ["How does HTTP work?", "moderate"],
    ["Tell me about the Ottoman Empire", "moderate"],
    ["Can you help me understand recursion?", "moderate"],
    ["What is the difference between TCP and UDP?", "complex"],
    ["Which database should I use for this workload?", "complex"],
    ["What are the ethical implications of generative AI?", "complex"],
    ["Prove that the square root of two is irrational", "complex"],
    ["Write a report about the causes of the financial crisis", "complex"],
    ["Debug this function:\n```js\nconst x = () => {\n```", "complex"],
  ];
  const misses = labelled.filter(([text, expected]) => classifyRequest(text, ROSTER).complexity !== expected);
  assert.deepEqual(misses, [], `misrouted ${misses.length}/${labelled.length} labelled questions`);
});

// ===== capability questions =====
//
// "Can you access Canva?" was a three-seat question. It opens with a modal, so
// LOOKUP_RE — anchored on what/who/when/where/which — never saw it, and the
// middle tier is the default for anything with no signal either way. Three
// models reconciling their guesses about one product's integrations is not a
// better answer than one; it is three chances to invent an integration.

test("a question about what the assistant can do is a one-seat question", () => {
  for (const text of [
    "Can you access Canva?",
    "can you access canva",
    "Can you use Canva?",
    "can you use canva",
    "Do you have access to Google Drive?",
    "Are you able to browse the web?",
    "Do you support plugins?",
    "Can you connect to my Notion?",
    "Does ALOP-AI integrate with Figma?",
    "Do you use the internet?",
  ]) {
    assert.equal(classifyRequest(text, ROSTER).complexity, "simple", text);
    assert.equal(classifyRequest(text, ROSTER).members.length, 1, text);
  }
});

// The object is what keeps the modal from swallowing ordinary work. Each of
// these opens exactly like a capability question and is a task.
test("a modal opening does not by itself make a request simple", () => {
  for (const text of [
    "Can you fix it?",
    "Could you make a poster for the school fair?",
    "Can you help me understand recursion?",
    "Would you rewrite this paragraph for me?",
    // Sol's two: the grammar of a capability question wrapped around real work.
    "Can you use Bayes' theorem to calculate the probability that this diagnosis is correct?",
    "Can you use Bayes' theorem?",
    "Can you use qzxwvb?",
    "Can you access the database and determine why these records disagree?",
  ]) {
    assert.notEqual(classifyRequest(text, ROSTER).complexity, "simple", text);
  }
});

// ===== the research escalation =====
//
// classifyRequest runs on the text alone because the roster it returns decides
// the spend reservation, so the search decision — which arrives from the router
// hundreds of lines later — cannot be an input to it. This is where that fact
// gets applied.

test("a simple research turn gets three seats, not the whole roster", () => {
  /* Reported 2026-08-17: "is the tineco s7 or the s9 better for mopping" bought
   * seven models. Seven readings of the same two product pages is one answer
   * seven times, at seven times the request cost, and slower — a seven-seat
   * burst against an account-wide 20/minute ceiling starts collecting 429s.
   * THREE and not one, because one seat reading one page with nothing to
   * disagree with it is the failure escalateForResearch exists to fix. */
  const simple = classifyRequest("What is the price of a Canva Pro seat?", ROSTER);
  assert.equal(simple.members.length, 1);

  const widened = escalateForResearch(simple, ROSTER);
  assert.equal(widened.members.length, 3, "a two-product lookup does not need the whole council");
  assert.equal(widened.quorum, 2);
  assert.equal(widened.complexity, "moderate", "a three-seat turn labelled complex is a lie in the audit row");
  // A 400-token draft is the one-seat bargain. A seat that has just read three
  // pages has more to report than that.
  assert.ok(widened.tokenLimit >= 1000, `tokenLimit ${widened.tokenLimit}`);
});

test("a complex research turn still gets everything", () => {
  const complex = { members: [ROSTER[0]], quorum: 1, whipMs: 30000, tokenLimit: 2000, complexity: "complex" };
  const widened = escalateForResearch(complex, ROSTER);
  assert.equal(widened.members.length, ROSTER.length, "real research is where independent readings pay");
  assert.equal(widened.complexity, "complex");
});

test("the research escalation only ever widens", () => {
  const detailed = classifyRequest("Compare Postgres and MySQL in detail", ROSTER, true);
  assert.equal(detailed.members.length, ROSTER.length);
  // Same object back: nothing to widen, and the 2000-token depth ceiling the
  // user asked for is not pulled down to 1000.
  assert.equal(escalateForResearch(detailed, ROSTER), detailed);
  assert.equal(escalateForResearch(detailed, ROSTER).tokenLimit, 2000);
});

test("the research escalation cannot reach past the plan's roster", () => {
  const free = ROSTER.slice(0, 2);
  const widened = escalateForResearch(classifyRequest("What is a monad?", free), free);
  assert.equal(widened.members.length, 2);
  for (const seat of widened.members) assert.ok(free.includes(seat), seat.model);
});

// ===== the native tool seat =====

const TOOL_SEAT = { model: 'openai/gpt-5.6-luna', temperature: 0.2, free: false, nativeTools: true };
const baseSelection = (over = {}) => ({
  members: [{ model: 'free-a', temperature: 0.3 }],
  quorum: 1,
  whipMs: 30000,
  tokenLimit: 400,
  complexity: 'simple',
  category: 'council',
  ...over,
});

test('a simple question stays on the free roster', () => {
  // "Free models handle simple questions only" is the owner's rule, and this is
  // the half of it that keeps a metered model off a lookup.
  const out = withToolSeat(baseSelection(), TOOL_SEAT);
  assert.equal(out.members.length, 1);
  assert.equal(out.toolSeatModel, undefined);
});

test('a turn that needs live information gets the seat even when it looked simple', () => {
  // The case the seat exists for. classifyRequest ran on the text alone, before
  // anything knew the answer was on the web.
  const out = withToolSeat(baseSelection(), TOOL_SEAT, { needsTools: true });
  assert.equal(out.members[0].model, TOOL_SEAT.model, 'the seat leads the roster; narrowing has already run');
  assert.equal(out.members.length, 2, 'it is ADDITIVE — a council of one strong model is not a council');
  assert.equal(out.toolSeatModel, TOOL_SEAT.model);
});

test('a complex question keeps the free draft roster without tools', () => {
  for (const complexity of ['moderate', 'complex']) {
    const out = withToolSeat(baseSelection({ complexity }), TOOL_SEAT);
    assert.equal(out.members.length, 1, complexity);
    assert.equal(out.toolSeatModel, undefined, complexity);
  }
});

test('a greeting still spends nothing', () => {
  const out = withToolSeat(baseSelection({ category: 'greeting', members: [] }), TOOL_SEAT, { needsTools: true });
  assert.equal(out.members.length, 0);
});

test('no seat means no change, and that is how the plan gate is enforced', () => {
  // The caller passes null for a user whose plan does not include it. Reaching
  // into a roster from here would put a METERED model on a free tier.
  const selection = baseSelection({ complexity: 'complex' });
  assert.equal(withToolSeat(selection, null, { needsTools: true }), selection);
  assert.equal(withToolSeat(selection, {}, { needsTools: true }), selection);
});

test('adding the seat twice does not seat it twice', () => {
  // escalateForResearch re-selects members, and the server calls this on both
  // sides of that. A duplicate is a second metered request per round.
  const once = withToolSeat(baseSelection({ complexity: 'complex' }), TOOL_SEAT, { needsTools: true });
  const twice = withToolSeat(once, TOOL_SEAT, { needsTools: true });
  assert.equal(twice.members.filter((m) => m.model === TOOL_SEAT.model).length, 1);
});

test('the seat raises the whip and the quorum with it', () => {
  const out = withToolSeat(baseSelection({ complexity: 'complex' }), TOOL_SEAT, { needsTools: true });
  assert.ok(out.whipMs >= 45000, 'a native round trip at high effort is slower than a 2.4s free draft');
  assert.equal(out.quorum, Math.min(2, out.members.length), 'quorum must not let the free seats close the room first');
  assert.ok(out.tokenLimit >= 1000, 'a 400-token lookup ceiling is not a research draft');
});

test('a detailed turn keeps its larger ceiling', () => {
  const out = withToolSeat(baseSelection({ complexity: 'complex', tokenLimit: 2000, whipMs: 60000 }), TOOL_SEAT, { needsTools: true });
  assert.equal(out.tokenLimit, 2000, 'never DOWN');
  assert.equal(out.whipMs, 60000);
});

/* ---------------------------------------------------------------------------
 * A NAMED PRODUCT MODEL FORCES A SEARCH.
 *
 * From the transcript of 2026-08-17: "i just bought the xg27aqwmg what are some
 * things i should do and watch out for" was answered with no search as a 27"
 * 1440p 180 Hz IPS monitor. It is a 280 Hz WOLED. Every fact was invented and
 * the turn logged as a success. The planner's prompt already says to search
 * product specs, already says "if in doubt, search", and already carries this
 * exact SKU as a worked example — the small model answered NO anyway once the
 * SKU sat inside a chatty sentence. So the rule decides it and no model gets a
 * vote.
 * ------------------------------------------------------------------------ */

test("the reported turn now searches, and the SKU is its own first query", () => {
  const route = routeByRule("i just bought the xg27aqwmg what are some things i should do and watch out for", {});
  assert.equal(route?.memory, false);
  assert.equal(route.queries[0], "xg27aqwmg specs review", "a spec sheet is found by the designation alone");
  assert.match(route.queries[1], /watch out for$/, "the second query keeps the question the user actually asked");
});

test("a mixed letters-and-digits designation is caught wherever it sits", () => {
  for (const text of [
    "xg27aqwmg",
    "i use 15ixr10 legion 5 rtx 5060",
    "how good is the a7iv for video",
    "does the wh1000xm5 support ldac",
  ]) {
    assert.equal(namesSpecificModel(text), true, text);
    assert.ok(routeByRule(text, {})?.queries?.length, `${text} produced no queries`);
  }
});

test("a brand followed by a number counts, and a function word followed by one does not", () => {
  assert.equal(namesSpecificModel("is the iphone 15 waterproof"), true);
  assert.equal(namesSpecificModel("pixel 9 vs galaxy 24"), true);
  // The regex this replaced read "is 1440p" as a product and searched for it.
  assert.equal(namesSpecificModel("my monitor is 1440p should i cap at 240fps"), false);
  assert.equal(namesSpecificModel("i bought 27 inch panels"), false, "'bought 27' is not a product line");
});

test("a number in ordinary quantity grammar is not a product identifier", () => {
  for (const text of [
    "serving 30 requests",
    "takes 200 milliseconds",
    "50 workers",
    "handles 300 users",
    "retry after 20 seconds",
    "a cache hit takes 5 ms but misses 20% of the time",
    "a cache hit takes 5 ms but misses 20 percent of the time",
    "version 2",
  ]) {
    assert.equal(namesSpecificModel(text), false, text);
    assert.equal(routeByRule(text, {})?.queries?.length ?? 0, 0, `${text} forced a search`);
  }
});

test("designation grammar plus product or model context still forces a search", () => {
  for (const text of [
    "GPT-5.6",
    "RTX 5090",
    "XG27AQWMG",
    "iPhone 17 Pro",
    "Node 26",
  ]) {
    assert.equal(namesSpecificModel(text), true, text);
    assert.ok(routeByRule(`What is ${text}?`, {})?.queries?.length, `${text} did not force a search`);
  }
});

test("units, formats and version numbers are a spec the user quoted, not a product", () => {
  for (const text of [
    "my monitor is 1440p 280hz should i cap fps at 240fps",
    "convert this to mp4 and keep h265",
    "why does my sha256 hash differ in python 3.12",
    "is utf8 enough for emoji",
    "3 x 8",
    "9 x 10",
  ]) {
    assert.equal(namesSpecificModel(text), false, text);
  }
});

test("modelDesignations reports what it found, in order and without repeats", () => {
  assert.deepEqual(modelDesignations("xg27aqwmg vs xg27aqwmg and 15ixr10"), ["xg27aqwmg", "15ixr10"]);
  assert.deepEqual(modelDesignations("nothing here but words"), []);
});

test("code, transformations and creative work keep their no-search answer", () => {
  // `sha256` and `x86_64` are not products, which is why the model rule is
  // checked below the stable-shape test rather than above it.
  assert.deepEqual(routeByRule("function hash(x) { return sha256(x) } why is this slow?", {}), { memory: false, queries: null });
  assert.deepEqual(routeByRule("define 4k", {}), { memory: false, queries: null });
  assert.deepEqual(routeByRule("write a haiku about mp4 files", {}), { memory: false, queries: null });
});

test("a pasted URL still defers, because it already means read this page", () => {
  assert.equal(routeByRule("what does https://example.com/xg27aqwmg say", {}), null);
});

test("the arithmetic and greeting turns are untouched by this rule", () => {
  assert.equal(namesSpecificModel("3 multiplied by 6"), false);
  assert.equal(routeByRule("hi", {}), null, "a greeting is settled by classifyRequest, not here");
});

test("a short SKU forces the search when the sentence proves it is a product", () => {
  /* The exact reported turn, misspelled brand included: "is tienco s7 stretch
   * wet and dry or the s9 ... better" was answered from memory with a spec table
   * and prices. The brand typo is why SEARCH is the fix and a brand dictionary
   * is not — a search engine corrects "tienco" for free. */
  const route = routeByRule("is tienco s7 stretch wet and dry or the s9 wet and dry better for vacuuming and mopping", {});
  assert.ok(route?.queries?.length, "the two-SKU comparison still did not search");
  assert.equal(route.queries[0], "tienco s7 s9 specs review", "a bare s9 finds a phone, a headphone and a vacuum — the brand has to travel with it");

  assert.equal(namesSpecificModel("tineco s9 review"), true, "brand plus SKU");
  assert.equal(namesSpecificModel("s7 or s9"), true, "two SKUs is a comparison");
});

test("a lone short token that is not a product does not trigger anything", () => {
  // `x8` in "3 x 8" is the same shape as a SKU, which is why one unbranded
  // occurrence is never enough on its own.
  for (const text of ["3 x 8", "9 x 10", "convert to mp3 or mp4", "is h2o or co2 heavier", "grade a1 work"]) {
    assert.equal(namesSpecificModel(text), false, text);
  }
});

/* THE CACHE LOOKUP SITS ABOVE THE ROUTER, so a routing change that is not in
 * ROUTING_POLICY changes nothing for any question already in the answer cache.
 * MEASURED 2026-08-18: the evaluation dataset was re-run against a build
 * carrying a router fix, and every case came back from the cache in two to
 * three seconds having never reached the router — a 17/22 that measured the
 * cache. This test is what fails when a new gating rule is added and the policy
 * list is not updated with it. */
test("every regex the rule router branches on is carried into the cache identity", () => {
  const branchedOn = [
    ...new Set([...routeByRule.toString().matchAll(/\b([A-Z][A-Z0-9_]*_RE)\b/g)].map((m) => m[1])),
  ].sort();
  assert.ok(branchedOn.length >= 8, `the rule router should branch on several regexes; found ${branchedOn.length}`);

  const carried = Object.keys(ROUTING_RULES);
  assert.deepEqual(
    branchedOn.filter((name) => !carried.includes(name)),
    [],
    "a regex decides routing but is missing from ROUTING_RULES, so editing it will not drop the answer cache",
  );

  /* The decision itself, not only its constants: reordering the branches
   * changes which rule wins and must re-key the cache too. */
  assert.ok(
    ROUTING_POLICY.some((entry) => entry.includes("CITATION_DEMAND_RE.test(t)")),
    "routeByRule's own source is part of the material",
  );
  assert.ok(
    ROUTING_POLICY.every((entry) => typeof entry === "string" && entry.length > 0),
    "every entry has to be fingerprintable text",
  );
});

/* MEASURED 2026-08-18, third evaluation run: "Write a JavaScript function that
 * reverses a string. Code only." was graded `complex` — the full seven-seat
 * roster — because the sentence contains the word "function". Every request to
 * write a function contains that word.
 *
 * The property is a SPLIT, so both halves are asserted: pasted code stays
 * complex, and prose about code stops being. Asserting only the first half
 * would pass with the bug still in place. */
test("pasted code is complex; the word 'function' in a sentence is not", () => {
  const pasted = [
    "function add(a, b) {\n  return a + b;\n}\nwhy is this slow?",
    "```js\nconst x = 1\n``` explain this",
    "const f = (x) => x * 2",
    "const total = items.reduce(sum, 0);",
  ];
  for (const text of pasted) {
    assert.equal(assessComplexity(text), "complex", text.slice(0, 40));
  }

  /* Prose. None of these carries a snippet, and each says a code word the old
   * regex treated as one. Moderate, not simple — the roster is unchanged, and
   * claiming simple here would be a quality decision this fix is not making. */
  for (const text of [
    "Write a JavaScript function that reverses a string. Code only.",
    "Write a Python function to check whether a number is prime",
  ]) {
    assert.equal(assessComplexity(text), "moderate", text.slice(0, 40));
  }

  /* And a code word inside an anchored lookup reaches the simple tier it always
   * should have: "What class should I use for a fixed-size buffer?" is a
   * question, not a snippet. It was complex before this change. */
  assert.equal(assessComplexity("What class should I use for a fixed-size buffer?"), "simple");
});

test("the complexity split does not change whether code questions search", () => {
  /* routeByRule still uses the WIDE CODE_RE, deliberately: for "should this
   * search", the word `function` is fine evidence that the answer is stable.
   * Narrowing that too would send every code question to the search planner. */
  for (const text of [
    "Write a JavaScript function that reverses a string. Code only.",
    "function add(a, b) { return a + b; }",
    "what does this class do",
  ]) {
    assert.deepEqual(
      routeByRule(text, { hasConversationContext: false }),
      { memory: false, queries: null },
      text.slice(0, 40),
    );
  }
});

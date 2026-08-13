const test = require("node:test");
const assert = require("node:assert/strict");
const {
  detectLanguage,
  wantsDetailedAnswer,
  needsWikiCheck,
  classifyRequest,
  routeByRule,
  DETAIL_PHRASES,
  escalateForResearch,
  narrowRoster,
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

  const decided = needsPlanner.filter((text) => routeByRule(text, { hasConversationContext: false }));
  assert.deepEqual(decided, [], "a volatile or named-entity case bypassed the search planner");
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

test("a turn the router sends to live research gets the whole roster", () => {
  const simple = classifyRequest("What is the price of a Canva Pro seat?", ROSTER);
  assert.equal(simple.members.length, 1);

  const widened = escalateForResearch(simple, ROSTER);
  assert.equal(widened.members.length, ROSTER.length);
  assert.equal(widened.quorum, 2);
  assert.equal(widened.complexity, "complex");
  // A 400-token draft is the one-seat bargain. A seat that has just read three
  // pages has more to report than that.
  assert.ok(widened.tokenLimit >= 1000, `tokenLimit ${widened.tokenLimit}`);
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

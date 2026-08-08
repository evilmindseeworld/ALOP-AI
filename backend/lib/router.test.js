const test = require("node:test");
const assert = require("node:assert/strict");
const {
  detectLanguage,
  wantsDetailedAnswer,
  needsWikiCheck,
  classifyRequest,
  DETAIL_PHRASES,
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

test("what word boundaries do NOT fix, recorded so it is not mistaken for solved", () => {
  // "clear my browser history" contains `history` as a whole word, so it still
  // triggers. Separating this sense from the encyclopaedic one needs to know
  // what the history is OF, which is not a job for a regex. The cost is one
  // wasted provider in a fan-out that is already whipped, so it stays.
  assert.equal(needsWikiCheck("clear my browser history"), true);
});

test("the real lookups still fire", () => {
  for (const t of [
    "what is a black hole",
    "who is Ada Lovelace",
    "tell me about the Silk Road",
    "the history of the printing press",
    "meaning of entropy",
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

test("the roster is passed through untouched", () => {
  assert.deepEqual(classifyRequest("q", ROSTER).members, ROSTER);
});

test("a missing roster does not throw", () => {
  const s = classifyRequest("q", undefined);
  assert.deepEqual(s.members, []);
  assert.equal(s.quorum, 0);
});

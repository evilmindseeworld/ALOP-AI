const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeTitle, TITLE_PROMPT, MAX_TITLE_CHARS } = require("./chat-title");

/**
 * A title is model output rendered as a label.
 *
 * Every other piece of model output in this app is prose inside a message
 * bubble. This one goes into the sidebar as a name, is persisted, and is the
 * thing a user scans a list of a week later. So it is sanitised like input, and
 * the interesting cases are all "the model did not follow the prompt".
 */

// ===== the shapes a model actually returns =====

test("a clean title passes through, capitalised", () => {
  assert.equal(sanitizeTitle("renewing a UAE trade licence"), "Renewing a UAE trade licence");
});

test("quotes come off, including smart ones", () => {
  assert.equal(sanitizeTitle('"Trade licence renewal"'), "Trade licence renewal");
  assert.equal(sanitizeTitle("“Trade licence renewal”"), "Trade licence renewal");
  assert.equal(sanitizeTitle("'Trade licence renewal'"), "Trade licence renewal");
  assert.equal(sanitizeTitle("`Trade licence renewal`"), "Trade licence renewal");
});

test("a Title: prefix comes off", () => {
  for (const s of ["Title: Sourdough care", "title - Sourdough care", "Chat title: Sourdough care"]) {
    assert.equal(sanitizeTitle(s), "Sourdough care", s);
  }
});

test("markdown emphasis comes off", () => {
  assert.equal(sanitizeTitle("**Sourdough care**"), "Sourdough care");
  assert.equal(sanitizeTitle("## Sourdough care"), "Sourdough care");
});

test("only the first line is considered", () => {
  // Models that ignore "answer nothing else" return the title then an
  // explanation. The explanation is not part of the name.
  assert.equal(sanitizeTitle("Sourdough care\n\nThis title reflects the topic."), "Sourdough care");
});

test("a trailing full stop is removed but other terminals survive", () => {
  // A period in a sidebar row reads as a typo. A question mark is meaning.
  assert.equal(sanitizeTitle("Sourdough care."), "Sourdough care");
  assert.equal(sanitizeTitle("Why the build fails?"), "Why the build fails?");
  assert.equal(sanitizeTitle("It finally works!"), "It finally works!");
});

test("internal whitespace collapses", () => {
  assert.equal(sanitizeTitle("Sourdough    starter   care"), "Sourdough starter care");
});

// ===== the regression that made this a named function =====

test("spaces and hyphens are NOT stripped", () => {
  // The first draft wrote the control-character class with its bytes typed
  // literally rather than escaped, so it read as "space through hyphen" and
  // deleted every space in every title. It presented as a styling bug.
  assert.equal(sanitizeTitle("Renewing a UAE trade licence"), "Renewing a UAE trade licence");
  assert.equal(sanitizeTitle("Follow-up on the invoice"), "Follow-up on the invoice");
  assert.ok(sanitizeTitle("three word title").includes(" "));
});

test("control characters are stripped without touching the rest", () => {
  const withControls = "Sourdough" + String.fromCharCode(0x07) + " care" + String.fromCharCode(0x7f);
  assert.equal(sanitizeTitle(withControls), "Sourdough care");
});

// ===== refusals =====

test("a model that returned a paragraph is refused, not truncated", () => {
  // Truncating gives back exactly the low-information-scent title the local
  // fallback already produces, at the cost of a model call. Null means the
  // caller keeps what it had.
  const paragraph = "This conversation covers a great many topics and continues at length past anything reasonable";
  assert.ok(paragraph.length > MAX_TITLE_CHARS);
  assert.equal(sanitizeTitle(paragraph), null);
});

test("refusals and preambles are not titles", () => {
  for (const s of [
    "I'm sorry, I can't help with that",
    "I cannot name this conversation",
    "As an AI language model, I would title this",
    "Sure! Here is a title",
    "Here's a good title",
  ]) {
    assert.equal(sanitizeTitle(s), null, s);
  }
});

test("empty, whitespace and non-strings return null", () => {
  for (const s of ["", "   ", "\n", '""', "*", null, undefined, 42, {}, []]) {
    assert.equal(sanitizeTitle(s), null, JSON.stringify(s));
  }
});

test("punctuation alone is not a title", () => {
  // Clears the length check and is not a name. Found by this test, which
  // originally asserted it and failed.
  for (const s of ["!!!", "---", "...", "???", "***"]) {
    assert.equal(sanitizeTitle(s), null, s);
  }
});

test("non-Latin titles survive, because the app answers in five other scripts", () => {
  // The readability check uses Unicode property escapes. An A-Za-z0-9 test
  // would have rejected every one of these.
  for (const s of ["تجديد الرخصة التجارية", "贸易许可证续期", "ソフトウェアの設計", "무역 라이선스", "Продление лицензии"]) {
    assert.equal(sanitizeTitle(s), s, s);
  }
});

// ===== the prompt =====

test("the prompt forbids the things the sanitiser then has to undo", () => {
  // If these ever drift apart, the sanitiser is silently carrying the prompt.
  assert.match(TITLE_PROMPT, /quotation marks/i);
  assert.match(TITLE_PROMPT, /no final period/i);
  assert.match(TITLE_PROMPT, /not a sentence/i);
  assert.match(TITLE_PROMPT, /2 to 5 words/i);
});

test("a title that obeys the prompt survives untouched apart from casing", () => {
  // The guard against over-sanitising: the happy path must not be mangled.
  for (const s of ["Trade licence renewal", "Sourdough starter care", "React hydration mismatch"]) {
    assert.equal(sanitizeTitle(s), s, s);
  }
});

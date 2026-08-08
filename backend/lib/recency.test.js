const test = require("node:test");
const assert = require("node:assert");
const {
  todayLine,
  isTimeSensitive,
  freshnessWindow,
  normalizeDate,
  dateLabel,
} = require("./recency");

const AUG_8_2026 = new Date("2026-08-08T09:00:00Z");

test("the date line names the actual day, spelled out", () => {
  const line = todayLine(AUG_8_2026);
  assert.match(line, /Saturday, 8 August 2026/);
});

test("the date line tells the model its own recall is the suspect source", () => {
  // Knowing the date does not by itself stop a stale assertion. The model has
  // to be told that training is older AND that it cannot measure by how much —
  // otherwise it reasons "my cutoff is recent enough" and answers anyway.
  const line = todayLine(AUG_8_2026);
  assert.match(line, /training data is older/i);
  assert.match(line, /cannot tell how much older/i);
  assert.match(line, /current as of/i);
});

test("an invalid clock falls back to the real one rather than printing garbage", () => {
  // A prompt reading "Today's date is Invalid Date" is worse than no line at
  // all: it is a false statement at system position.
  assert.doesNotMatch(todayLine(new Date("nonsense")), /Invalid/i);
  assert.doesNotMatch(todayLine(null), /Invalid/i);
});

test("questions about the present are recognised", () => {
  for (const q of [
    "what is the latest iPhone",
    "who is the current prime minister of the UK",
    "news about the election",
    "how much does a PS5 cost right now",
    "what happened yesterday in Tokyo",
    "is that library still maintained",
    "best GPU 2026",
  ]) {
    assert.equal(isTimeSensitive(q), true, q);
  }
});

test("timeless questions are left alone", () => {
  // This is the half that matters more. A freshness window on a question with
  // a 1959 answer discards the good sources and makes the answer worse while
  // looking like it tried harder.
  for (const q of [
    "how does TCP slow start work",
    "explain monads",
    "why is the sky blue",
    "write a haiku about rain",
    "what is the capital of France",
  ]) {
    assert.equal(isTimeSensitive(q), false, q);
  }
});

test("the word boundaries are the whole fix", () => {
  // Unbounded, `now` matched "know"/"known"/"nowhere" and `new` matched
  // "news"/"newton"/"renewable" — which is most sentences in English. Every
  // question would have got a freshness window, silently.
  for (const q of [
    "do you know what a monad is",
    "explain newton's second law",
    "how do renewable sources work",
    "there is nowhere to put this",
  ]) {
    assert.equal(isTimeSensitive(q), false, q);
  }
});

test("a breaking-news question gets a narrow window, an ordinary one a year", () => {
  assert.deepEqual(freshnessWindow("what happened today in Gaza"), { days: 2, label: "day" });
  assert.deepEqual(freshnessWindow("breaking news on the merger"), { days: 2, label: "day" });
  assert.deepEqual(freshnessWindow("what is the latest Framework laptop"), { days: 365, label: "year" });
});

test("a timeless question gets no window at all", () => {
  assert.equal(freshnessWindow("explain monads"), null);
});

test("the default window is a year, and the reason is empty result sets", () => {
  // A month is narrow enough to return NOTHING on a quiet topic, and no
  // results is a worse answer than a nine-month-old one.
  assert.equal(freshnessWindow("latest thinking on rust async").days, 365);
});

test("a published date is normalised to a comparable day", () => {
  assert.equal(normalizeDate("2026-07-30T11:22:00Z", AUG_8_2026), "2026-07-30");
  assert.equal(normalizeDate("July 30, 2026", AUG_8_2026), "2026-07-30");
});

test("an unparseable date becomes no date, never a guess", () => {
  // A wrong label is worse than no label, because the label is the thing the
  // model will trust over the content.
  for (const bad of ["", null, undefined, 12345, "recently", "n/a", {}]) {
    assert.equal(normalizeDate(bad, AUG_8_2026), "");
  }
});

test("a future date is rejected", () => {
  // Common in scraped metadata — a copyright year, a scheduled post. A source
  // stamped next year would outrank every genuinely current one.
  assert.equal(normalizeDate("2027-01-01", AUG_8_2026), "");
  // But a source published hours ago in a timezone ahead of UTC is legitimately
  // "tomorrow" by this clock, and must survive.
  assert.equal(normalizeDate("2026-08-09T02:00:00Z", AUG_8_2026), "2026-08-09");
});

test("a pre-web date is rejected", () => {
  // Catches epoch-zero defaults and two-digit-year misparses, both of which
  // would otherwise read as "extremely stale" and bury a good source.
  assert.equal(normalizeDate("1970-01-01", AUG_8_2026), "");
});

test("an undated source says so in words", () => {
  // A blank is ambiguous between "we don't know" and "there was nothing to
  // say", and the model resolves that in whichever direction suits the answer
  // it was already going to give.
  assert.equal(dateLabel(""), "Published: unknown — treat as undated");
  assert.equal(dateLabel("2026-07-30"), "Published: 2026-07-30");
});

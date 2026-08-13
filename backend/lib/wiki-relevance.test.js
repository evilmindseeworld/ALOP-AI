const test = require('node:test');
const assert = require('node:assert');

const { wikiSubject, isRelevantTitle } = require('./wiki-relevance');

/**
 * THE REPORTED FAILURE, first, as data rather than as prose.
 *
 * "write an biography about mohamed fateh the sultan of ottoman empire"
 * answered "I couldn't find this on Wikipedia." and stopped. The four titles
 * below are what the live API really returned for that message on 2026-08-13 —
 * not invented plausible-looking ones — and the assertion is that none of them
 * is allowed to claim the turn.
 */
const REPORTED = 'write an biography about mohamed fateh the sultan of ottoman empire';
const WHAT_WIKIPEDIA_RETURNED = [
  'Rumi',
  'Khatri',
  'Early Caliphate navy',
  'List of people who survived assassination attempts',
];

test('the reported dead end', async (t) => {
  await t.test('none of the returned articles is about the question', () => {
    for (const title of WHAT_WIKIPEDIA_RETURNED) {
      assert.equal(isRelevantTitle(REPORTED, title), false, `"${title}" was accepted`);
    }
  });

  await t.test('the instruction is stripped out of the search query', () => {
    const subject = wikiSubject(REPORTED);
    for (const noise of ['write', 'biography', 'about', 'an']) {
      assert.ok(!subject.split(' ').includes(noise), `"${noise}" survived into the query`);
    }
    // And the subject itself survives.
    for (const kept of ['mohamed', 'fateh', 'sultan', 'ottoman', 'empire']) {
      assert.ok(subject.includes(kept), `"${kept}" was stripped out of the query`);
    }
  });
});

test('an article that IS about the question is accepted', async (t) => {
  const cases = [
    ['who was mehmed ii', 'Mehmed II'],
    ['tell me about the roman empire', 'Roman Empire'],
    ['what is photosynthesis', 'Photosynthesis'],
    ['who invented the light bulb', 'Incandescent light bulb'],
    ['explain the history of the ottoman empire', 'Ottoman Empire'],
  ];
  for (const [question, title] of cases) {
    await t.test(`${question} / ${title}`, () =>
      assert.equal(isRelevantTitle(question, title), true));
  }
});

test('the gate does not agree on words that carry no subject', async (t) => {
  // Every one of these shares "the", "of", "what" or "is" with the question and
  // nothing else. An overlap test that counted those would accept anything.
  const cases = [
    ['what is the capital of France', 'The Bends'],
    ['who is the president', 'Is (album)'],
    ['tell me about quantum entanglement', 'List of the largest cities'],
  ];
  for (const [question, title] of cases) {
    await t.test(`${question} / ${title}`, () =>
      assert.equal(isRelevantTitle(question, title), false));
  }
});

test('a question with no subject of its own can never match', () => {
  // "what is it" is entirely instruction and glue. Nothing is demonstrably
  // about it, so nothing may claim to be — this is the branch that would
  // otherwise accept the first article Wikipedia happened to return.
  assert.equal(isRelevantTitle('what is it', 'Anything At All'), false);
  assert.equal(isRelevantTitle('', 'Anything At All'), false);
});

test('non-Latin scripts are tokenised, not silently emptied', async (t) => {
  // `\w` is ASCII. Using it here would have reduced every Russian, Arabic,
  // Japanese and Chinese question to zero content words, and this gate refuses
  // a question with no content words — so the whole Wikipedia path would have
  // switched itself off for exactly the users the app detects languages for.
  await t.test('Russian', () =>
    assert.equal(isRelevantTitle('что такое Османская империя', 'Османская империя'), true));
  await t.test('Arabic', () =>
    assert.equal(isRelevantTitle('ما هي الإمبراطورية العثمانية', 'الإمبراطورية العثمانية'), true));
  // Japanese and Chinese put no spaces between words, so "光合成とは" is ONE
  // token and can never equal the title "光合成". The substring clause is what
  // makes the gate work at all for those scripts; it is deliberately not
  // applied to Latin, where "art" sits inside "started".
  await t.test('Japanese, which has no word boundaries to split on', () =>
    assert.equal(isRelevantTitle('光合成とは何ですか', '光合成'), true));
  await t.test('and still refuses an unrelated title', () =>
    assert.equal(isRelevantTitle('что такое Османская империя', 'Фотосинтез'), false));
  await t.test('and refuses an unrelated Japanese title', () =>
    assert.equal(isRelevantTitle('光合成とは何ですか', '相撲'), false));
});

/**
 * A KNOWN LIMIT, WRITTEN DOWN RATHER THAN DISCOVERED.
 *
 * "Османскую империю" is the accusative of "Османская империя", and every word
 * differs in its final letters. There is no stemmer here, so the gate refuses,
 * and the question goes to the council instead — one extra turn, and a correct
 * answer. That is the right trade at this size, and the wrong one to fix with a
 * fuzzy-match threshold, which would buy inflections at the price of agreeing
 * on words that merely look alike.
 *
 * This asserts the CURRENT behaviour. If a stemmer is ever added, this test
 * flips to `true` and the comment above it should go.
 */
test('an inflected form is a known limit', () => {
  assert.equal(isRelevantTitle('расскажи про Османскую империю', 'Османская империя'), false);
});

test('diacritics do not stop a match', () => {
  // "Zurich" and "Zürich" are the same word to a person and different strings
  // to a Set. NFKD plus a combining-mark strip is what makes them agree.
  assert.equal(isRelevantTitle('what is the population of Zurich', 'Zürich'), true);
});

test('wikiSubject never returns an empty query', () => {
  // A search for "" returns nothing, which would move the dead end one step
  // earlier rather than removing it. When stripping leaves nothing, the
  // original text comes back.
  assert.equal(wikiSubject('  who   '), 'who');
  assert.equal(wikiSubject('what is'), 'what is');
  assert.ok(wikiSubject('what is it').length > 0);
  assert.equal(wikiSubject(''), '');
});

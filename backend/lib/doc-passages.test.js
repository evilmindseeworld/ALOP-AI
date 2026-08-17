'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  splitPassages, scorePassages, findPassages, renderPassages, nearestHeading, PASSAGE_CHARS,
} = require('./doc-passages');

/** A long document whose answer is deliberately far past the old 20k cut. */
const buildDocument = () => {
  const filler = (n) => Array.from({ length: n }, (_, i) => `Paragraph ${i} about invoices, shipping and general administration.`).join('\n\n');
  return [
    '# Introduction',
    // Past 20,000 characters, so the clause below is where read_file could not reach.
    filler(400),
    '## Refund policy',
    'Refunds are issued within 14 days of the return arriving at the warehouse, using the original payment method. The restocking fee is 12 percent for opened electronics.',
    filler(120),
    '## Appendix',
    filler(40),
  ].join('\n\n');
};

test('a passage cut lands on a boundary and the offsets address the original text', () => {
  const text = buildDocument();
  const passages = splitPassages(text);
  assert.ok(passages.length > 5, `only ${passages.length} passages`);
  for (const p of passages) {
    assert.equal(text.slice(p.start, p.end), p.text, `passage ${p.index} does not address its own offsets`);
    assert.ok(p.end > p.start);
  }
  assert.equal(passages[0].start, 0);
  assert.equal(passages.at(-1).end, text.length, 'the tail of the document is unreachable');
});

test('passages overlap, so a sentence on a boundary is scoreable', () => {
  const passages = splitPassages(buildDocument());
  for (let i = 1; i < passages.length; i++) {
    assert.ok(
      passages[i].start < passages[i - 1].end,
      `passage ${i} starts after the previous one ended — no overlap`,
    );
  }
});

test('splitting terminates on text with no paragraph breaks at all', () => {
  // The boundary search could otherwise fail to advance and loop forever.
  const wall = 'x'.repeat(PASSAGE_CHARS * 3);
  const passages = splitPassages(wall);
  assert.ok(passages.length >= 3);
  assert.equal(passages.at(-1).end, wall.length);
});

test('THE ANSWER IS FOUND WHERE THE OLD TRUNCATION COULD NOT REACH IT', () => {
  // This is the whole feature: the refund clause sits well past 20,000
  // characters, which is exactly what read_file used to return and stop.
  const text = buildDocument();
  const where = text.indexOf('Refunds are issued');
  assert.ok(where > 20_000, `fixture is too short to prove anything (clause at ${where})`);

  const found = findPassages(text, 'what is the restocking fee on a refund?');
  assert.equal(found.matched, true);
  const joined = found.passages.map((p) => p.text).join('\n');
  assert.match(joined, /restocking fee is 12 percent/);
});

test('a passage carrying most of the question beats one carrying a single rare word', () => {
  const passages = splitPassages([
    'Alpha section. The word quixotic appears here and nothing else does.',
    'Beta section. The restocking fee and the refund window and the warehouse return are all described here together.',
  ].join('\n\n'), { size: 200, overlap: 20 });
  const ranked = scorePassages(passages, 'restocking fee refund window warehouse');
  assert.match(ranked[0].passage.text, /Beta section/);
});

test('a term in every passage separates nothing', () => {
  const passages = splitPassages(
    Array.from({ length: 6 }, (_, i) => `Invoice paragraph ${i}. ${i === 4 ? 'The kilowatt threshold is 40.' : 'Nothing notable.'}`).join('\n\n'),
    { size: 200, overlap: 20 },
  );
  const ranked = scorePassages(passages, 'invoice kilowatt threshold');
  assert.match(ranked[0].passage.text, /kilowatt threshold is 40/, 'the common word "invoice" decided the ranking');
});

test('passages come back in document order however they ranked', () => {
  const text = buildDocument();
  const found = findPassages(text, 'refund restocking warehouse introduction appendix', { limit: 3 });
  const indexes = found.passages.map((p) => p.index);
  assert.deepEqual(indexes, [...indexes].sort((a, b) => a - b));
});

test('no query returns the beginning, exactly as read_file always did', () => {
  const text = buildDocument();
  const found = findPassages(text, '');
  assert.equal(found.matched, false);
  assert.equal(found.passages[0].start, 0);
});

test('a query matching nothing falls back to the beginning rather than to silence', () => {
  const found = findPassages(buildDocument(), 'zzzz nonexistentterm qqqq');
  assert.equal(found.matched, false);
  assert.ok(found.passages.length > 0);
  assert.equal(found.passages[0].start, 0);
});

test('the character budget is respected, because this goes into a prompt', () => {
  const found = findPassages(buildDocument(), 'invoices shipping administration', { limit: 10, budget: 3000 });
  assert.ok(found.covered <= 3000 + PASSAGE_CHARS, `budget blown: ${found.covered}`);
  /* At least one passage always comes back — a budget smaller than a single
   * passage must not return nothing at all. */
  const tiny = findPassages(buildDocument(), 'invoices', { limit: 5, budget: 10 });
  assert.equal(tiny.passages.length, 1);
});

test('the nearest heading is found, for a citation a human can follow', () => {
  const text = buildDocument();
  const where = text.indexOf('Refunds are issued');
  assert.equal(nearestHeading(text, where), 'Refund policy');
  assert.equal(nearestHeading('no headings here at all', 5), null);
});

test('the rendering states the offsets and marks the gaps', () => {
  const text = buildDocument();
  const found = findPassages(text, 'restocking fee');
  const out = renderPassages({ ...found, name: 'terms.pdf' });
  assert.match(out, /characters \d+–\d+ of \d+/);
  assert.match(out, /Other parts of the document were not shown/);
  if (found.passages.length > 1) {
    assert.match(out, /\[…\]/, 'passages joined with no gap marker read as one continuous text');
  }
});

test('degenerate input does not throw', () => {
  for (const bad of [null, undefined, '', 42, {}]) {
    assert.deepEqual(splitPassages(bad), []);
    const found = findPassages(bad, 'anything');
    assert.deepEqual(found.passages, []);
    assert.equal(renderPassages({ ...found, name: 'x' }), '');
  }
  assert.deepEqual(scorePassages([], 'q'), []);
  assert.deepEqual(scorePassages(splitPassages('hello world'), null), []);
});

/* ---- searchDocuments: one query across every attached file ---- */

const { searchDocuments, renderDocuments } = require('./doc-passages');

/** Three documents where only the third answers, and its NAME does not say so. */
const CORPUS = () => {
  const filler = (n, word) => Array.from({ length: n }, (_, i) => `Paragraph ${i} about ${word} and general administration.`).join('\n\n');
  return [
    { id: 'a', name: 'notes.txt', content: `# Notes\n\n${filler(60, 'meetings')}` },
    { id: 'b', name: 'invoices.csv', content: `# Invoices\n\n${filler(60, 'invoices')}` },
    { id: 'c', name: 'misc-2019.pdf', content: `# Misc\n\n${filler(30, 'shipping')}\n\n## Refund policy\n\nThe restocking fee is 12 percent for opened electronics.\n\n${filler(30, 'shipping')}` },
  ];
};

test('the answer is found in the file whose name does not mention it', () => {
  const found = searchDocuments(CORPUS(), 'restocking fee for opened electronics');
  assert.equal(found.matched, true);
  assert.equal(found.scanned, 3);
  assert.match(found.hits[0].passage.text, /restocking fee is 12 percent/);
  assert.equal(found.hits[0].passage.file.name, 'misc-2019.pdf');
});

test('offsets stay relative to their OWN file, not the concatenation', () => {
  const found = searchDocuments(CORPUS(), 'restocking fee for opened electronics');
  const hit = found.hits[0].passage;
  const source = CORPUS().find((f) => f.id === hit.file.id).content;
  assert.equal(hit.total, source.length);
  assert.equal(source.slice(hit.start, hit.end), hit.text, 'the cited offsets do not quote the cited text');
});

test('nothing matching is empty, never the beginning of an arbitrary document', () => {
  const found = searchDocuments(CORPUS(), 'photosynthesis chlorophyll');
  assert.equal(found.matched, false);
  assert.deepEqual(found.hits, []);
  assert.equal(renderDocuments({ ...found, query: 'photosynthesis chlorophyll' }), '');
});

test('files past the scan cap are named rather than silently dropped', () => {
  const found = searchDocuments(CORPUS(), 'restocking fee', { scanChars: 500 });
  assert.ok(found.skipped.length, 'a file that was never opened must be reported');
  const out = renderDocuments({ hits: [{ passage: { file: { name: 'x' }, start: 0, end: 1, total: 2, text: 't', heading: null }, score: 1 }], skipped: found.skipped, query: 'q' });
  assert.match(out, /Not searched \(too large to open together\)/);
});

test('the rendering labels every passage with its file', () => {
  const found = searchDocuments(CORPUS(), 'restocking fee for opened electronics');
  const out = renderDocuments({ ...found, query: 'restocking fee' });
  assert.match(out, /\[misc-2019\.pdf — .*characters \d+–\d+ of \d+\]/);
});

test('degenerate corpora do not throw', () => {
  for (const bad of [null, undefined, [], [{}], [{ id: 'a', name: 'a', content: '' }]]) {
    const found = searchDocuments(bad, 'anything');
    assert.deepEqual(found.hits, []);
    assert.equal(found.matched, false);
  }
});

test('passages come back in attachment order even when the later file ranks higher', () => {
  /* Both files are one passage long, so a per-file index makes them both
   * index 0 and the output keeps RANK order instead of reading order — a
   * model handed the second document first is reading a different corpus.
   * The corpus-wide reindex is what stops that. */
  const files = [
    { id: 'a', name: 'first.txt', content: 'The quarterly restocking policy is reviewed by the committee.' },
    { id: 'b', name: 'second.txt', content: 'The quarterly restocking fee for opened electronics is 12 percent, reviewed by the committee.' },
  ];
  const found = searchDocuments(files, 'restocking fee for opened electronics quarterly committee');
  assert.equal(found.hits.length, 2);
  assert.ok(found.hits[1].score > found.hits[0].score, 'fixture is wrong: the second file must rank higher');
  assert.deepEqual(found.hits.map((h) => h.passage.file.name), ['first.txt', 'second.txt']);
});

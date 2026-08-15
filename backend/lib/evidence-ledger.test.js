'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEvidenceLedger, checkableClaims, freshnessOf } = require('./evidence-ledger');
const { EVIDENCE_RECORD, validate } = require('./schemas');

const DAY = 24 * 3600 * 1000;
const NOW = 1_760_000_000_000;

/* ---- what counts as a claim ---------------------------------------------- */

test('a sentence with a figure, a date or a name is checkable', () => {
  assert.deepEqual(
    checkableClaims('The service costs 40 dollars a month. It is quite good.'),
    ['The service costs 40 dollars a month.'],
  );
  assert.equal(checkableClaims('The company was founded in 1997 by two students.').length, 1);
  assert.equal(checkableClaims('The library is maintained by the Apache Foundation today.').length, 1);
});

/* Scoring every sentence produces an "unsupported" list nobody reads. */
test('prose that asserts nothing about the world is not a claim', () => {
  assert.deepEqual(checkableClaims('Let me walk you through the trade-offs involved here.'), []);
  assert.deepEqual(checkableClaims('That depends on what you are optimising for, really.'), []);
});

test('a question is never a claim, even carrying a number', () => {
  assert.deepEqual(checkableClaims('Did you mean the 2019 edition or a later one?'), []);
});

test('very short fragments are not claims', () => {
  assert.deepEqual(checkableClaims('Yes, 40.'), []);
});

/* The first word of every sentence is capitalised; treating that as a name
 * would make every sentence checkable and the filter pointless. */
test('a sentence-initial capital is not a proper noun', () => {
  assert.deepEqual(checkableClaims('Something about this seems reasonable enough to me.'), []);
});

/* ---- freshness: the source's date, never the fetch date ------------------ */

test('freshness is judged against the question\'s own window', () => {
  assert.equal(freshnessOf(NOW - 2 * DAY, 30 * DAY, NOW), 'fresh');
  assert.equal(freshnessOf(NOW - 90 * DAY, 30 * DAY, NOW), 'dated');
  assert.equal(freshnessOf(NOW - 5 * 365 * DAY, 30 * DAY, NOW), 'stale');
});

test('a window of one day makes a week-old page dated rather than fresh', () => {
  assert.equal(freshnessOf(NOW - 7 * DAY, DAY, NOW), 'dated');
  assert.equal(freshnessOf(NOW - 7 * DAY, 30 * DAY, NOW), 'fresh');
});

/* Most of the web publishes no machine-readable date. Calling that stale would
 * discard almost everything; calling it fresh would launder it. */
test('a source with no usable date is unknown, not stale and not fresh', () => {
  for (const value of [null, undefined, '', 'sometime last year']) {
    assert.equal(freshnessOf(value, 30 * DAY, NOW), 'unknown', String(value));
  }
});

test('a future date is unknown rather than extremely fresh', () => {
  assert.equal(freshnessOf(NOW + 10 * DAY, 30 * DAY, NOW), 'unknown');
});

/* ---- recording ----------------------------------------------------------- */

test('a recorded source validates against the shipped schema', () => {
  const ledger = createEvidenceLedger({ now: () => NOW });
  const row = ledger.record({
    text: 'The current release is 4.2, published in March.',
    url: 'https://example.com/releases',
    title: 'Releases',
    date: NOW - DAY,
    via: 'brave',
    confidence: 0.8,
  });
  const { id, ...record } = row;
  assert.match(id, /^ev_[0-9a-f]{16}$/);
  assert.equal(validate(EVIDENCE_RECORD, record).ok, true, JSON.stringify(validate(EVIDENCE_RECORD, record)));
  assert.equal(record.freshness, 'fresh');
  assert.equal(record.via, 'brave');
});

test('the same page read twice in one turn is one piece of evidence', () => {
  const ledger = createEvidenceLedger();
  const a = ledger.record({ text: 'Same text.', url: 'https://example.com/a' });
  const b = ledger.record({ text: 'Same text.', url: 'https://example.com/a' });
  assert.equal(a.id, b.id);
  assert.equal(ledger.size, 1);
});

/* Two independent sources saying the same thing is the whole reason a
 * contradiction can be resolved by weight. They must not collapse. */
test('the same sentence from two sources is two pieces of evidence', () => {
  const ledger = createEvidenceLedger();
  ledger.record({ text: 'Same text.', url: 'https://a.example/x' });
  ledger.record({ text: 'Same text.', url: 'https://b.example/y' });
  assert.equal(ledger.size, 2);
});

test('an empty source is not recorded', () => {
  const ledger = createEvidenceLedger();
  assert.equal(ledger.record({ text: '   ', url: 'https://example.com' }), null);
  assert.equal(ledger.record(), null);
  assert.equal(ledger.size, 0);
});

test('a source with no URL is still evidence — not everything read is a web page', () => {
  const ledger = createEvidenceLedger();
  const row = ledger.record({ text: 'From the attached PDF, the total was 12 units.', via: 'file' });
  assert.notEqual(row, null);
  assert.equal(row.sourceUrl, null);
  assert.equal(row.sourceId, row.id, 'with no title and no URL the id is its own source label');
  const { id, ...record } = row;
  assert.equal(validate(EVIDENCE_RECORD, record).ok, true);
});

test('the record cap is a ceiling rather than a crash', () => {
  const ledger = createEvidenceLedger({ maxRecords: 2 });
  ledger.record({ text: 'one', url: 'https://a' });
  ledger.record({ text: 'two', url: 'https://b' });
  assert.equal(ledger.record({ text: 'three', url: 'https://c' }), null);
  assert.equal(ledger.size, 2);
});

/* ---- the audit ----------------------------------------------------------- */

test('a claim the sources support is matched to them', () => {
  const ledger = createEvidenceLedger({ now: () => NOW });
  ledger.record({
    text: 'Pricing for the Pro plan is 40 dollars per month, billed annually.',
    url: 'https://example.com/pricing',
  });

  const audit = ledger.audit('The Pro plan costs 40 dollars per month.');
  assert.equal(audit.claims.length, 1);
  assert.equal(audit.supported, 1);
  assert.equal(audit.coverage, 1);
  assert.equal(audit.claims[0].bestSource, 'https://example.com/pricing');
  assert.equal(audit.claims[0].evidenceIds.length, 1);
});

/* THE FAILURE THIS EXISTS FOR. The prose matches a source almost perfectly and
 * the figure is invented; a word-overlap score alone calls it supported. */
test('a claim that changes the FIGURE is unsupported however well its words match', () => {
  const ledger = createEvidenceLedger();
  ledger.record({
    text: 'Pricing for the Pro plan is 40 dollars per month, billed annually.',
    url: 'https://example.com/pricing',
  });

  const audit = ledger.audit('The Pro plan costs 400 dollars per month.');
  assert.equal(audit.supported, 0);
  assert.equal(audit.unsupported.length, 1);
  assert.equal(audit.unsupported[0].bestSource, null);
});

test('a claim about something no source mentions is unsupported', () => {
  const ledger = createEvidenceLedger();
  ledger.record({ text: 'The Pro plan is 40 dollars per month.', url: 'https://example.com/pricing' });

  const audit = ledger.audit('The Helsinki office opened in 2021 with 30 staff.');
  assert.equal(audit.supported, 0);
  assert.equal(audit.coverage, 0);
});

test('coverage is a ratio across the answer, not a verdict on it', () => {
  const ledger = createEvidenceLedger();
  ledger.record({ text: 'The Pro plan is 40 dollars per month.', url: 'https://example.com/pricing' });

  const audit = ledger.audit('The Pro plan costs 40 dollars per month. The Berlin office opened in 2019.');
  assert.equal(audit.claims.length, 2);
  assert.equal(audit.supported, 1);
  assert.equal(audit.coverage, 0.5);
});

/* An answer with no checkable claim is prose, not an unsupported answer.
 * Reporting 0 there makes the number useless on the turns it protects. */
test('an answer with nothing checkable in it is fully covered, not fully unsupported', () => {
  const ledger = createEvidenceLedger();
  const audit = ledger.audit('It depends on what you are optimising for.');
  assert.equal(audit.claims.length, 0);
  assert.equal(audit.coverage, 1);
});

test('with no evidence at all, every checkable claim is unsupported', () => {
  const ledger = createEvidenceLedger();
  const audit = ledger.audit('The release is 4.2 and it shipped in March 2026.');
  assert.equal(audit.coverage, 0);
  assert.equal(audit.unsupported.length, 1);
});

test('a claim with no figures is judged on words alone', () => {
  const ledger = createEvidenceLedger();
  ledger.record({ text: 'The Apache Foundation maintains the project and reviews its releases.', url: 'https://x' });
  const audit = ledger.audit('The project is maintained by the Apache Foundation.');
  assert.equal(audit.supported, 1);
});

test('the strictness of support is one tunable constant', () => {
  const loose = createEvidenceLedger({ supportAt: 0.1 });
  const strict = createEvidenceLedger({ supportAt: 0.95 });
  const source = { text: 'Apache maintains several unrelated Java projects on its own release cadence.', url: 'https://x' };
  loose.record(source);
  strict.record(source);
  const claim = 'The Apache Foundation maintains the project.';
  assert.equal(loose.audit(claim).supported, 1);
  assert.equal(strict.audit(claim).supported, 0);
});

test('the ledger reports its ids for the answer metadata', () => {
  const ledger = createEvidenceLedger();
  const row = ledger.record({ text: 'A thing that was read.', url: 'https://x' });
  assert.deepEqual(ledger.ids(), [row.id]);
  assert.deepEqual(ledger.all().map((r) => r.id), [row.id]);
});

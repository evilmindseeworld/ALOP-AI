'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  runProgressiveCouncil, agreementScore, consensus, isRisky,
} = require('./progressive-council');

const roster = (n) => Array.from({ length: n }, (_, i) => ({ model: `m${i + 1}` }));

/** An `ask` that records what it was asked and answers from a script. */
const scripted = (answers) => {
  const calls = [];
  const ask = async (models, wave) => {
    calls.push({ models: [...models], wave });
    return models.map((model) => ({ model, content: answers[model] ?? 'a reasonable and sufficiently long default answer' }));
  };
  return { ask, calls, seats: () => calls.flatMap((c) => c.models) };
};

/* ---- agreementScore ------------------------------------------------------ */

test('identical answers agree completely', () => {
  assert.equal(agreementScore('the capital is Paris', 'the capital is Paris'), 1);
});

/* The bug a bag-of-words score cannot see: one word flips the claim. */
test('a negation flips the meaning and must lower the score', () => {
  const same = agreementScore('mixing them is safe', 'mixing them is safe');
  const negated = agreementScore('mixing them is safe', 'mixing them is not safe');
  assert.ok(negated < same, `negation must score lower (${negated} vs ${same})`);
});

test('two different numeric claims do not count as agreement', () => {
  const agree = agreementScore('the dose is 500mg daily', 'the dose is 500mg daily');
  const differ = agreementScore('the dose is 500mg daily', 'the dose is 250mg daily');
  assert.ok(differ < agree);
  assert.ok(differ < 0.75, `a different figure must fall under the early-exit bar (${differ})`);
});

test('an answer that commits to a figure and one that does not are not the same answer', () => {
  const score = agreementScore('it costs about 20 dollars per month', 'it costs a modest amount per month');
  assert.ok(score < 0.75, `score was ${score}`);
});

/* The score has a FLOOR of 0.3 for any two texts with the same negation count,
 * because a shared absence of negation is genuine information about whether the
 * two answers point the same way. What matters is that unrelated answers land
 * under `disagreeAt` (0.45), which is where the ladder escalates. */
test('unrelated answers land under the disagreement threshold', () => {
  const score = agreementScore('photosynthesis converts light into sugar', 'the treaty was signed in Vienna');
  assert.ok(score < 0.45, `score was ${score}`);
  assert.ok(score >= 0.3, 'the negation-balance floor is deliberate');
});

test('a paraphrase still reads as agreement', () => {
  const score = agreementScore(
    'Water boils at 100 degrees Celsius at standard atmospheric pressure.',
    'At standard atmospheric pressure water boils at 100 degrees Celsius.',
  );
  assert.ok(score >= 0.75, `paraphrase scored ${score}`);
});

/* ---- consensus: the weakest pair, not the average ------------------------ */

test('consensus is the WORST pair, so one dissenter is not averaged away', () => {
  const drafts = [
    { model: 'a', content: 'the answer is 42 and here is why it is 42' },
    { model: 'b', content: 'the answer is 42 and here is why it is 42' },
    { model: 'c', content: 'a completely unrelated claim about maritime insurance law' },
  ];
  const { score, pairs } = consensus(drafts);
  assert.equal(pairs, 3);
  assert.ok(score < 0.3, `worst pair should dominate, got ${score}`);
});

test('a single draft has nothing to agree with', () => {
  assert.deepEqual(consensus([{ model: 'a', content: 'alone' }]), { score: null, pairs: 0 });
});

test('blank drafts do not count as a pair', () => {
  assert.equal(consensus([{ model: 'a', content: 'real' }, { model: 'b', content: '   ' }]).pairs, 0);
});

/* ---- risk ---------------------------------------------------------------- */

test('risk is recognised on medical, legal, financial and physical questions', () => {
  for (const q of [
    'what dose of ibuprofen for a child',
    'is this a symptom of something serious',
    'can I deduct this on my tax return',
    'what gauge wiring for this circuit',
    'is it safe to mix these two',
  ]) assert.equal(isRisky(q), true, q);
});

test('an ordinary question is not risky', () => {
  for (const q of ['what is the capital of France', 'write me a haiku about rain']) {
    assert.equal(isRisky(q), false, q);
  }
});

/* ---- the ladder ---------------------------------------------------------- */

test('a simple confident answer stops at one seat', async () => {
  const s = scripted({ m1: 'The capital of France is Paris, and it has been since 987.' });
  const out = await runProgressiveCouncil({ question: 'what is the capital of France', roster: roster(7), ask: s.ask });

  assert.equal(out.seatsUsed, 1);
  assert.equal(out.waves, 1);
  assert.equal(out.stopReason, 'single_seat');
  assert.equal(out.verified, false);
});

test('a hedged first answer buys a confirming wave, and it is small', async () => {
  const s = scripted({
    m1: 'I think it might be around 12, but I am not sure.',
    m2: 'It is 12 according to the published specification.',
    m3: 'It is 12 according to the published specification.',
  });
  const out = await runProgressiveCouncil({ question: 'how many are there', roster: roster(7), ask: s.ask });

  assert.equal(out.waves, 2);
  assert.equal(out.seatsUsed, 3, 'one seat plus a two-seat confirmation, not the whole roster');
  assert.deepEqual(s.calls[1].models, ['m2', 'm3']);
});

test('a thin first answer buys the same confirming wave', async () => {
  const s = scripted({ m1: 'Yes.' });
  const out = await runProgressiveCouncil({ question: 'is it open today', roster: roster(7), ask: s.ask });
  assert.equal(out.waves, 2);
});

test('a risky question never runs on one seat', async () => {
  const s = scripted({});
  const out = await runProgressiveCouncil({
    question: 'what dose of paracetamol is safe for a toddler',
    roster: roster(7),
    ask: s.ask,
  });
  assert.equal(out.risky, true);
  assert.ok(out.seatsUsed >= 2, `risky turns start wider, used ${out.seatsUsed}`);
  assert.equal(s.calls[0].models.length, 2);
});

test('specialists are added only when the confirming wave disagreed, and only in-domain ones', async () => {
  const s = scripted({
    m1: 'Short.',
    m2: 'The mitochondrion is the site of oxidative phosphorylation in eukaryotic cells.',
    m3: 'Maritime insurance law has nothing to do with any of this at all.',
    bio: 'It is the site of oxidative phosphorylation.',
  });
  const out = await runProgressiveCouncil({
    question: 'explain the mitochondrion and cell biology',
    roster: roster(3),
    specialists: [
      { model: 'bio', domains: /cell|biolog|mitochondri/i },
      { model: 'law', domains: /statute|contract|tort/i },
    ],
    ask: s.ask,
    policy: { maxSeats: 6 },
  });

  assert.equal(out.stopReason, 'specialists');
  assert.ok(s.seats().includes('bio'), 'the in-domain specialist is asked');
  assert.ok(!s.seats().includes('law'), 'an out-of-domain specialist is not an expert opinion');
});

test('agreement stops the ladder before specialists are reached', async () => {
  const agreed = 'The boiling point of water at sea level is 100 degrees Celsius.';
  const s = scripted({ m1: 'Short.', m2: agreed, m3: agreed });
  const out = await runProgressiveCouncil({
    question: 'what temperature does water boil at',
    roster: roster(7),
    specialists: [{ model: 'chem' }],
    ask: s.ask,
  });

  assert.equal(out.stopReason, 'early_exit_agreement');
  assert.ok(!s.seats().includes('chem'));
  assert.ok(out.consensus >= 0.75);
});

/* ---- the verifier -------------------------------------------------------- */

test('a verifier is NOT asked to adjudicate an agreement', async () => {
  const agreed = 'The library opens at nine in the morning on weekdays.';
  const s = scripted({ m1: 'Short.', m2: agreed, m3: agreed });
  let verifierCalls = 0;
  const out = await runProgressiveCouncil({
    question: 'when does the library open',
    roster: roster(7),
    ask: s.ask,
    verify: async () => { verifierCalls += 1; return { content: 'a verdict' }; },
  });

  assert.equal(verifierCalls, 0);
  assert.equal(out.verified, false);
});

test('a verifier IS asked when the council disagrees', async () => {
  const s = scripted({
    m1: 'Short.',
    m2: 'The figure is 4200 units per year.',
    m3: 'Entirely unrelated commentary regarding harbour dredging schedules.',
  });
  const out = await runProgressiveCouncil({
    question: 'how many units per year',
    roster: roster(3),
    ask: s.ask,
    verify: async (drafts) => ({ model: 'judge', content: `judged ${drafts.length} drafts` }),
  });

  assert.equal(out.verified, true);
  assert.equal(out.stopReason, 'verified');
  assert.equal(out.drafts.at(-1).verifier, true);
});

test('a risky question is verified even when the seats agree', async () => {
  const agreed = 'Do not mix them; the combination produces chlorine gas and is dangerous.';
  const s = scripted({ m1: agreed, m2: agreed });
  const out = await runProgressiveCouncil({
    question: 'is it safe to mix bleach and ammonia',
    roster: roster(4),
    ask: s.ask,
    verify: async () => ({ content: 'confirmed dangerous' }),
  });
  assert.equal(out.verified, true);
});

test('a verifier that returns nothing usable does not become a draft', async () => {
  const s = scripted({ m1: 'Short.', m2: 'One claim.', m3: 'A different claim about aviation fuel.' });
  const out = await runProgressiveCouncil({
    question: 'how many units per year',
    roster: roster(3),
    ask: s.ask,
    verify: async () => ({ content: '   ' }),
  });
  assert.equal(out.verified, false);
  assert.ok(out.drafts.every((d) => !d.verifier));
});

/* ---- bounds -------------------------------------------------------------- */

test('no seat is ever asked twice', async () => {
  const s = scripted({ m1: 'Short.', m2: 'One.', m3: 'Another entirely different thing.' });
  await runProgressiveCouncil({
    question: 'anything at all',
    roster: roster(4),
    specialists: [{ model: 'm2' }],
    ask: s.ask,
  });
  const seats = s.seats();
  assert.equal(new Set(seats).size, seats.length, `repeated seat in ${seats.join(',')}`);
});

test('maxSeats is a ceiling the ladder cannot climb past', async () => {
  const s = scripted({ m1: 'Short.' });
  const out = await runProgressiveCouncil({
    question: 'anything',
    roster: roster(7),
    ask: s.ask,
    policy: { maxSeats: 2 },
  });
  assert.ok(out.seatsUsed <= 2, `used ${out.seatsUsed}`);
});

test('empty answers are not drafts, and a council that answered nothing says so', async () => {
  const out = await runProgressiveCouncil({
    question: 'anything',
    roster: roster(3),
    ask: async (models) => models.map((model) => ({ model, content: '' })),
  });
  assert.equal(out.drafts.length, 0);
  assert.equal(out.consensus, null);
});

test('it refuses to run without an ask function', async () => {
  await assert.rejects(() => runProgressiveCouncil({ question: 'x', roster: roster(1) }), TypeError);
});

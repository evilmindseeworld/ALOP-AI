'use strict';

/**
 * A council that grows only as far as the question makes it.
 *
 * WHAT IT REPLACES. `classifyRequest` picks a seat count from the question's
 * text and then every one of those seats is asked, in parallel, always. That is
 * the right shape when the seats disagree and pure waste when they do not — and
 * whether they will disagree is knowable after the FIRST answer far more often
 * than the roster size admits. A simple factual question answered identically
 * by seat one and seat two spent five more seats proving it.
 *
 * THE LADDER, and each rung has to earn the next:
 *
 *   1. One seat. If the question is simple and low-risk, its answer IS the
 *      answer — which is a path the route already has (`council_solo`) and
 *      which this makes reachable for more turns rather than inventing.
 *   2. A confirming wave, when the first answer is thin, hedged, or the
 *      question carries risk. Small — two seats, not six.
 *   3. Specialists, only when the question is in a domain the roster names one
 *      for, and only when the confirming wave disagreed.
 *   4. A verifier, only on disagreement or risk. A judge asked to adjudicate an
 *      agreement is a model asked to find a problem, and it will find one.
 *
 * EARLY EXIT IS THE POINT. Agreement is measured, not assumed: `agreementScore`
 * compares the content words and — more importantly — the NUMBERS and the
 * negations, because two answers that share every word except "not" are the two
 * answers a word-overlap score is worst at telling apart.
 *
 * PURE ORCHESTRATION. It calls an `ask` function it is handed and knows nothing
 * about models, prompts, HTTP or telemetry, which is what makes the escalation
 * rules testable without a provider.
 */

/* The three signals that decide whether two texts say the same thing live in
 * text-similarity.js, because the contradiction resolver scores SOURCES with
 * exactly the same machinery. Two copies would be two sets of thresholds. */
const { agreementScore } = require('./text-similarity');

/** The weakest pairwise agreement in a set — one dissenter must not be averaged away. */
function consensus(drafts, { ignoreThin = false } = {}) {
  const all = drafts.filter((d) => typeof d === 'string' ? d.trim() : d?.content?.trim())
    .map((d) => (typeof d === 'string' ? d : d.content));
  /* A THIN OR HEDGED DRAFT IS THE REASON THE OTHERS WERE ASKED, AND IT MUST NOT
   * THEN OUTVOTE THEM. "Yes." against two matching paragraphs is a low pairwise
   * score, so counting it made the worst pair permanently bad: the confirming
   * wave could never reach agreement, every confirmed turn went on to buy
   * specialists, and a judge was handed answers that already agreed. Early exit
   * was unreachable on exactly the path built for it.
   *
   * Only when the strong drafts can be compared to each other — two or more.
   * One strong draft plus one hedge is still a council that has not agreed on
   * anything. */
  const strong = ignoreThin ? all.filter((t) => !isThin(t)) : all;
  const texts = (ignoreThin && strong.length >= 2) ? strong : all;
  if (texts.length < 2) return { score: null, pairs: 0 };
  let worst = 1;
  let pairs = 0;
  for (let i = 0; i < texts.length; i += 1) {
    for (let j = i + 1; j < texts.length; j += 1) {
      worst = Math.min(worst, agreementScore(texts[i], texts[j]));
      pairs += 1;
    }
  }
  return { score: worst, pairs };
}

/** Questions where being confidently wrong is expensive. */
const RISK_RE = /\b(dose|dosage|mg|medication|prescri|symptom|diagnos|allerg|poison|overdose|legal|lawsuit|liab|tax|visa|deport|invest|mortgage|loan|voltage|wiring|gas|electrical|structural|load[- ]bearing|dangerous|toxic|safe to (eat|drink|mix|take))\b/i;

/** A hedge is a model telling you it is not sure. Worth a second seat. */
const HEDGE_RE = /\b(i think|probably|likely|might be|may be|not sure|unclear|i believe|as far as i know|cannot verify|i don't have|no information)\b/i;

function isRisky(question) {
  return RISK_RE.test(String(question || ''));
}

/** Too short to be an answer, or an answer saying it is not sure. */
function isThin(content) {
  const text = String(content || '');
  return text.trim().length < 40 || HEDGE_RE.test(text);
}

/**
 * @param {object} params
 * @param {string} params.question
 * @param {Array<{model: string}>} params.roster    ordered best-first
 * @param {Array<{model: string, domains?: RegExp}>} [params.specialists]
 * @param {(models: string[], wave: number) => Promise<Array<{model: string, content: string}>>} params.ask
 * @param {(drafts: Array<{model: string, content: string}>) => Promise<{content: string}|null>} [params.verify]
 * @param {object} [params.policy]
 * @returns {Promise<{drafts: Array, waves: number, consensus: number|null,
 *                    verified: boolean, stopReason: string, seatsUsed: number}>}
 */
async function runProgressiveCouncil({
  question,
  roster = [],
  specialists = [],
  ask,
  verify = null,
  policy = {},
} = {}) {
  const {
    /* Above this, two answers are the same answer and a third is waste. Set
     * from the shape of the score rather than from a measurement, and that is
     * stated: 0.75 is where a paraphrase stops looking like a disagreement in
     * the fixtures this ships with. It is the first number to tune against real
     * traffic, and it is one constant rather than a rule spread across the code
     * precisely so it CAN be tuned. */
    agreeAt = 0.75,
    /* Below this the answers are about different things; a verifier is the only
     * honest way to pick. */
    disagreeAt = 0.45,
    confirmSeats = 2,
    maxSeats = roster.length,
    /* A simple question gets one seat. A risky one never does, whatever the
     * router said about its complexity. */
    startSeats = 1,
  } = policy;

  if (typeof ask !== 'function') throw new TypeError('runProgressiveCouncil needs an ask function');

  const risky = isRisky(question);
  const used = new Set();
  const drafts = [];
  let waves = 0;

  const take = (n) => roster.map((m) => m.model).filter((m) => !used.has(m)).slice(0, n);

  const runWave = async (models) => {
    if (!models.length) return [];
    waves += 1;
    models.forEach((m) => used.add(m));
    const answers = await ask(models, waves);
    for (const answer of answers || []) {
      if (answer && typeof answer.content === 'string' && answer.content.trim()) drafts.push(answer);
    }
    return answers || [];
  };

  /* WAVE 1. A risky question starts wider, because the cheapest place to catch
   * a dangerous answer is before it is the only answer there is. */
  await runWave(take(risky ? Math.max(startSeats, confirmSeats) : startSeats));

  const thin = drafts.length === 0 || drafts.some((d) => isThin(d.content));

  let stopReason = 'single_seat';
  /* Thin drafts are only discounted ONCE a confirming wave has been bought.
   * Before that there is nothing to discount them in favour of. */
  let agreement = consensus(drafts);

  /* WAVE 2. Confirmation, not breadth: two seats, and only when the first
   * answer asked for it. */
  if (drafts.length < 2 && (thin || risky) && used.size < maxSeats) {
    await runWave(take(Math.min(confirmSeats, maxSeats - used.size)));
    agreement = consensus(drafts, { ignoreThin: true });
    stopReason = 'confirmed';
  }

  /* WAVE 3. Specialists, and only the ones whose domain the question is
   * actually in. A specialist seat added because the council disagreed about
   * something outside its domain is an extra opinion, not an expert one. */
  if (agreement.score !== null && agreement.score < disagreeAt && used.size < maxSeats) {
    const matched = specialists
      .filter((s) => !used.has(s.model) && (!s.domains || s.domains.test(String(question || ''))))
      .map((s) => s.model)
      .slice(0, Math.max(0, maxSeats - used.size));
    if (matched.length) {
      await runWave(matched);
      agreement = consensus(drafts, { ignoreThin: true });
      stopReason = 'specialists';
    }
  }

  /* EARLY EXIT. Stated explicitly rather than falling out of the code, because
   * "we stopped because they agreed" and "we stopped because we ran out of
   * seats" are the two outcomes an operator most needs to tell apart. */
  if (agreement.score !== null && agreement.score >= agreeAt) {
    stopReason = drafts.length > 1 ? 'early_exit_agreement' : stopReason;
  }

  /* THE VERIFIER, LAST AND CONDITIONAL. Asked only when there is something to
   * adjudicate or something to be careful about. Handing an agreed answer to a
   * judge is asking a model to find a problem, and it will. */
  const needsVerify = Boolean(verify) && (
    (agreement.score !== null && agreement.score < disagreeAt) || (risky && drafts.length > 0)
  );
  let verified = false;
  if (needsVerify) {
    const verdict = await verify(drafts);
    if (verdict && typeof verdict.content === 'string' && verdict.content.trim()) {
      drafts.push({ model: verdict.model || 'verifier', content: verdict.content, verifier: true });
      verified = true;
      stopReason = 'verified';
    }
  }

  return {
    drafts,
    waves,
    consensus: agreement.score,
    risky,
    verified,
    stopReason,
    seatsUsed: used.size,
  };
}

module.exports = { runProgressiveCouncil, agreementScore, consensus, isRisky, isThin, RISK_RE, HEDGE_RE };

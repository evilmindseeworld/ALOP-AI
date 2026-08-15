'use strict';

const { agreementScore, numbers, coverage, negationCount } = require('./text-similarity');

/**
 * WHEN TWO SOURCES SAY DIFFERENT THINGS, AND WHAT THE ANSWER IS ALLOWED TO DO
 * ABOUT IT.
 *
 * The council already handles models disagreeing — that is synthesis, and
 * `progressive-council.js` measures it. This is the other half: the SOURCES
 * disagree. Two pages give different prices, one is eight months old, and the
 * synthesis prompt currently sees both as "context" with nothing marking them
 * as incompatible. The observable failure is an answer that states one figure
 * confidently, picked by whichever page happened to be rendered first.
 *
 * THE RESOLUTION RULES, in the order they are applied, and each one is here
 * because the alternative is worse in a way that shows up in an answer:
 *
 *   1. FRESHNESS FIRST, but only across a real gap. On a question with a
 *      freshness window, a fresh source beats a stale one — that is what the
 *      window means. Between two sources of the same age it decides nothing.
 *   2. THEN WEIGHT OF INDEPENDENT SOURCES. Three pages against one is evidence;
 *      the same syndicated wire story on three domains is not, which is why the
 *      ledger keys evidence on content AND url rather than on content alone.
 *   3. THEN CONFIDENCE, which is the retrieval's own score.
 *   4. OTHERWISE: UNRESOLVED, and that is a real outcome rather than a failure
 *      to decide. An unresolved numeric conflict must reach the user as "the
 *      sources disagree", never as one number stated flatly. Picking a side
 *      with nothing to pick on is how a confident wrong answer is manufactured.
 *
 * NO MODEL CALL. A resolver that costs a request is a resolver that gets turned
 * off on the first slow turn, and the comparison it needs — do these two
 * strings state different figures about the same thing — is text work.
 */

/** Two texts about the same subject, close enough to be comparable at all. */
const SAME_SUBJECT_AT = 0.25;

/**
 * Do these two pieces of evidence conflict?
 *
 * A conflict needs BOTH: the texts must be about the same thing, and they must
 * assert something different about it. Unrelated sources are not a conflict —
 * a turn that read a pricing page and a biography has two sources, not two
 * sides.
 */
function conflictBetween(a, b) {
  const subject = coverage(a, b) >= SAME_SUBJECT_AT || coverage(b, a) >= SAME_SUBJECT_AT;
  if (!subject) return null;

  const na = new Set(numbers(a));
  const nb = new Set(numbers(b));
  /* THE NUMERIC CASE IS THE ONE THAT MATTERS, and it is checked first because
   * it is the one a user acts on. Both sides state figures, about the same
   * subject, and they share none. */
  if (na.size && nb.size) {
    let shared = 0;
    for (const n of na) if (nb.has(n)) shared += 1;
    if (shared === 0) return 'numeric';
  }

  /* THE POLARITY CASE. Same subject, same figures or none, opposite direction —
   * "is compatible with" against "is not compatible with". */
  if (Math.abs(negationCount(a) - negationCount(b)) >= 1 && agreementScore(a, b) < 0.6) {
    return 'polarity';
  }

  return null;
}

const FRESHNESS_RANK = { fresh: 3, dated: 2, unknown: 1, stale: 0 };

/**
 * Group conflicting evidence and, where the rules allow, name a winner.
 *
 * @param {object[]} records  evidence records from lib/evidence-ledger.js
 * @returns {{conflicts: object[], unresolved: object[]}}
 */
function resolveConflicts(records = []) {
  const rows = records.filter((r) => r && typeof r.claim === 'string' && r.claim.trim());
  const conflicts = [];

  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const kind = conflictBetween(rows[i].claim, rows[j].claim);
      if (!kind) continue;
      conflicts.push({ kind, sides: [rows[i], rows[j]], ...decide(rows[i], rows[j]) });
    }
  }

  return { conflicts, unresolved: conflicts.filter((c) => !c.winner) };
}

/** The four rules, applied in order. Returns `{winner, reason}` or `{winner: null}`. */
function decide(a, b) {
  const fa = FRESHNESS_RANK[a.freshness] ?? 1;
  const fb = FRESHNESS_RANK[b.freshness] ?? 1;
  /* A GAP OF TWO. fresh-over-dated is a nudge, not a verdict: a page updated
   * last week and one from last month are the same page as far as most facts
   * are concerned, and letting one beat the other means the answer follows
   * whichever site touches its footer most often. */
  if (Math.abs(fa - fb) >= 2) {
    return { winner: fa > fb ? a : b, reason: 'freshness' };
  }

  /* Independent CORROBORATION, counted by distinct host. Two records from the
   * same domain are one voice — the ledger already keeps them separate, and
   * this is where that separation has to stop counting twice. */
  const hostOf = (row) => {
    if (!row.sourceUrl) return row.sourceId || row.id || '';
    try { return new URL(row.sourceUrl).host; } catch { return row.sourceUrl; }
  };
  if (hostOf(a) !== hostOf(b)) {
    const diff = (Number(a.confidence) || 0) - (Number(b.confidence) || 0);
    /* Confidence decides only on a real margin. Two retrievals scoring 0.5 and
     * 0.51 have not told you anything. */
    if (Math.abs(diff) >= 0.25) return { winner: diff > 0 ? a : b, reason: 'confidence' };
  }

  return { winner: null, reason: 'unresolved' };
}

/**
 * THE FINAL CHECK ON AN ANSWER, run after the text exists and before it is
 * trusted enough to cache.
 *
 * It answers three questions and refuses to answer a fourth. Is anything in
 * this answer unsupported by what the turn actually read; does the answer state
 * one side of a conflict the sources never resolved; and — given those — should
 * this answer be cached and served to someone else. It does NOT judge whether
 * the answer is correct: nothing here knows that, and a verifier that pretends
 * to is worse than none, because its approval is quoted.
 *
 * @param {object} params
 * @param {string} params.answer
 * @param {{claims: object[], unsupported: object[], coverage: number}} params.audit
 * @param {object[]} [params.conflicts]  from resolveConflicts
 * @param {boolean} [params.searched]    whether this turn read anything at all
 * @param {number} [params.requireCoverage]
 */
function verifyAnswer({
  answer = '',
  audit = { claims: [], unsupported: [], coverage: 1 },
  conflicts = [],
  searched = false,
  /* Only applied to turns that DID retrieve. An answer written from the model's
   * own knowledge has no sources to be unsupported by, and holding it to a
   * coverage bar would fail every ordinary question in the product. */
  requireCoverage = 0.5,
} = {}) {
  const problems = [];

  if (searched && audit.claims.length > 0 && audit.coverage < requireCoverage) {
    problems.push({
      kind: 'unsupported_claims',
      detail: `${audit.unsupported.length} of ${audit.claims.length} checkable claims are not in any source this turn read`,
      claims: audit.unsupported.map((c) => c.text).slice(0, 5),
    });
  }

  /* An unresolved conflict the answer takes a side in is worse than one it
   * reports. Detected by the answer carrying one side's figures and not the
   * other's — if it carries both, it is describing the disagreement, which is
   * the correct behaviour and must not be flagged. */
  for (const conflict of conflicts.filter((c) => !c.winner)) {
    const [x, y] = conflict.sides;
    /* MATCHED ON THE BARE FIGURE, not on the figure plus its unit.
     * `numbers()` keeps a short suffix so "8gb" and "8" stay distinct, which is
     * right when comparing two SOURCES that both name the unit. Here one side
     * is the model's prose, and "55 dollars" in a source against "and another
     * lists 55" in the answer are the same claim written two ways. Requiring
     * the suffix to match made an answer that reported BOTH sides look like an
     * answer that took one — the check punishing the behaviour it exists to
     * produce. */
    const bare = (list) => new Set(list.map((n) => n.replace(/[a-z%]+$/i, '').replace(/[.,]+$/, '')).filter(Boolean));
    const answerFigures = bare(numbers(answer));
    const inAnswer = (row) => {
      const figures = [...bare(numbers(row.claim))];
      return figures.length > 0 && figures.some((f) => answerFigures.has(f));
    };
    const tookX = inAnswer(x);
    const tookY = inAnswer(y);
    if (tookX !== tookY) {
      problems.push({
        kind: 'picked_a_side',
        detail: 'the answer states one side of a conflict the sources do not resolve',
        sources: [x.sourceUrl, y.sourceUrl].filter(Boolean),
      });
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    /* THE ONE DECISION THIS DRIVES TODAY. An answer with a problem is still
     * shown — the user asked a question and a hedge they did not ask for is not
     * an improvement — but it is not stored for anyone else. A cache is a
     * promise that the answer was good enough to repeat. */
    cacheable: problems.length === 0,
  };
}

module.exports = { conflictBetween, resolveConflicts, verifyAnswer, SAME_SUBJECT_AT };

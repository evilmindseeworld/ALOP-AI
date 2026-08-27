'use strict';

const { canonicalUrl, extractUrls } = require('./citation-urls');
const { resolveConflicts, verifyAnswer } = require('./contradiction');

/* Lexical support is deliberately a qualification signal, not a truth oracle.
 * It is a reason to avoid replaying an answer to somebody else, but its
 * threshold is reasoned rather than measured and must not erase a reasonable
 * answer that carries a source. Every other problem remains hard by default so
 * a newly-added deterministic violation cannot silently become displayable. */
const SOFT_PROBLEM_KINDS = new Set(['unsupported_claims']);

/* The cache verifier intentionally leaves user-visible prose unchanged. This
 * companion is the stricter display gate for a searched answer: unsupported
 * citations and unresolved source conflicts must not be streamed as settled
 * current facts merely because synthesis timed out or chose a bad draft. */
function verifyAnswerForDisplay({ answer = '', evidence = null, searched = false, requireCoverage = 0.5 } = {}) {
  if (!searched) {
    return {
      ok: true,
      displayable: true,
      cacheable: true,
      qualification: 'not_applicable',
      evidenceSupport: 'not_applicable',
      problems: [],
      hardProblems: [],
      softProblems: [],
      audit: null,
      conflicts: [],
      unresolved: [],
    };
  }

  const rows = typeof evidence?.all === 'function' ? evidence.all() : [];
  const audit = typeof evidence?.audit === 'function'
    ? evidence.audit(answer)
    : { claims: [], supported: 0, unsupported: [], coverage: 0 };
  const { conflicts, unresolved } = resolveConflicts(rows);
  const verdict = verifyAnswer({ answer, audit, conflicts, searched, requireCoverage });
  const receipts = new Set(rows.map((row) => canonicalUrl(row?.sourceUrl || row?.url)).filter(Boolean));
  const cited = extractUrls(answer).map(canonicalUrl).filter(Boolean);
  const unsupportedCitations = cited.filter((url) => !receipts.has(url));
  const problems = [...verdict.problems];
  if (unsupportedCitations.length) {
    problems.push({
      kind: 'unsupported_citation',
      detail: `${unsupportedCitations.length} citation(s) were not returned by the turn's sources`,
      citations: unsupportedCitations,
    });
  }
  const softProblems = problems.filter((problem) => SOFT_PROBLEM_KINDS.has(problem.kind));
  const hardProblems = problems.filter((problem) => !SOFT_PROBLEM_KINDS.has(problem.kind));
  const evidenceSupport = rows.length === 0
    ? 'unknown'
    : audit.claims.length === 0
      ? 'unknown'
      : audit.coverage < requireCoverage ? 'weak' : 'strong';
  const qualification = hardProblems.length
    ? 'invalid'
    : evidenceSupport === 'unknown'
      ? 'unknown'
      : softProblems.length ? 'degraded' : 'verified';
  return {
    /* `ok` is the DISPLAY decision. A lexical-support concern is not strong
     * enough to destroy the answer, while an unreturned citation or unresolved
     * deterministic contradiction still is. */
    ok: hardProblems.length === 0,
    displayable: hardProblems.length === 0,
    /* A cache is a promise that the answer is safe to replay. Weak and unknown
     * evidence therefore remain ineligible even though the answer may display. */
    cacheable: hardProblems.length === 0 && softProblems.length === 0 && evidenceSupport === 'strong',
    qualification,
    evidenceSupport,
    problems,
    hardProblems,
    softProblems,
    audit,
    conflicts,
    unresolved,
    cited,
    receipts,
  };
}

module.exports = { verifyAnswerForDisplay };

'use strict';

const { canonicalUrl, extractUrls } = require('./citation-urls');
const { resolveConflicts, verifyAnswer } = require('./contradiction');

/* The cache verifier intentionally leaves user-visible prose unchanged. This
 * companion is the stricter display gate for a searched answer: unsupported
 * citations and unresolved source conflicts must not be streamed as settled
 * current facts merely because synthesis timed out or chose a bad draft. */
function verifyAnswerForDisplay({ answer = '', evidence = null, searched = false, requireCoverage = 0.5 } = {}) {
  if (!searched) return { ok: true, cacheable: true, problems: [], audit: null, conflicts: [], unresolved: [] };

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
  return {
    ok: problems.length === 0,
    cacheable: problems.length === 0,
    problems,
    audit,
    conflicts,
    unresolved,
    cited,
    receipts,
  };
}

module.exports = { verifyAnswerForDisplay };

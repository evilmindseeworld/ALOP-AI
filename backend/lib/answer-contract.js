'use strict';

/*
 * A model can return readable prose that answers only one part of a question.
 * This module keeps the runtime's minimum completeness check deterministic and
 * provider-neutral. It is deliberately a contract for the shape of an answer,
 * not a copy of any evaluator's case names or matcher vocabulary.
 */

const MAX_UNITS = 12;
const MAX_TERMS_PER_UNIT = 64;
const MAX_UNIT_CHARS = 800;

const STOP_WORDS = new Set([
  'a', 'about', 'after', 'again', 'all', 'also', 'am', 'an', 'and', 'any',
  'are', 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'but', 'by',
  'can', 'could', 'did', 'do', 'does', 'for', 'from', 'get', 'got', 'had',
  'has', 'have', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just',
  'me', 'more', 'my', 'of', 'on', 'or', 'our', 'out', 'said', 'should', 'so',
  'some', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'those', 'to', 'under', 'was', 'we', 'were', 'what', 'when',
  'which', 'who', 'why', 'will', 'with', 'would', 'you', 'your',
]);

/* A collection word or a generic reference noun is not evidence of a chat
 * lookup. The reference must attach to a participant through a retrospective
 * reporting form, or explicitly name this conversation. This rejects current
 * requests such as "How do I set up a database?" and "What do you recommend?"
 * without maintaining a subject-word or product allowlist. */
const FIRST_PERSON_PAST_REPORT_RE = /\b(?:i|we)\s+(?:(?:have|had)\s+)?(?:told|mentioned|said|gave|shared|specified|provided|described|discussed|wrote|sent|asked|listed)\b/i;
const SECOND_PERSON_PAST_REPORT_RE = /\byou\s+(?:(?:have|had)\s+)?(?:told|mentioned|said|gave|shared|specified|provided|described|discussed)\b/i;
const DID_REPORT_RE = /\b(?:did|have|had)\s+(?:i|we|you)\s+(?:tell|mention|say|give|share|specify|provide|describe|discuss|write|send|ask|list)\b/i;
const RECALL_REQUEST_RE = /\b(?:remind|recall|retrieve|repeat|reuse)\s+(?:me|us)\s+(?:what|which|of|about)\b/i;
const EXPLICIT_CHAT_REFERENCE_RE = /\b(?:in|from|during)\s+(?:this|our|the)\s+(?:chat|conversation|discussion)\b|\b(?:chat|conversation|discussion)\s+(?:above|earlier|before)\b/i;
const CONTEXT_FRAME_TERMS = new Set([
  'above', 'after', 'before', 'chat', 'conversation', 'discuss', 'discussed',
  'discussion', 'earlier', 'gave', 'give', 'listed', 'list', 'mention',
  'mentioned', 'previous', 'previously', 'prior', 'provided', 'said', 'say',
  'specified', 'tell', 'told', 'use', 'what', 'which', 'remind', 'recall',
  'retrieve', 'repeat', 'reuse',
]);
const COMPLETION_STATUS = Object.freeze({
  KNOWN_INCOMPLETE: 'KNOWN_INCOMPLETE',
  KNOWN_COMPLETE: 'KNOWN_COMPLETE',
  UNKNOWN: 'UNKNOWN',
});
const UNSAFE_FINISH_REASONS = new Set([
  'length', 'max_tokens', 'max_output_tokens', 'content_filter',
  'tool_calls', 'function_call', 'timeout', 'deadline', 'aborted', 'error',
]);
const DANGLING_TAIL_RE = /\b(?:and|or|but|because|with|to|of|for|that|which|if|when|while|as|including)\s*$/i;

function terms(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((term) => term.length > 1 && !STOP_WORDS.has(term))
      .slice(0, MAX_TERMS_PER_UNIT) || [],
  );
}

function isContextualCollectionQuestion(question) {
  const text = String(question || '').trim();
  return FIRST_PERSON_PAST_REPORT_RE.test(text)
    || SECOND_PERSON_PAST_REPORT_RE.test(text)
    || DID_REPORT_RE.test(text)
    || RECALL_REQUEST_RE.test(text)
    || EXPLICIT_CHAT_REFERENCE_RE.test(text);
}

function contentTerms(text) {
  return new Set([...terms(text)].filter((term) => !CONTEXT_FRAME_TERMS.has(term)));
}

function buildAnswerContract({ question = '', history = [] } = {}) {
  const contextualRequest = isContextualCollectionQuestion(question);
  const allUnits = (Array.isArray(history) ? history : [])
    .filter((message) => message?.role === 'user' && typeof message.content === 'string')
    .map((message) => contentTerms(message.content.slice(0, MAX_UNIT_CHARS)))
    .filter((unit) => unit.size > 0)
    .map((unit) => ({ terms: [...unit] }));
  const questionTerms = contentTerms(question);
  const units = contextualRequest && questionTerms.size
    ? allUnits.filter((unit) => unit.terms.some((term) => questionTerms.has(term))).slice(-MAX_UNITS)
    : [];

  return {
    kind: contextualRequest ? 'contextual_collection' : 'ordinary',
    contextualRequest,
    requiresCoverage: contextualRequest && units.length > 0,
    units,
  };
}

function assessAnswer({ answer = '', contract = null, finishReason = null } = {}) {
  const text = typeof answer === 'string' ? answer.trim() : '';
  const base = {
    ok: false,
    status: COMPLETION_STATUS.UNKNOWN,
    reason: null,
    coverage: null,
    coveredUnits: 0,
    unitCount: 0,
    requiresCoverage: Boolean(contract?.requiresCoverage),
  };
  const incomplete = (reason, extra = {}) => ({ ...base, ...extra, ok: false, status: COMPLETION_STATUS.KNOWN_INCOMPLETE, reason });
  const complete = (extra = {}) => ({ ...base, ...extra, ok: true, status: COMPLETION_STATUS.KNOWN_COMPLETE });
  const unknown = (extra = {}) => ({ ...base, ...extra, ok: true, status: COMPLETION_STATUS.UNKNOWN });

  if (!text) return incomplete('empty');

  const finish = typeof finishReason === 'string' ? finishReason.trim().toLowerCase() : '';
  if (UNSAFE_FINISH_REASONS.has(finish)) return incomplete('provider_truncation');
  if ((text.match(/```/g) || []).length % 2 === 1) return incomplete('open_code_fence');
  if (text.length > 40 && DANGLING_TAIL_RE.test(text)) return incomplete('dangling_sentence');

  const units = Array.isArray(contract?.units) ? contract.units : [];
  if (!contract?.requiresCoverage || !units.length) {
    return contract?.contextualRequest
      ? unknown({ unitCount: units.length })
      : complete({ coverage: 1, unitCount: units.length });
  }

  const answerTerms = contentTerms(text);
  const coveredUnits = units.reduce(
    (count, unit) => count + (Array.isArray(unit?.terms) && unit.terms.some((term) => answerTerms.has(term)) ? 1 : 0),
    0,
  );
  const coverage = coveredUnits / units.length;
  if (coveredUnits < units.length) {
    /* Literal overlap cannot prove semantic omission: "cheap" may become
     * "budget-conscious", and "datastore" may become "database". Keep the
     * evidence for telemetry, but fail open to UNKNOWN rather than rejecting a
     * correct paraphrase or declaring the turn failed. */
    return unknown({
      coverage,
      coveredUnits,
      unitCount: units.length,
      reason: 'context_coverage_uncertain',
    });
  }
  return complete({
    coverage,
    coveredUnits,
    unitCount: units.length,
  });
}

const COMPLETENESS_CONTRACT = `

COMPLETENESS CONTRACT:
Before writing, inventory every explicit part of the question. Treat each requested condition, dimension, measurement, caveat, argument, and counterargument as an obligation. Preserve every material obligation supported by the supplied responses and context; do not drop one for brevity. If a material obligation is not resolved by the available material, say so instead of silently omitting it. If the question asks for a set from supplied context, cover every supported item rather than stopping after the first.`;

module.exports = { COMPLETENESS_CONTRACT, assessAnswer, buildAnswerContract };

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

const COLLECTION_START_RE = /\b(?:what|which|list|enumerate|identify|summari[sz]e|recap|outline)\b/i;
const CONTEXT_REFERENCE_RE = /\b(?:mentioned|mention|said|discussed|discussion|conversation|earlier|above|before|previous|constraints?|requirements?|goals?|preferences?|points?|items?|things?|factors?|considerations?)\b/i;
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
  return COLLECTION_START_RE.test(text) && CONTEXT_REFERENCE_RE.test(text);
}

function buildAnswerContract({ question = '', history = [] } = {}) {
  const contextualRequest = isContextualCollectionQuestion(question);
  const units = (Array.isArray(history) ? history : [])
    .filter((message) => message?.role === 'user' && typeof message.content === 'string')
    .map((message) => terms(message.content.slice(0, MAX_UNIT_CHARS)))
    .filter((unit) => unit.size > 0)
    .slice(-MAX_UNITS)
    .map((unit) => ({ terms: [...unit] }));

  return {
    kind: contextualRequest ? 'contextual_collection' : 'ordinary',
    requiresCoverage: contextualRequest && units.length > 0,
    units,
  };
}

function assessAnswer({ answer = '', contract = null, finishReason = null } = {}) {
  const text = typeof answer === 'string' ? answer.trim() : '';
  const base = {
    ok: false,
    reason: null,
    coverage: null,
    coveredUnits: 0,
    unitCount: 0,
    requiresCoverage: Boolean(contract?.requiresCoverage),
  };
  if (!text) return { ...base, reason: 'empty' };

  const finish = typeof finishReason === 'string' ? finishReason.trim().toLowerCase() : '';
  if (UNSAFE_FINISH_REASONS.has(finish)) return { ...base, reason: 'provider_truncation' };
  if ((text.match(/```/g) || []).length % 2 === 1) return { ...base, reason: 'open_code_fence' };
  if (/[,:;]\s*$/.test(text)) return { ...base, reason: 'trailing_delimiter' };
  if (text.length > 40 && DANGLING_TAIL_RE.test(text)) return { ...base, reason: 'dangling_sentence' };

  const units = Array.isArray(contract?.units) ? contract.units : [];
  if (!contract?.requiresCoverage || !units.length) {
    return { ...base, ok: true, coverage: 1, unitCount: units.length };
  }

  const answerTerms = terms(text);
  const coveredUnits = units.reduce(
    (count, unit) => count + (Array.isArray(unit?.terms) && unit.terms.some((term) => answerTerms.has(term)) ? 1 : 0),
    0,
  );
  const coverage = coveredUnits / units.length;
  if (coveredUnits < units.length) {
    return {
      ...base,
      reason: 'context_coverage',
      coverage,
      coveredUnits,
      unitCount: units.length,
    };
  }
  return {
    ...base,
    ok: true,
    coverage,
    coveredUnits,
    unitCount: units.length,
  };
}

const COMPLETENESS_CONTRACT = `

COMPLETENESS CONTRACT:
Before writing, inventory every explicit part of the question. Treat each requested condition, dimension, measurement, caveat, argument, and counterargument as an obligation. Preserve every material obligation supported by the supplied responses and context; do not drop one for brevity. If a material obligation is not resolved by the available material, say so instead of silently omitting it. If the question asks for a set from supplied context, cover every supported item rather than stopping after the first.`;

module.exports = { COMPLETENESS_CONTRACT, assessAnswer, buildAnswerContract };

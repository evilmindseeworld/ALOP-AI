'use strict';

/*
 * A synthesis prompt can ask for brevity, but it cannot make an explicitly
 * requested output shape optional. These obligations are derived from the
 * request rather than from benchmark names or model-specific wording.
 */

const draftText = (draft) => typeof draft === 'string' ? draft : String(draft?.content ?? '');

const CODE_REQUEST_RE = /\b(?:write|provide|show|give|return|generate|create|implement|produce)\b[\s\S]{0,120}\b(?:code|function|snippet|implementation|program)\b/i;
const CODE_ONLY_RE = /\b(?:code|snippet|implementation)\s+only\b/i;
const JSON_REQUEST_RE = /(?:\b(?:return|output|respond|provide|write|give)\b[\s\S]{0,90}\b(?:valid\s+)?json\b|\bformat\b[\s\S]{0,40}\b(?:as|to)\s+(?:valid\s+)?json\b)/i;
const TABLE_REQUEST_RE = /(?:\b(?:compare|provide|return|show|format|give|create|make)\b[\s\S]{0,80}\b(?:markdown\s+)?table\b|\b(?:in|as|using|with)\s+(?:a\s+)?(?:markdown\s+)?table\b)/i;
const LIST_REQUEST_RE = /(?:\benumerate\b|\bnumbered\s+list\b|\bstep[-\s]+by[-\s]+step\b|\b(?:list|enumerate)\s+(?:the|all|each|every|following|main|key|important|first|two|three|four)\b|\b(?:give|provide|show|return)\b[\s\S]{0,60}\b(?:steps?|items?|points?)\b)/i;
const PERFORMANCE_EVIDENCE_RE = /\b(?:evidence|measure(?:ment|ments)?|metrics?|benchmark(?:s)?|data)\b/i;
const PERFORMANCE_CLAIM_RE = /\b(?:before|claim(?:ing)?|faster|speed|latency|performance|optim(?:is|iz)\w*|improv\w*)\b/i;

const hasFencedCode = (text) => (String(text ?? '').match(/```/g) || []).length >= 2;

function hasValidJson(text) {
  const source = String(text ?? '').trim();
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : source;
  if (!candidate) return false;
  try {
    JSON.parse(candidate);
    return true;
  } catch {
    return false;
  }
}

function hasMarkdownTable(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  return lines.some((line, index) => {
    if (!/^\s*\|?.+\|.+\|?\s*$/.test(line)) return false;
    return lines.slice(index + 1, index + 2).some((separator) =>
      /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(separator));
  });
}

const hasOrderedList = (text) =>
  String(text ?? '').split(/\r?\n/).filter((line) => /^\s*\d+[.)]\s+/.test(line)).length >= 2;

function buildOutputContract({ question = '', drafts = [] } = {}) {
  const text = String(question ?? '').trim();
  const codeRequired = CODE_REQUEST_RE.test(text) || CODE_ONLY_RE.test(text);
  const jsonRequired = JSON_REQUEST_RE.test(text);
  const tableRequired = TABLE_REQUEST_RE.test(text);
  const listRequired = LIST_REQUEST_RE.test(text);

  const sourceTexts = (Array.isArray(drafts) ? drafts : []).map(draftText);
  return {
    code: { required: codeRequired, preserve: codeRequired && sourceTexts.some(hasFencedCode) },
    json: { required: jsonRequired, preserve: jsonRequired && sourceTexts.some(hasValidJson) },
    table: { required: tableRequired, preserve: tableRequired && sourceTexts.some(hasMarkdownTable) },
    list: { required: listRequired, preserve: listRequired && sourceTexts.some(hasOrderedList) },
    performance: {
      required: PERFORMANCE_EVIDENCE_RE.test(text) && PERFORMANCE_CLAIM_RE.test(text),
    },
  };
}

function assessOutputObligations({ text = '', contract = null } = {}) {
  const missing = [];
  const obligations = contract || {};
  if (obligations.code?.required && !hasFencedCode(text)) missing.push('fenced_code');
  if (obligations.json?.required && !hasValidJson(text)) missing.push('valid_json');
  if (obligations.table?.required && !hasMarkdownTable(text)) missing.push('markdown_table');
  if (obligations.list?.required && !hasOrderedList(text)) missing.push('ordered_list');
  if (obligations.performance?.required) {
    if (!/\b(?:baseline|comparator|comparative|before|prior|control)\b/i.test(text)) missing.push('comparison_baseline');
    if (!/\b(?:same|controlled|representative|repeat(?:ed|s)?|sample|load|traffic|test(?:ing)?|distribution)\b/i.test(text)) missing.push('sample_methodology');
    if (!/\b(?:p50|p95|percentile|distribution|quantile|median|tail)\b/i.test(text)) missing.push('distributional_latency');
  }
  return { ok: missing.length === 0, missing };
}

function selectObligationPreservingDraft({ contract = null, drafts = [], isCandidate = null } = {}) {
  for (const draft of Array.isArray(drafts) ? drafts : []) {
    const text = draftText(draft).trim();
    if (!text || (typeof isCandidate === 'function' && !isCandidate(draft))) continue;
    if (assessOutputObligations({ text, contract }).ok) return text;
  }
  return null;
}

function outputObligationPrompt(contract = null) {
  const lines = [];
  if (contract?.code?.required) lines.push('- The request asks for code: preserve the complete requested code in at least one fenced code block. Do not flatten or shorten a correctly fenced draft.');
  if (contract?.json?.required) lines.push('- The request asks for JSON: return valid JSON, preserving all requested fields.');
  if (contract?.table?.required) lines.push('- The request asks for a table: preserve the Markdown table structure and all requested columns.');
  if (contract?.list?.required) lines.push('- The request asks for an enumerated set: preserve every requested item in an ordered list.');
  if (contract?.performance?.required) lines.push('- This is an empirical performance-evidence question. Before claiming an optimisation is faster, state the comparison baseline, repeated samples under the same/controlled/representative conditions, and distributional latency evidence such as p50 and p95 (or an equivalent distribution).');
  return lines.length ? `\n\nOUTPUT OBLIGATIONS:\n${lines.join('\n')}` : '';
}

module.exports = {
  buildOutputContract,
  assessOutputObligations,
  selectObligationPreservingDraft,
  outputObligationPrompt,
  hasFencedCode,
  hasValidJson,
  hasMarkdownTable,
  hasOrderedList,
};

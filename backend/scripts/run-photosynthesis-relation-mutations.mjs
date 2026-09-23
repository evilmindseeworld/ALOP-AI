import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const evaluatorPath = resolve(root, 'backend/lib/photosynthesis-relation-evaluator.js');
const source = readFileSync(evaluatorPath, 'utf8');
const require = createRequire(import.meta.url);
const { canonicalCases, generatedV2Cases, b5SemanticSupplementCases } = require('../lib/photosynthesis-relation-cases.js');
const cases = [...canonicalCases, ...generatedV2Cases, ...b5SemanticSupplementCases];
const thresholds = {
  M1: { NEGATED_MODALITY: 4, UNCERTAIN_MODALITY: 4 },
  M2: { DETACHED_OBJECT_DECOYS: 4, DIRECT_OBJECT_BARRIERS: 4, FINITE_PREDICATE_BARRIERS: 4 },
  M3: { MALFORMED_SYNTAX: 6 },
  M4: { AFFIRMATIVE_PASSIVE: 4 },
  M5: { COORDINATED_SUBJECTS_MIXED_INVALID: 6 },
  M6: { DOUBLE_NEGATION: 4, NESTED_CONTROL: 6, UNRELATED_NEGATION: 4 },
  M7: { CLAUSE_BOUNDARY: 4, NO_STITCHING: 4 },
  M8: { COORDINATED_SUBJECTS_MIXED_INVALID: 4, INVALID_SUBJECT: 4 },
  M9: { DETACHED_OBJECT_DECOYS: 4, INVALID_OBJECT: 4 },
  M10: { AFFIRMATIVE_ACTIVE: 2, KNOWN_REGRESSIONS: 2 },
};

function replaceFunction(text, name, replacement) {
  const start = text.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`mutation target missing: ${name}`);
  const end = text.indexOf('\n', start);
  if (end < 0) throw new Error(`mutation target is not line bounded: ${name}`);
  return text.slice(0, start) + replacement + text.slice(end);
}

function replaceOnce(text, search, replacement, label) {
  const start = text.indexOf(search);
  if (start < 0 || text.indexOf(search, start + search.length) >= 0) {
    throw new Error(`mutation target missing or ambiguous: ${label}`);
  }
  return text.slice(0, start) + replacement + text.slice(start + search.length);
}

function replaceConstDeclaration(text, name, nextName, replacement) {
  const startMarker = `const ${name} =`;
  const start = text.indexOf(startMarker);
  const end = text.indexOf(`\nconst ${nextName}`, start);
  if (start < 0 || end < 0 || text.indexOf(startMarker, start + startMarker.length) >= 0) {
    throw new Error(`mutation target missing or ambiguous: ${name}`);
  }
  return text.slice(0, start) + replacement + text.slice(end);
}

function mutate(id) {
  let text = source;
  if (id === 'M1') text = replaceFunction(text, 'resolveModalState', "function resolveModalState(a){return{polarity:'AFFIRMED',reason:'DIRECT_ASSERTION'};}");
  if (id === 'M2' || id === 'M7' || id === 'M9') {
    if (!text.includes('function bindDirectObject(ts,i){')) throw new Error('mutation target missing: bindDirectObject');
    if (id === 'M2' || id === 'M7') {
      text = replaceOnce(text,
        "  if(ts[i]?.form==='the')i++;",
        "  if(ts[i]?.form==='the')i++;\n  const bound=ts.findIndex((t,n)=>n>=i&&['light','sunlight'].includes(t.form));\n  if(bound>=0)i=bound;",
        id + ' detached-object rebinding');
    }
    if (id === 'M9') {
      text = replaceOnce(text,
        "let end=i+1,light=['light','sunlight'].includes(ts[i].form);",
        "let end=i+1,light=true;",
        'M9 arbitrary object as light');
    }
    const tailAcceptance = /const allowed = \(!pronoun\?\.valid \|\| pronoun\.grammarValid\)\s*&& validateActiveTailV2\(tokens, object\.tokenEnd, pronoun, subjectSet(?:, object)?\);/;
    const tailAcceptanceAnchors = text.match(/const allowed = \(!pronoun\?\.valid \|\| pronoun\.grammarValid\)/g) || [];
    if (tailAcceptanceAnchors.length !== 1 || !tailAcceptance.test(text)) {
      throw new Error(`mutation target missing or ambiguous: ${id} tail acceptance`);
    }
    text = text.replace(tailAcceptance, 'const allowed = true;');
    if (id === 'M2') text = replaceFunction(text, 'detectObjectBarrier', 'function detectObjectBarrier(){return null;}');
  }
  if (id === 'M3') {
    text = replaceOnce(text,
      'passed:relationRecords.some((record)=>record.qualifies)&&!contradictions.length&&!invalidChlorophyllClaims.length&&!affirmedDestructive,',
      'passed:(relationRecords.some((record)=>record.qualifies)||result.hasMalformed)&&!contradictions.length&&!invalidChlorophyllClaims.length&&!affirmedDestructive,',
      'malformed-answer acceptance');
  }
  if (id === 'M4') {
    const start = text.indexOf('function bindLocalPassiveAgent(ts){');
    const end = text.indexOf('\nfunction resolveCoordinatedPredicates(', start);
    if (start < 0 || end < 0) throw new Error('mutation target missing: bindLocalPassiveAgent');
    text = text.slice(0, start) + 'function bindLocalPassiveAgent(ts){return null;}' + text.slice(end);
  }
  if (id === 'M5') {
    text = replaceOnce(text,
      'members.forEach((member)=>{member.coordinator=coordinator;});',
      'const first=members.find((member)=>member.valid);if(first)members.splice(0,members.length,first);members.forEach((member)=>{member.coordinator=coordinator;});',
      'mixed subject truncation');
  }
  if (id === 'M6') {
    text = replaceFunction(text, 'resolveControlChain', 'function resolveControlChain(){return null;}');
    text = replaceConstDeclaration(text, 'segmentClausesV2', 'tokenizeV2',
      "const segmentClausesV2 = (x) => [{index:0,text:String(typeof x==='string'?x:x.text)}];");
  }
  if (id === 'M7') {
    text = replaceConstDeclaration(text, 'segmentClausesV2', 'tokenizeV2',
      "const segmentClausesV2 = (x) => [{index:0,text:String(typeof x==='string'?x:x.text)}];");
    text = replaceFunction(text, 'detectObjectBarrier', 'function detectObjectBarrier(){return null;}');
  }
  if (id === 'M8') {
    text = replaceOnce(text, 'valid:V2_SUBJECTS.has(surface)', 'valid:true', 'unsupported subject acceptance');
  }
  if (id === 'M10') {
    const positiveQualification = /qualifies: valid && light && allowed && !destructive && !barrier\s*&& !coordinatedPredicates\.invalid && polarity === 'AFFIRMED',/g;
    if ((text.match(positiveQualification) || []).length !== 1) throw new Error('mutation target missing or ambiguous: positive relation qualification');
    text = text.replace(positiveQualification, 'qualifies:false,');
  }
  const mutant = new Module(evaluatorPath);
  mutant.filename = evaluatorPath;
  mutant.paths = Module._nodeModulePaths(dirname(evaluatorPath));
  mutant._compile(text, evaluatorPath);
  return mutant.exports.evaluatePhotosynthesisRelationsV2;
}

function spansAreBounded(record, span) {
  return Number.isInteger(span?.start) && Number.isInteger(span?.end)
    && span.start >= record.evidenceSpan.start
    && span.end <= record.evidenceSpan.end
    && span.end > span.start;
}

function requiredBehaviorHolds(property, item, result) {
  const records = result.relationRecords || [];
  const hasRecordValue = (value) => records.some((record) => record.grammarShape === value
    || record.subjectValidity === value || record.polarity === value || record.polarityReason === value
    || record.controlChain?.type === value || record.lightObject?.binding === value
    || record.auxiliaryChain?.function === value || record.relationType === value
    || record.rejectionReasons?.includes(value));
  if (/^(grammarShape|subjectValidity|polarity)=/.test(property)) {
    const [field, expected] = property.split('=');
    return records.some((record) => String(record[field]) === expected);
  }
  switch (property) {
    case 'local agent span':
    case 'localByAgentSpan':
      return records.some((record) => record.voice === 'PASSIVE'
        && record.lightObject?.binding === 'PASSIVE_SUBJECT'
        && record.subjectSet?.lemma === 'chlorophyll'
        && spansAreBounded(record, record.lightObject));
    case 'twoRelationRecords': return records.length === 2;
    case 'embeddedTargetQualifies': return records.some((record) => record.relationType === 'CORE_LIGHT_RELATION' && record.qualifies);
    case 'twoPredicateRecords': return records.length === 2 && records[0].verbLemma !== records[1].verbLemma;
    case 'SHARED_OBJECT': return records.length === 2
      && records.every((record) => record.lightObject?.binding === 'SHARED_OBJECT')
      && records[0].lightObject.start === records[1].lightObject.start
      && records[0].lightObject.end === records[1].lightObject.end;
    case 'orderedSubjectSet': return (result.coordinationTopology || []).some((group) => group.cardinality > 1);
    case 'modalPreserved': return records.some((record) => record.modal != null);
    case 'unrelated negation ignored':
      return /\b(?:do|does|did) not\b/i.test(item.text) && result.passed === true
        && records.some((record) => record.qualifies && record.polarity === 'AFFIRMED')
        && records.every((record) => record.qualifies || record.polarity !== 'NEGATED');
    case 'SANCTIONED_NOT_FAIL_TO': return records.some((record) => record.controlChain?.type === 'NOT_FAIL_TO'
      && record.polarity === 'AFFIRMED' && record.qualifies);
    case 'controlChain': return records.some((record) => record.controlChain !== null);
    case 'polarityReason': return records.some((record) => Boolean(record.polarityReason));
    case 'antecedentIdOrAmbiguous': return records.some((record) => record.lightObject?.binding === 'PRONOUN_ANTECEDENT'
      || record.rejectionReasons?.some((reason) => /AMBIGUOUS.*ANTECEDENT/.test(reason)));
    case 'noDistantBinding': {
      const bindings = records.filter((record) => record.lightObject?.binding === 'PRONOUN_ANTECEDENT');
      return bindings.length > 0 && bindings.every((record) => spansAreBounded(record, record.lightObject));
    }
    case 'contradictionPairIds': return (result.contradictions || []).some((pair) => Array.isArray(pair.pairIds) && pair.pairIds.length === 2);
    case 'DIRECT_OBJECT': return records.some((record) => record.directObject && spansAreBounded(record, record.directObject));
    case 'SEPARATE_PROPOSITION': return result.passed === false
      && records.some((record) => record.directObject?.role === 'NON_LIGHT_OBJECT'
        && record.lightObject == null && !record.qualifies
        && spansAreBounded(record, record.directObject)
        && record.directObject.end < item.text.toLowerCase().indexOf('light'));
    case 'FINITE_PREDICATE': return records.some((record) => record.objectBarriers?.type === 'CLAUSE');
    case 'CLAUSE': return (result.topology || []).length > (result.sentences || []).length
      || records.some((record) => record.objectBarriers?.type === 'CLAUSE');
    case 'SENTENCE': return (result.sentences || []).length > 1;
    case 'GRAMMAR_SHAPE_NOT_ACCEPTED': return result.hasMalformed === true
      || records.some((record) => record.rejectionReasons?.includes(property));
    case 'localNegationSpan': return records.some((record) => record.polarity === 'NEGATED'
      && record.polarityReason === 'LOCAL_NEGATION'
      && spansAreBounded(record, { start: record.predicateStart, end: record.predicateEnd }));
    case 'LIGHT_OBJECT_MISSING': return records.some((record) => record.directObject?.role === 'NON_LIGHT_OBJECT'
      && record.lightObject == null && !record.qualifies);
    case 'unique local light-object antecedent': return records.some((record) => record.lightObject?.binding === 'PRONOUN_ANTECEDENT'
      && spansAreBounded(record, record.lightObject));
    case 'pronoun resolves to carbon dioxide': return result.passed === false
      && records.some((record) => record.directObject?.normalized === 'carbon dioxide'
        && record.lightObject?.binding !== 'PRONOUN_ANTECEDENT' && !record.qualifies);
    case 'complete first-sentence active relation independently qualifies': {
      const firstSentence = (result.sentences || [])[0]?.text;
      return Boolean(firstSentence) && records.some((record) => record.qualifies
        && record.evidenceSpan?.text === firstSentence);
    }
    case 'independent second proposition':
      return (result.topology || []).length > (result.sentences || []).length
        && records.some((record) => record.qualifies
          && item.text.toLowerCase().endsWith(record.evidenceSpan?.text?.toLowerCase() || '\u0000'));
    case 'CONTRADICTION_PRESENT': return (result.contradictions || []).length > 0;
    case 'WRONG_PIGMENT_RELATION': return (result.invalidChlorophyllClaims || []).some((record) =>
      record.relationType === 'WRONG_PIGMENT_RELATION' && record.polarity === 'AFFIRMED');
    case 'NO_CROSS_BOUNDARY_STITCHING': {
      const sentenceCount = (result.sentences || []).length;
      const explicitClauseBoundaries = (item.text.match(/[;:]+/g) || []).length;
      return result.passed === false
        && (result.topology || []).length >= sentenceCount + explicitClauseBoundaries
        && records.every((record) => spansAreBounded(record, record.subjectSet)
          && (!record.directObject || spansAreBounded(record, record.directObject))
          && (!record.lightObject || spansAreBounded(record, record.lightObject))
          && !/[;:]/.test(record.evidenceSpan?.text || '')
          && !(record.qualifies && record.lightObject?.binding === 'PRONOUN_ANTECEDENT'));
    }
    default: return hasRecordValue(property);
  }
}

function frozenCaseFailures(item, evaluator) {
  let result;
  try {
    result = evaluator(item.text);
  } catch (error) {
    return [`evaluator-threw:${error?.name || 'Error'}`];
  }
  const failures = [];
  if ((result.passed ? 'PASS' : 'FAIL') !== item.expectedDecision) failures.push('decision');
  if (item.expectedPolarity && result.polarity !== item.expectedPolarity) failures.push('polarity');
  for (const property of item.requiredDiagnostics || []) {
    if (!requiredBehaviorHolds(property, item, result)) failures.push(`semantic:${property}`);
  }
  return failures;
}

const baselineEvaluator = require('../lib/photosynthesis-relation-evaluator').evaluatePhotosynthesisRelationsV2;
const baselineFailures = cases.flatMap((item) => {
  const failures = frozenCaseFailures(item, baselineEvaluator);
  return failures.length ? [{ caseId: item.id, failures }] : [];
});
const rows = [];
if (baselineFailures.length === 0) {
  for (const [id, byClass] of Object.entries(thresholds)) {
    const evaluator = mutate(id);
    const failuresByClass = {};
    for (const classId of Object.keys(byClass)) {
      failuresByClass[classId] = cases.filter((item) => item.classIds?.includes(classId)
        && frozenCaseFailures(item, baselineEvaluator).length === 0
        && frozenCaseFailures(item, evaluator).length > 0).length;
    }
    const killed = Object.entries(byClass).every(([classId, minimum]) => failuresByClass[classId] >= minimum);
    rows.push({ id, killed, failuresByClass, minimumFailuresByClass: byClass });
  }
}
const result = {
  schemaVersion: 2,
  oracle: 'explicit-frozen-semantics-baseline-differential-v1',
  cases: cases.length,
  baseline: { passed: cases.length - baselineFailures.length, failed: baselineFailures.length, failures: baselineFailures },
  mutations: rows,
  killed: rows.filter((row) => row.killed).length,
  total: Object.keys(thresholds).length,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.baseline.failed !== 0 || result.killed !== result.total) process.exitCode = 1;

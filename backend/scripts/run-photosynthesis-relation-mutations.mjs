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

function failed(item, evaluator) {
  const result = evaluator(item.text);
  if ((result.passed ? 'PASS' : 'FAIL') !== item.expectedDecision) return true;
  if (item.expectedPolarity && result.polarity !== item.expectedPolarity) return true;
  return (item.requiredDiagnostics || []).some((required) => ![
    ...result.diagnostics,
    ...result.relationRecords.flatMap((record) => [record.grammarShape, record.subjectValidity, record.polarity,
      record.polarityReason, record.controlChain?.type, record.lightObject?.binding, ...record.rejectionReasons]),
  ].filter(Boolean).some((actual) => String(actual).toLowerCase().includes(required.toLowerCase())));
}

const rows = [];
for (const [id, byClass] of Object.entries(thresholds)) {
  const evaluator = mutate(id);
  const failuresByClass = {};
  for (const classId of Object.keys(byClass)) {
    failuresByClass[classId] = cases.filter((item) => item.classIds?.includes(classId) && failed(item, evaluator)).length;
  }
  const killed = Object.entries(byClass).every(([classId, minimum]) => failuresByClass[classId] >= minimum);
  rows.push({ id, killed, failuresByClass, minimumFailuresByClass: byClass });
}
const result = { schemaVersion: 1, cases: cases.length, mutations: rows, killed: rows.filter((row) => row.killed).length, total: rows.length };
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.killed !== result.total) process.exitCode = 1;

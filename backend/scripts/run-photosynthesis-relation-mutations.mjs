// p1-static-compose-v1; evaluator-blob=c7cc47587b6b49020b4814ace57793d9f8bbc0af; runner-blob=a40ced65bfbbad234ea8b68c22049b085dfd6937; recipe-blob=d5a84e74ed8a22eb2fcb8a85303335fa820826a9
import * as __p1Crypto from 'node:crypto';
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function __p1CjsFactory(exports, require, module, __filename, __dirname) {
'use strict';

const PHOTOSYNTHESIS_EVALUATOR_ID = 'photosynthesis-light-relation-v1';

const EXACT_FORM_LEMMAS = new Map([
  ['plants', 'plant'],
  ['captures', 'capture'], ['captured', 'capture'], ['capturing', 'capture'],
  ['absorbs', 'absorb'], ['absorbed', 'absorb'], ['absorbing', 'absorb'],
  ['harnesses', 'harness'], ['harnessed', 'harness'], ['harnessing', 'harness'],
  ['uses', 'use'], ['used', 'use'], ['using', 'use'],
  ['converts', 'convert'], ['converted', 'convert'], ['converting', 'convert'],
  ['transforms', 'transform'], ['transformed', 'transform'], ['transforming', 'transform'],
  ['stores', 'store'], ['stored', 'store'], ['storing', 'store'],
  ['drives', 'drive'], ['driven', 'drive'], ['driving', 'drive'],
  ['powers', 'power'], ['powered', 'power'], ['powering', 'power'],
  ['destroys', 'destroy'], ['destroyed', 'destroy'], ['destroying', 'destroy'],
  ['wastes', 'waste'], ['wasted', 'waste'], ['wasting', 'waste'],
  ['ignores', 'ignore'], ['ignored', 'ignore'], ['ignoring', 'ignore'],
  ['loses', 'lose'], ['lost', 'lose'], ['losing', 'lose'],
  ['blocks', 'block'], ['blocked', 'block'], ['blocking', 'block'],
  ['rejects', 'reject'], ['rejected', 'reject'], ['rejecting', 'reject'],
  ['eliminates', 'eliminate'], ['eliminated', 'eliminate'], ['eliminating', 'eliminate'],
  ['removes', 'remove'], ['removed', 'remove'], ['removing', 'remove'],
  ['prevents', 'prevent'], ['prevented', 'prevent'], ['preventing', 'prevent'],
  ['requires', 'require'], ['required', 'require'], ['requiring', 'require'],
  ['involves', 'involve'], ['involved', 'involve'], ['involving', 'involve'],
  ['plays', 'play'],
  ["doesn't", 'does_not'], ["isn't", 'is_not'], ["can't", 'cannot'],
  ["don't", 'do_not'], ["won't", 'will_not'],
]);

const LETTER_OR_NUMBER_RE = /^[\p{L}\p{N}]$/u;
const INTERNAL_APOSTROPHE_RE = /^['’]$/u;

const NEGATION_LEMMAS = new Set([
  'not', 'never', 'no', 'without', 'cannot', 'can_not', 'does_not',
  'is_not', 'do_not', 'will_not', 'dont', 'doesnt', 'isnt', 'cant',
]);
const ENERGY_ACTIONS = new Set([
  'capture', 'absorb', 'harness', 'use', 'convert', 'transform', 'store',
]);
const LIGHT_NEGATION_ACTIONS = new Set([
  'destroy', 'waste', 'ignore', 'lose', 'block', 'reject', 'eliminate', 'remove', 'prevent',
]);
const CHLOROPHYLL_ACTIONS = new Set([
  'capture', 'absorb', 'harness', 'use', 'convert', 'transform', 'drive', 'power',
  'require', 'involve', 'play',
]);
const SUBSTITUTE_PIGMENTS = new Set(['melanin', 'carotene', 'pigment']);
const SUBJECT_LEMMAS = new Set(['plant', 'algae', 'photosynthesis', 'chlorophyll']);
const UNSUPPORTED_ENTITY_LEMMAS = new Set(['animal', 'animals', 'rock', 'rocks', 'bacterium', 'bacteria']);

function normalizeInput(input) {
  return String(input ?? '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201B\u2032\uFF07]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033\uFF02]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2212\uFE58\uFE63\uFF0D]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function segmentSentences(text) {
  const source = normalizeInput(text);
  const sentences = [];
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (!'.!?'.includes(source[index])) continue;
    let end = index + 1;
    while (end < source.length && '.!?'.includes(source[end])) end += 1;
    const value = source.slice(start, end).trim();
    if (value) sentences.push({ index: sentences.length, text: value });
    start = end;
    index = end - 1;
  }
  const tail = source.slice(start).trim();
  if (tail) sentences.push({ index: sentences.length, text: tail });
  return sentences;
}

function tokenize(text) {
  const source = String(text ?? '');
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    if (/\s/u.test(source[index])) {
      index += 1;
      continue;
    }
    const start = index;
    if (LETTER_OR_NUMBER_RE.test(source[index])) {
      index += 1;
      while (index < source.length && LETTER_OR_NUMBER_RE.test(source[index])) index += 1;
      if (index < source.length && INTERNAL_APOSTROPHE_RE.test(source[index])
        && index + 1 < source.length && LETTER_OR_NUMBER_RE.test(source[index + 1])) {
        index += 1;
        while (index < source.length && LETTER_OR_NUMBER_RE.test(source[index])) index += 1;
      }
    } else {
      index += 1;
    }
    const form = source.slice(start, index);
    tokens.push({
      index: tokens.length,
      form,
      lemma: normalizeExactFormLemma(form),
      start,
      end: index,
    });
  }
  return tokens;
}

function normalizeExactFormLemma(form) {
  const exactForm = String(form ?? '').toLowerCase();
  return EXACT_FORM_LEMMAS.get(exactForm) || exactForm;
}

function segmentClauses(sentence) {
  const text = typeof sentence === 'string' ? sentence : sentence.text;
  const tokens = tokenize(text);
  const clauses = [];
  let startOffset = 0;
  const addClause = (endOffset) => {
    const clauseText = text.slice(startOffset, endOffset).trim();
    if (clauseText) clauses.push({ index: clauses.length, text: clauseText });
    startOffset = endOffset;
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    const isStrongBoundary = token.form === ';';
    const isDiscourseBoundary = token.form === ','
      && next && new Set(['but', 'although', 'however']).has(next.lemma);
    if (isStrongBoundary || isDiscourseBoundary) addClause(token.end);
  }
  addClause(text.length);
  return clauses;
}

function findLemma(tokens, lemma, from = 0) {
  for (let index = from; index < tokens.length; index += 1) {
    if (tokens[index].lemma === lemma) return index;
  }
  return -1;
}

function findAllLemmas(tokens, lemmas) {
  const found = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (lemmas.has(tokens[index].lemma)) found.push(index);
  }
  return found;
}

function hasSequence(tokens, sequence, from = 0) {
  for (let index = from; index <= tokens.length - sequence.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (tokens[index + offset].lemma !== sequence[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return index;
  }
  return -1;
}

function bindSubject(tokens, predicateIndex, continuationContext = {}) {
  let supportedSubject = null;
  let unsupportedSubject = null;
  for (let index = predicateIndex - 1; index >= 0; index -= 1) {
    const lemma = tokens[index].lemma;
    if (lemma === 'it' || (lemma === 'this' && tokens[index + 1]?.lemma === 'process')) {
      return { value: 'continuation', sourceIndex: index, reference: lemma };
    }
    if (!supportedSubject && SUBJECT_LEMMAS.has(lemma)) supportedSubject = { value: lemma, sourceIndex: index };
    if (!unsupportedSubject && UNSUPPORTED_ENTITY_LEMMAS.has(lemma)) {
      unsupportedSubject = { value: lemma, sourceIndex: index };
    }
  }
  if (unsupportedSubject && supportedSubject
    && supportedSubject.value === 'chlorophyll'
    && unsupportedSubject.sourceIndex < supportedSubject.sourceIndex) {
    return unsupportedSubject;
  }
  if (supportedSubject) return supportedSubject;
  if (unsupportedSubject) return unsupportedSubject;
  if (continuationContext.subject) {
    return { value: 'continuation', sourceIndex: -1, reference: 'inherited' };
  }
  return { value: null, sourceIndex: -1 };
}

function bindLightEnergyObject(tokens, predicateIndex = 0) {
  const candidates = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const lemma = tokens[index].lemma;
    if (lemma === 'light' && tokens[index + 1]?.lemma === 'energy') {
      candidates.push({ start: index, end: index + 2, value: 'light-energy' });
    } else if (lemma === 'sunlight') {
      candidates.push({ start: index, end: index + 1, value: 'light-energy' });
    } else if (lemma === 'solar' && ['energy', 'light'].includes(tokens[index + 1]?.lemma)) {
      candidates.push({ start: index, end: index + 2, value: 'light-energy' });
    } else if (lemma === 'light') {
      candidates.push({ start: index, end: index + 1, value: 'light-energy' });
    }
  }
  if (!candidates.length) return null;
  const after = candidates.find((candidate) => candidate.start >= predicateIndex);
  return after || candidates[candidates.length - 1];
}

function resolveRelationLocalPolarity(tokens, startIndex, endIndex) {
  for (let index = Math.max(0, startIndex); index <= Math.min(tokens.length - 1, endIndex); index += 1) {
    if (NEGATION_LEMMAS.has(tokens[index].lemma)) return 'negative';
  }
  return 'positive';
}

function relationRecord({
  relationType,
  subject,
  predicate,
  object,
  secondaryObject = null,
  polarity,
  context,
  sentenceIndex,
  clauseIndex,
  sourceText,
  subjectReference = null,
}) {
  return {
    relationType,
    subject,
    predicate,
    object,
    secondaryObject,
    polarity,
    context,
    sentenceIndex,
    clauseIndex,
    sourceText,
    subjectReference,
  };
}

function extractCandidateRelations(clause, context = {}) {
  const text = typeof clause === 'string' ? clause : clause.text;
  const tokens = tokenize(text);
  const sentenceIndex = clause.sentenceIndex ?? context.sentenceIndex ?? 0;
  const clauseIndex = clause.clauseIndex ?? context.clauseIndex ?? 0;
  const relationRecords = [];
  const energyObjects = [];
  const energyActions = findAllLemmas(tokens, ENERGY_ACTIONS);
  for (const actionIndex of energyActions) {
    const object = bindLightEnergyObject(tokens, actionIndex);
    if (!object) continue;
    const binding = bindSubject(tokens, actionIndex, context);
    const relationStart = Math.max(0, Math.min(actionIndex, binding.sourceIndex >= 0 ? binding.sourceIndex : actionIndex - 4));
    const polarity = resolveRelationLocalPolarity(tokens, relationStart, object.end - 1);
    const recordContext = findLemma(tokens, 'photosynthesis') >= 0
      ? 'photosynthesis'
      : (binding.value === 'continuation' && context.context) || null;
    const record = relationRecord({
      relationType: 'light-energy-transformation',
      subject: binding.value,
      predicate: tokens[actionIndex].lemma,
      object: object.value,
      polarity,
      context: recordContext,
      sentenceIndex,
      clauseIndex,
      sourceText: text,
      subjectReference: binding.reference || null,
    });
    relationRecords.push(record);
    energyObjects.push({ actionIndex, object, binding, polarity, recordContext });
  }

  const chlorophyllIndices = findAllLemmas(tokens, new Set(['chlorophyll']));
  for (const { actionIndex, object, binding, polarity, recordContext } of energyObjects) {
    const hasChlorophyll = chlorophyllIndices.some((index) => index >= Math.max(0, actionIndex - 8)
      && index <= object.end + 8);
    if (!hasChlorophyll) continue;
    relationRecords.push(relationRecord({
      relationType: 'chlorophyll-light-energy-binding',
      subject: binding.value === 'plant' || binding.value === 'photosynthesis' ? binding.value : 'chlorophyll',
      predicate: tokens[actionIndex].lemma,
      object: 'chlorophyll',
      secondaryObject: object.value,
      polarity,
      context: recordContext || (findLemma(tokens, 'photosynthesis') >= 0 ? 'photosynthesis' : null),
      sentenceIndex,
      clauseIndex,
      sourceText: text,
      subjectReference: binding.reference || null,
    }));
  }

  const processActions = findAllLemmas(tokens, new Set(['drive', 'power', 'require', 'involve', 'use']));
  for (const actionIndex of processActions) {
    const chlorophyllIndex = findLemma(tokens, 'chlorophyll', actionIndex + 1);
    if (chlorophyllIndex < 0) continue;
    const binding = bindSubject(tokens, actionIndex, context);
    const relationStart = Math.max(0, actionIndex - 4);
    relationRecords.push(relationRecord({
      relationType: 'photosynthesis-chlorophyll-process-binding',
      subject: binding.value,
      predicate: tokens[actionIndex].lemma,
      object: 'chlorophyll',
      polarity: resolveRelationLocalPolarity(tokens, relationStart, chlorophyllIndex),
      context: findLemma(tokens, 'photosynthesis') >= 0 ? 'photosynthesis' : (binding.value === 'continuation' ? context.context : null),
      sentenceIndex,
      clauseIndex,
      sourceText: text,
      subjectReference: binding.reference || null,
    }));
  }

  const chlorophyllAction = new Set([...CHLOROPHYLL_ACTIONS].filter((action) => action !== 'play'));
  for (const actionIndex of findAllLemmas(tokens, chlorophyllAction)) {
    if (processActions.includes(actionIndex)) continue;
    const chlorophyllBefore = chlorophyllIndices.some((index) => index < actionIndex && actionIndex - index <= 8);
    if (!chlorophyllBefore) continue;
    const binding = bindSubject(tokens, actionIndex, context);
    const localObject = bindLightEnergyObject(tokens, actionIndex);
    if (localObject) continue;
    if (findLemma(tokens, 'photosynthesis') < 0 && !context.context) continue;
    relationRecords.push(relationRecord({
      relationType: 'photosynthesis-chlorophyll-process-binding',
      subject: binding.value,
      predicate: tokens[actionIndex].lemma,
      object: 'chlorophyll',
      polarity: resolveRelationLocalPolarity(tokens, Math.max(0, actionIndex - 5), actionIndex),
      context: findLemma(tokens, 'photosynthesis') >= 0 ? 'photosynthesis' : context.context,
      sentenceIndex,
      clauseIndex,
      sourceText: text,
      subjectReference: binding.reference || null,
    }));
  }

  for (const actionIndex of findAllLemmas(tokens, LIGHT_NEGATION_ACTIONS)) {
    const object = bindLightEnergyObject(tokens, actionIndex);
    if (!object) continue;
    const binding = bindSubject(tokens, actionIndex, context);
    relationRecords.push(relationRecord({
      relationType: 'light-energy-transformation',
      subject: binding.value,
      predicate: tokens[actionIndex].lemma,
      object: object.value,
      polarity: 'negative',
      context: findLemma(tokens, 'photosynthesis') >= 0 ? 'photosynthesis' : (binding.value === 'continuation' ? context.context : null),
      sentenceIndex,
      clauseIndex,
      sourceText: text,
      subjectReference: binding.reference || null,
    }));
  }

  const pigmentIndices = findAllLemmas(tokens, SUBSTITUTE_PIGMENTS);
  for (const pigmentIndex of pigmentIndices) {
    const object = bindLightEnergyObject(tokens, pigmentIndex);
    const hasAction = energyActions.some((actionIndex) => actionIndex >= pigmentIndex - 3 && actionIndex <= (object?.end || tokens.length));
    const hasChlorophyll = chlorophyllIndices.length > 0;
    if (!object || !hasAction || !hasChlorophyll) continue;
    relationRecords.push(relationRecord({
      relationType: 'invalid-pigment-substitution',
      subject: findLemma(tokens, 'plant') >= 0 ? 'plant' : 'photosynthesis',
      predicate: 'substitute',
      object: tokens[pigmentIndex].lemma,
      secondaryObject: 'chlorophyll',
      polarity: 'negative',
      context: findLemma(tokens, 'photosynthesis') >= 0 ? 'photosynthesis' : context.context,
      sentenceIndex,
      clauseIndex,
      sourceText: text,
    }));
  }

  if (chlorophyllIndices.length > 0
    && (findLemma(tokens, 'photosynthesis') >= 0 || context.context === 'photosynthesis')) {
    const invalidRole = hasSequence(tokens, ['play', 'no', 'role']) >= 0
      || hasSequence(tokens, ['is', 'unrelated']) >= 0
      || hasSequence(tokens, ['not', 'related']) >= 0
      || hasSequence(tokens, ['not', 'involved']) >= 0;
    if (invalidRole) {
      relationRecords.push(relationRecord({
        relationType: 'invalid-chlorophyll-claim',
        subject: 'chlorophyll',
        predicate: 'role',
        object: 'photosynthesis',
        polarity: 'negative',
        context: 'photosynthesis',
        sentenceIndex,
        clauseIndex,
        sourceText: text,
      }));
    }
  }

  return relationRecords;
}

function resolveContinuations(relationRecords, sentenceContexts = []) {
  const resolved = [];
  let latestPhotosynthesisSubject = null;
  let latestPhotosynthesisContext = null;
  for (const record of relationRecords) {
    const next = { ...record };
    if (next.subject === 'continuation') {
      if (latestPhotosynthesisSubject) next.subject = latestPhotosynthesisSubject;
      if (latestPhotosynthesisContext) next.context = latestPhotosynthesisContext;
    }
    if (next.subject !== 'continuation' && !next.context && next.subjectReference && latestPhotosynthesisContext) {
      next.context = latestPhotosynthesisContext;
    }
    if (next.context === 'photosynthesis' && next.subject !== 'continuation') {
      latestPhotosynthesisSubject = 'photosynthesis';
      latestPhotosynthesisContext = 'photosynthesis';
    }
    if (!next.context && sentenceContexts[next.sentenceIndex]?.context === 'photosynthesis'
      && next.subject === 'continuation' && latestPhotosynthesisSubject) {
      next.context = 'photosynthesis';
    }
    resolved.push(next);
  }
  return resolved;
}

function detectInvalidChlorophyllClaims(relationRecords) {
  return relationRecords.filter((record) => (
    record.relationType === 'invalid-pigment-substitution'
    || record.relationType === 'invalid-chlorophyll-claim'
    || (record.object === 'chlorophyll' && record.polarity === 'negative')
    || (record.relationType === 'chlorophyll-light-energy-binding' && record.polarity === 'negative')
  ));
}

function evaluatePhotosynthesisRelations(input) {
  const normalized = normalizeInput(input);
  const sentences = segmentSentences(normalized);
  const relationRecords = [];
  const sentenceContexts = [];
  for (const sentence of sentences) {
    const sentenceHasContext = findLemma(tokenize(sentence.text), 'photosynthesis') >= 0;
    sentenceContexts[sentence.index] = { context: sentenceHasContext ? 'photosynthesis' : null };
    const clauses = segmentClauses(sentence.text);
    let clauseContext = sentenceHasContext ? 'photosynthesis' : null;
    for (const clause of clauses) {
      const records = extractCandidateRelations({
        ...clause,
        sentenceIndex: sentence.index,
        clauseIndex: clause.index,
      }, { context: clauseContext, sentenceIndex: sentence.index, clauseIndex: clause.index });
      relationRecords.push(...records);
      if (records.some((record) => record.context === 'photosynthesis' || record.subject === 'photosynthesis')) {
        clauseContext = 'photosynthesis';
      }
    }
  }
  const resolvedRecords = resolveContinuations(relationRecords, sentenceContexts);
  const invalidChlorophyllClaims = detectInvalidChlorophyllClaims(resolvedRecords);
  const positiveLightEnergy = resolvedRecords.some((record) => (
    record.relationType === 'light-energy-transformation'
    && record.object === 'light-energy'
    && record.polarity === 'positive'
    && record.context === 'photosynthesis'
    && SUBJECT_LEMMAS.has(record.subject)
  ));
  const positiveChlorophyllBinding = resolvedRecords.some((record) => (
    (record.relationType === 'chlorophyll-light-energy-binding'
      || record.relationType === 'photosynthesis-chlorophyll-process-binding')
    && record.object === 'chlorophyll'
    && record.polarity === 'positive'
    && record.context === 'photosynthesis'
  ));
  const passed = positiveLightEnergy && positiveChlorophyllBinding && invalidChlorophyllClaims.length === 0;
  return {
    evaluatorId: PHOTOSYNTHESIS_EVALUATOR_ID,
    passed,
    positiveLightEnergy,
    positiveChlorophyllBinding,
    invalidChlorophyllClaims,
    relationRecords: resolvedRecords,
    normalized,
    sentences,
  };
}

// V2 has its own bounded parse path; V1 remains frozen above.
const V2_ID = 'photosynthesis-light-relation-v2';
const V2_VERBS = new Map(Object.entries({capture:'capture',captures:'capture',captured:'capture',capturing:'capture',absorb:'absorb',absorbs:'absorb',absorbed:'absorb',absorbing:'absorb',harness:'harness',harnesses:'harness',harnessed:'harness',harnessing:'harness',use:'use',uses:'use',used:'use',using:'use',convert:'convert',converts:'convert',converted:'convert',converting:'convert',transform:'transform',transforms:'transform',transformed:'transform',transforming:'transform',store:'store',stores:'store',stored:'store',storing:'store',destroy:'destroy',destroys:'destroy',destroyed:'destroy',waste:'waste',wastes:'waste',ignore:'ignore',ignores:'ignore',lose:'lose',loses:'lose',block:'block',blocks:'block',reject:'reject',rejects:'reject',eliminate:'eliminate',eliminates:'eliminate',remove:'remove',removes:'remove',prevent:'prevent',prevents:'prevent'}));
const V2_LIGHT_RELATION_LEMMAS = new Set(['capture','absorb','harness','use','convert','transform','store']);
const V2_SUBJECTS = new Set(['photosynthesis','plant','plants','green plant','green plants','alga','algae','some bacteria','photosynthetic bacterium','photosynthetic bacteria','chlorophyll']);
const V2_PIGMENT_TERMS = new Set(['chlorophyll','melanin','carotene','xanthophyll']);
const V2_MODALS = new Map([['can',['UNCERTAIN','CAPABILITY_NOT_ACTUALITY']],['cannot',['NEGATED','ASSERTED_INABILITY']],['can\'t',['NEGATED','ASSERTED_INABILITY']],['may',['UNCERTAIN','POSSIBILITY']],['might',['UNCERTAIN','WEAK_POSSIBILITY']],['could',['UNCERTAIN','POSSIBILITY_OR_CAPABILITY']],['couldn\'t',['NEGATED','ASSERTED_INABILITY']],['must',['AFFIRMED','ASSERTED_NECESSITY']],['should',['UNRESOLVED','NORMATIVE_OR_EXPECTED']],['would',['UNRESOLVED','CONDITIONAL_OR_COUNTERFACTUAL']]]);
const normalizePunctuationRunV2 = (run) => {
  return [...new Set(run)].join('');
};
const normalizeInputV2 = (x) => normalizeInput(x).toLowerCase().replace(/’/g, "'").replace(/[.!?;:]+/g, normalizePunctuationRunV2);
const segmentSentencesV2 = (x) => segmentSentences(normalizeInputV2(x));
const segmentClausesV2 = (x) => {
  const text = String(typeof x === 'string' ? x : x.text);
  return text.split(/[;:]+/).flatMap((part, partIndex) => {
    const match = part.match(/,\s+and\s+/i);
    const pieces = match && !part.slice(0, match.index).includes(',')
      && startsIndependentSupportedClauseV2(part.slice(match.index + match[0].length))
      ? part.split(/,\s+and\s+/i)
      : [part];
    return pieces.flatMap((piece, pieceIndex) => {
      const boundaryBefore = pieceIndex > 0 ? 'comma-and' : partIndex > 0 ? 'hard' : 'start';
      const explicitBut = piece.match(/\s+but\s+/i);
      if (!explicitBut) return [{ text: piece, boundaryBefore }];
      const after = piece.slice(explicitBut.index + explicitBut[0].length).trim();
      return startsIndependentSupportedClauseV2(after)
        ? [
          { text: piece.slice(0, explicitBut.index), boundaryBefore },
          { text: after, boundaryBefore: 'but' },
        ]
        : [{ text: piece, boundaryBefore }];
    });
  }).map(({ text, boundaryBefore }, index) => ({ index, text: text.trim(), boundaryBefore }))
    .filter((clause) => clause.text);
};
const tokenizeV2 = (x) => tokenize(x).map(t=>({...t,form:t.form.toLowerCase()}));
const normalizeExactFormLemmaV2 = normalizeExactFormLemma;
function extractSubjectSet(ts,end){
  const stop=new Set(['does','do','did','is','are','was','were','has','have','had','can','cannot',"can't",'may','might','could',"couldn't",'must','should','would','not','never','to','during','while','although','because','whereas','if','unless','when','fail','fails','failed','appear','appears','seem','seems',';','.','!','?']);
  const howStart=ts[0]?.lemma==='photosynthesis'&&ts[1]?.form==='is'&&ts[2]?.form==='how'?3:0;
  const adjunctStart=ts[0]?.lemma==='during'&&ts[1]?.lemma==='photosynthesis'&&ts[2]?.form===','?3:0;
  const subjectStart=Math.max(howStart,adjunctStart);
  let boundary=end;
  for(let i=subjectStart;i<end;i++)if(stop.has(ts[i].form)||V2_VERBS.has(ts[i].form)){boundary=i;break;}
  const byWhich=ts.findIndex((t,i)=>i+1<end&&t.lemma==='by'&&ts[i+1].lemma==='which');
  if(byWhich>=0)boundary=end;
  const raw=ts.slice(byWhich>=0?byWhich+2:subjectStart,boundary).map(t=>t.form).join(' ').replace(/^(?:the|a|an)\s+/,''),
    members=raw.split(/\s+(?:and|or|rather\s+than)\s+|,\s*/).filter(Boolean).map(surface=>surface.replace(/^and\s+/,'').trim()).map(surface=>({surface,lemma:normalizeExactFormLemmaV2(surface),role:V2_PIGMENT_TERMS.has(surface)?'PIGMENT_AGENT':V2_SUBJECTS.has(surface)?'BIOLOGICAL_AGENT':'UNSUPPORTED',valid:V2_SUBJECTS.has(surface)})),
    coordinator=/\sor\s/.test(raw)?'OR':/\sand\s/.test(raw)?'AND':/\srather\s+than\s/.test(raw)?'RATHER_THAN':members.length>1?'COMMA':'SINGLE',
    n=members.filter(x=>x.valid).length;
  members.forEach((member)=>{member.coordinator=coordinator;});
  return{members,coordinator,validity:n===members.length&&n?'ALL_VALID':n?'MIXED_INVALID':'ALL_INVALID',start:subjectStart,end:boundary};
}
function validateSubjectAgreement(subject,verb){return verb.form==='PAST'||agreesInSimplePresentV2(subject,verb);}
const isSupportedSubjectCoordinationV2 = (x) => x.members.length === 1 || x.coordinator === 'AND';
const validateSubjectSet = (x) => x.validity === 'ALL_VALID' && isSupportedSubjectCoordinationV2(x);
function validateFinitePredicate(ts,i){const surface=ts[i]?.form||'',lemma=V2_VERBS.get(surface);if(!lemma)return null;if(lemma==='use'&&ts[i+1]?.form==='chlorophyll'&&ts[i+2]?.form==='to'&&V2_VERBS.has(ts[i+3]?.form))return null;const form=surface===lemma?'BASE':/ed$/.test(surface)?'PAST':/ing$/.test(surface)?'PRESENT_PARTICIPLE':'PRESENT_3SG';return{surface,lemma,form,finite:form!=='BASE'};}
const V2_PLURAL_SUBJECT_LEMMAS=new Set(['plants','green plants','algae','some bacteria','photosynthetic bacteria']);
const V2_SINGULAR_SUBJECT_LEMMAS=new Set(['photosynthesis','plant','green plant','alga','photosynthetic bacterium','chlorophyll','animal','rock','bacterium']);
const V2_FINITE_AUXILIARIES=new Set(['do','does','did','is','are','was','were','has','have','had']);
function isPluralSubjectV2(subject){const member=subject.members[0];if(subject.members.length>1)return true;if(V2_PLURAL_SUBJECT_LEMMAS.has(member?.surface)||V2_PLURAL_SUBJECT_LEMMAS.has(member?.lemma))return true;if(V2_SINGULAR_SUBJECT_LEMMAS.has(member?.surface)||V2_SINGULAR_SUBJECT_LEMMAS.has(member?.lemma))return false;return /s$/.test(member?.surface||'');}
function agreesInSimplePresentV2(subject,verb){if(verb.form==='PAST')return true;return verb.form===(isPluralSubjectV2(subject)?'BASE':'PRESENT_3SG');}
function validateAuxiliaryPrefixV2(chain,verb,subject){
  const agrees=subject.validity!=='ALL_VALID'||validateSubjectAgreement(subject,verb);
  if(!chain.length)return agrees;
  const first=chain[0],rest=chain.slice(1),oneOf=(...allowed)=>allowed.some((forms)=>forms.length===chain.length&&forms.every((form,index)=>chain[index]===form));
  if(V2_MODALS.has(first))return (oneOf([first],[first,'not'])&&verb.form==='BASE');
  if(['do','does','did'].includes(first)){
    const agreement=first==='did'||first==='do'&&isPluralSubjectV2(subject)||first==='does'&&!isPluralSubjectV2(subject);
    return agreement&&verb.form==='BASE'&&oneOf([first],[first,'not'],[first,'never']);
  }
  if(['is','are','was','were'].includes(first)){
    const agreement=first==='is'&&!isPluralSubjectV2(subject)||first==='are'&&isPluralSubjectV2(subject)||first==='was'&&!isPluralSubjectV2(subject)||first==='were'&&isPluralSubjectV2(subject);
    return agreement&&verb.form==='PRESENT_PARTICIPLE'&&oneOf([first],[first,'not'],[first,'never']);
  }
  if(['has','have','had'].includes(first)){
    const agreement=first==='had'||first==='has'&&!isPluralSubjectV2(subject)||first==='have'&&isPluralSubjectV2(subject),
      perfect=oneOf([first],[first,'not']),progressive=oneOf([first,'been'],[first,'not','been']);
    return agreement&&(perfect&&verb.form==='PAST'||progressive&&verb.form==='PRESENT_PARTICIPLE');
  }
  return oneOf(['not'],['never'])&&agrees;
}
function validateActiveFinitePredicateV2(ts,index,verb,subject,auxiliary,control){
  const prefix=ts.slice(subject.end,index).map((token)=>token.form),controlPrefix=control?.surface.split(' ')||[];
  if(control){
    const remainder=prefix.slice(controlPrefix.length);
    return verb.form==='BASE'&&prefix.slice(0,controlPrefix.length).every((form,i)=>form===controlPrefix[i])
      &&(remainder.length===0
        || /^(?:use|uses|used) chlorophyll to$/.test(remainder.join(' '))
        || (remainder.length===2 && remainder[1]==='and'
          && validateFinitePredicate([{ form: remainder[0] }], 0)?.form === 'BASE'));
  }
  if(prefix.at(-1)==='to'){
    const mediated=prefix.slice(-3),outer=prefix.slice(0,-3);
    if(!/^(?:use|uses|used) chlorophyll to$/.test(mediated.join(' ')))return false;
    if(!outer.length){
      const useSurface=mediated[0],useForm=useSurface==='use'?'BASE':useSurface==='used'?'PAST':'PRESENT_3SG';
      return verb.form==='BASE'&&validateSubjectAgreement(subject,{form:useForm});
    }
    return verb.form==='BASE'&&validateAuxiliaryPrefixV2(outer,{form:'BASE'},subject);
  }
  const sharedIndex=prefix.findIndex((form,offset)=>V2_VERBS.has(form)&&prefix[offset+1]==='and'&&offset+2===prefix.length);
  if(sharedIndex>=0){
    const firstIndex=subject.end+sharedIndex,firstVerb=validateFinitePredicate(ts,firstIndex),firstAuxiliary=parseAuxiliaryChain(ts,firstIndex),firstControl=resolveControlChain(ts,firstIndex);
    return Boolean(firstVerb&&validateActiveFinitePredicateV2(ts,firstIndex,firstVerb,subject,firstAuxiliary,firstControl)
      &&(firstControl?verb.form==='BASE':validateAuxiliaryPrefixV2(prefix.slice(0,sharedIndex),verb,subject)));
  }
  return validateAuxiliaryPrefixV2(prefix,verb,subject);
}
function startsIndependentSupportedClauseV2(text) {
  const tokens = tokenizeV2(text);
  for (let index = 1; index < tokens.length; index += 1) {
    const predicate = validateFinitePredicate(tokens, index);
    if (!predicate) continue;
    const subject = extractSubjectSet(tokens, index);
    if (subject.start !== 0 || subject.end <= 0 || subject.validity !== 'ALL_VALID') continue;
    if (validateActiveFinitePredicateV2(
      tokens, index, predicate, subject,
      parseAuxiliaryChain(tokens, index), resolveControlChain(tokens, index),
    )) return true;
  }
  return false;
}
function parseAuxiliaryChain(ts,i,fromIndex=0){const all=ts.slice(fromIndex,i),relative=all.findIndex((t,n)=>t.form==='by'&&all[n+1]?.form==='which'),how=all.findIndex((t,n)=>t.form==='is'&&all[n+1]?.form==='how'),scopeStart=relative>=0?relative+2:how>=0?how+2:0,scope=all.slice(scopeStart),modal=scope.filter(t=>V2_MODALS.has(t.form)).map(t=>t.form),localStart=scope.findIndex(t=>V2_MODALS.has(t.form)||['do','does','did','not','never','has','have','had','is','are','was','were'].includes(t.form)),start=fromIndex+scopeStart+(localStart<0?scope.length:localStart),chain=localStart<0?[]:scope.slice(localStart).map(t=>t.form);return{start,chain,modal:modal.length>1?'STACKED':modal[0]||null,negators:chain.filter(x=>['not','never','cannot',"can't"].includes(x))};}
function describeActiveAuxiliaryChainV2(auxiliary,ts,predicateIndex){
  if(!auxiliary.chain.length)return undefined;
  const first=auxiliary.chain[0],fn=V2_MODALS.has(first)?'MODAL':['has','have','had'].includes(first)?'HAVE':['is','are','was','were'].includes(first)?'BE':['do','does','did'].includes(first)?'DO':'NEGATOR';
  return{start:ts[auxiliary.start]?.start??ts[predicateIndex].start,end:ts[predicateIndex].start,function:fn,lemma:first,surface:auxiliary.chain.join(' '),chain:auxiliary.chain};
}
function resolveModalState(a){if(a.modal==='STACKED')return{polarity:'UNRESOLVED',reason:'STACKED_MODAL_CHAIN'};if(a.modal){const[p,r]=V2_MODALS.get(a.modal),not=a.negators.includes('not');if(not&&a.modal==='may')return{polarity:'UNCERTAIN',reason:'POSSIBLE_NEGATION_OR_WITHHOLDING'};if(not&&a.modal==='might')return{polarity:'UNCERTAIN',reason:'WEAK_POSSIBLE_NEGATION'};if(not&&a.modal==='could')return{polarity:'NEGATED',reason:'ASSERTED_INABILITY'};if(not&&a.modal==='must')return{polarity:'NEGATED',reason:'NECESSARY_NEGATION'};if(not&&a.modal==='should')return{polarity:'UNRESOLVED',reason:'NORMATIVE_NEGATION'};if(not&&a.modal==='would')return{polarity:'UNRESOLVED',reason:'CONDITIONAL_NEGATION'};return{polarity:p,reason:r};}return{polarity:a.negators.length?'NEGATED':'AFFIRMED',reason:a.negators.length?'LOCAL_NEGATION':'DIRECT_ASSERTION'};}
function resolveControlChain(ts,i){const s=ts.slice(0,i).map(t=>t.form).join(' ');for(const [f,type,p] of [['does not fail to','NOT_FAIL_TO','AFFIRMED'],['did not fail to','NOT_FAIL_TO','AFFIRMED'],['never fails to','NEVER_FAIL_TO','AFFIRMED'],['fails to','FAIL_TO','NEGATED'],['failed to','FAIL_TO','NEGATED'],['does not appear to','NOT_APPEAR_TO','UNRESOLVED'],['appears not to','APPEAR_NOT_TO','UNCERTAIN'],['does not seem to','NOT_SEEM_TO','UNRESOLVED'],['seems not to','SEEM_NOT_TO','UNCERTAIN']])if(s.includes(f))return{type,polarity:p,surface:f};return null;}
const composePredicatePolarity = (m,c,a) => c ? {polarity:c.polarity,reason:c.type} : resolveModalState(a);
function detectObjectBarrier(ts,start){const i=ts.findIndex((t,n)=>n>=start&&n<ts.length-1&&([';','.','!','?'].includes(t.form)||['while','although','because','whereas','if','unless','when','since'].includes(t.lemma)));return i<0?null:{type:['.','!','?'].includes(ts[i].form)?'SENTENCE':'CLAUSE',marker:ts[i].lemma,start:ts[i].start,end:ts[i].end};}
function bindDirectObject(ts,i){
  if(ts[i]?.form==='the')i++;
  if(!ts[i])return null;
  let end=i+1,light=['light','sunlight'].includes(ts[i].form);
  if(ts[i].form==='light'&&ts[i+1]?.form==='energy')end=i+2;
  if(ts[i].form==='solar'&&['energy','light'].includes(ts[i+1]?.form)){light=true;end=i+2;}
  if(!light){
    const phraseBoundaries=new Set(['and','or','but','into','during','in','for','near','with','by','as','while','although','because','whereas','if','unless','when','since',',',';',';',':','.','!','?']);
    while(end<ts.length&&!phraseBoundaries.has(ts[end].form)&&!V2_VERBS.has(ts[end].form))end++;
  }
  return{start:ts[i].start,end:ts[end-1].end,tokenEnd:end,surface:ts.slice(i,end).map(t=>t.form).join(' '),normalized:light?'light-energy':'',role:light?'LIGHT_OBJECT':ts[i].form==='chlorophyll'?'CHLOROPHYLL':'NON_LIGHT_OBJECT'};
}
function trimActiveTailForms(tokens) {
  const forms = tokens.map((token) => token.form).filter((form) => form !== ',');
  while (['.', '!', '?'].includes(forms.at(-1))) forms.pop();
  return forms;
}

function isCompleteContrastContinuationV2(forms, subject, antecedentObject) {
  return Boolean(forms.length && !forms.includes('but')
    && parseButContinuationV2(tokenizeV2(forms.join(' ')), subject, antecedentObject));
}

const V2_CONTEXT_ADJUNCT_TAILS = new Set([
  'during photosynthesis', 'in photosynthesis', 'for photosynthesis',
]);

function parseButContinuationV2(tokens, subject, antecedentObject = null) {
  for (let predicateIndex = 0; predicateIndex < tokens.length; predicateIndex += 1) {
    const predicate = validateFinitePredicate(tokens, predicateIndex);
    if (!predicate) continue;
    const inheritedSubject = { ...subject, end: 0 };
    const auxiliary = parseAuxiliaryChain(tokens, predicateIndex);
    const control = resolveControlChain(tokens, predicateIndex);
    if (!validateActiveFinitePredicateV2(tokens, predicateIndex, predicate, inheritedSubject, auxiliary, control)) continue;
    let object = bindDirectObject(tokens, predicateIndex + 1);
    const pronoun = object?.surface === 'it'
      && antecedentObject?.role === 'LIGHT_OBJECT'
      && antecedentObject.normalized === 'light-energy';
    if (pronoun) object = { ...object, normalized: 'light-energy', role: 'LIGHT_OBJECT' };
    if (object?.role !== 'LIGHT_OBJECT' || object.normalized !== 'light-energy') continue;
    const tail = trimActiveTailForms(tokens.slice(object.tokenEnd));
    if (tail.length && !V2_CONTEXT_ADJUNCT_TAILS.has(tail.join(' '))) continue;
    const state = composePredicatePolarity(auxiliary.modal, control, auxiliary);
    return { predicate, predicateIndex, predicateToken: tokens[predicateIndex], auxiliary, control, object, pronoun, state };
  }
  return null;
}

function validateActiveComponentsV2(forms) {
  if (!forms.length) return true;
  let index = 0;
  const consume = (...expected) => expected.every((form, offset) => forms[index + offset] === form)
    ? (index += expected.length, true)
    : false;
  const consumeContextAdjunct = () => consume('during', 'photosynthesis')
    || consume('in', 'photosynthesis')
    || consume('for', 'photosynthesis');
  if (consume('and', 'make', 'food')) return index === forms.length;
  if (consume('into', 'chemical', 'energy')) {
    consume('storing', 'it', 'in', 'glucose', 'molecules');
    consumeContextAdjunct();
  } else if (consume('storing', 'it', 'in', 'glucose', 'molecules')) {
    return index === forms.length;
  } else if (consume('releasing', 'oxygen', 'as', 'a', 'byproduct')) {
    return index === forms.length;
  } else if (consume('driven', 'by', 'chlorophyll', 'in', 'the', 'presence', 'of', 'sunlight')) {
    return index === forms.length;
  } else if (consumeContextAdjunct()) {
    return index === forms.length;
  } else {
    return false;
  }
  return index === forms.length;
}

function validateActiveTailV2(tokens, objectEnd, pronoun, subject, antecedentObject) {
  const tail = tokens.slice(objectEnd);
  const butIndex = tail.findIndex((token) => token.form === 'but');
  const frame = trimActiveTailForms(butIndex >= 0 ? tail.slice(0, butIndex) : tail);
  if (pronoun?.valid && pronoun.grammarValid) {
    const continuation = ['and', pronoun.continuationVerb, 'it'];
    if (frame.slice(0, continuation.length).every((form, index) => form === continuation[index])) {
      frame.splice(0, continuation.length);
    }
  }
  const frameValid = validateActiveComponentsV2(frame);
  if (butIndex < 0) return frameValid;
  const continuation = trimActiveTailForms(tail.slice(butIndex + 1));
  return frameValid && isCompleteContrastContinuationV2(continuation, subject, antecedentObject);
}
function bindLocalPassiveAgent(ts){
  const object=bindDirectObject(ts,0);
  if(object?.role!=='LIGHT_OBJECT')return null;
  const light=ts[0]?.form==='the'?1:0,lightEnd=object.tokenEnd-1;
  let verbIndex=-1;
  for(let index=lightEnd+1;index<ts.length;index++)if(V2_VERBS.has(ts[index].form)&&/ed$/.test(ts[index].form)){verbIndex=index;break;}
  if(verbIndex<0||ts[verbIndex+1]?.form!=='by')return null;
  const by=verbIndex+1;
  const auxiliaryChain=ts.slice(lightEnd+1,verbIndex).map(token=>token.form);
  const hasPassiveAuxiliary=auxiliaryChain.some(form=>V2_MODALS.has(form)||['is','are','was','were','be','been','being','has','have','had'].includes(form));
  if(!hasPassiveAuxiliary)return null;
  const verb=validateFinitePredicate(ts,verbIndex);
  if(!verb)return null;
  const agent=extractSubjectSet(ts.slice(by+1),ts.length-by-1);
  const tail=ts.slice(by+1+agent.end).map((token)=>token.form),terminal=tail.at(-1);
  if(['.','!','?'].includes(terminal))tail.pop();
  if(tail[0]===',')tail.shift();
  if(tail.length&&!['during photosynthesis','in photosynthesis','for photosynthesis'].includes(tail.join(' ')))return null;
  return{light,lightEnd,by,verbIndex,verb,auxiliaryChain,agent,local:true};
}
function resolveCoordinatedPredicates(ts,i,end){const a=ts.findIndex((t,n)=>n>i&&n<end&&t.lemma==='and');if(a<0)return[];const subject=extractSubjectSet(ts,i),first=validateFinitePredicate(ts,i),firstAux=parseAuxiliaryChain(ts,i),firstControl=resolveControlChain(ts,i),secondIndex=a+1,second=validateFinitePredicate(ts,secondIndex),secondAux=parseAuxiliaryChain(ts,secondIndex),secondControl=resolveControlChain(ts,secondIndex),accepted=Boolean(first&&second&&validateActiveFinitePredicateV2(ts,i,first,subject,firstAux,firstControl)&&validateActiveFinitePredicateV2(ts,secondIndex,second,subject,secondAux,secondControl)),indices=[i,secondIndex];if(!accepted)indices.invalid=true;return indices;}
function resolvePronounContinuation(ts,o){const a=ts.findIndex((t,n)=>n>=o.tokenEnd&&t.lemma==='and');if(a<0||a!==o.tokenEnd)return null;const firstIndex=ts.findIndex((t,n)=>n<o.tokenEnd&&validateFinitePredicate(ts,n)),first=validateFinitePredicate(ts,firstIndex),subject=extractSubjectSet(ts,firstIndex),firstAux=parseAuxiliaryChain(ts,firstIndex),firstControl=resolveControlChain(ts,firstIndex),secondIndex=a+1,second=validateFinitePredicate(ts,secondIndex),secondSubject={...subject,end:a+1},secondAux=parseAuxiliaryChain(ts,secondIndex,a+1),secondControl=resolveControlChain(ts.slice(a+1),secondIndex-a-1);if(!first||!second||!V2_LIGHT_RELATION_LEMMAS.has(first.lemma)||!V2_LIGHT_RELATION_LEMMAS.has(second.lemma)||ts[secondIndex+1]?.lemma!=='it')return null;const grammarValid=!firstAux.chain.length&&!firstControl&&!secondAux.chain.length&&!secondControl&&validateActiveFinitePredicateV2(ts,firstIndex,first,subject,firstAux,firstControl)&&validateActiveFinitePredicateV2(ts,secondIndex,second,secondSubject,secondAux,secondControl);return{antecedent:o.normalized,valid:o.normalized==='light-energy',grammarValid,continuationTailOffset:secondIndex-o.tokenEnd,continuationVerb:second.surface,second,secondIndex,secondSubject,secondAuxiliary:secondAux,secondControl};}
const V2_DESTRUCTIVE_RELATION_LEMMAS = new Set(['destroy', 'waste', 'ignore', 'lose', 'block', 'reject', 'eliminate', 'remove', 'prevent']);
function isSupportedPassiveAuxiliaryChain(chain) {
  const negators = chain.filter((form) => ['not', 'never'].includes(form));
  if (negators.length > 1) return false;
  const core = chain.filter((form) => !['not', 'never'].includes(form));
  return (core.length === 1 && ['is', 'was'].includes(core[0]))
    || (core.length === 2 && ['is', 'was'].includes(core[0]) && core[1] === 'being')
    || (core.length === 2 && ['has', 'had'].includes(core[0]) && core[1] === 'been')
    || (core.length === 2 && V2_MODALS.has(core[0]) && core[1] === 'be');
}
const normalizeV2RecordModal = (modal) => modal === 'STACKED' ? null : modal === "can't" ? 'cannot' : modal === "couldn't" ? 'could' : modal;

function buildRelationRecordV2(x){
  const passive = x.voice === 'PASSIVE';
  const chain = x.auxiliaryChain?.chain || [];
  const modals = chain.filter((form) => V2_MODALS.has(form));
  const auxiliary = {
    modal: modals.length > 1 ? 'STACKED' : modals[0] || null,
    negators: chain.filter((form) => ['not', 'never', 'cannot', "can't"].includes(form)),
  };
  const state = passive ? composePredicatePolarity(auxiliary.modal, null, auxiliary) : null;
  const auxiliaryValid = !passive || isSupportedPassiveAuxiliaryChain(chain);
  const destructive = passive && V2_DESTRUCTIVE_RELATION_LEMMAS.has(x.verbLemma);
  const wrongPigment = x.subjectSet?.role === 'PIGMENT_AGENT' && x.subjectSet?.lemma !== 'chlorophyll';
  const passiveContextRequired = passive && x.subjectSet?.role === 'PIGMENT_AGENT'
    && x.subjectSet?.lemma === 'chlorophyll';
  const polarity = passive ? state.polarity : x.polarity;
  const unsupportedOr = !passive && x.subjectValidity === 'ALL_VALID' && x.subjectSet?.coordinator === 'OR';
  const agentValid = passive && x.subjectValidity === 'ALL_VALID'
    && ['SINGLE', 'AND'].includes(x.subjectSet?.coordinator);
  const subjectSet = passive
    ? { ...x.subjectSet, valid: agentValid, validityReason: agentValid ? 'SUPPORTED' : 'UNSUPPORTED' }
    : x.subjectSet;
  const rejectionReasons = [
    ...(x.rejectionReasons || []).filter((reason) => !(agentValid && reason === 'UNSUPPORTED_CO_SUBJECT')),
    ...(passive && !agentValid && !(x.rejectionReasons || []).includes('UNSUPPORTED_CO_SUBJECT') ? ['UNSUPPORTED_CO_SUBJECT'] : []),
    ...(passive && !auxiliaryValid ? ['PASSIVE_AUXILIARY_GRAMMAR_NOT_ACCEPTED'] : []),
    ...(destructive ? ['DESTRUCTIVE_RELATION'] : []),
    ...(wrongPigment && polarity === 'AFFIRMED' ? ['WRONG_PIGMENT_RELATION'] : []),
  ];
  return {
    schemaVersion: 2,
    evaluatorId: V2_ID,
    relationType: destructive ? 'DESTRUCTIVE_RELATION' : wrongPigment ? 'WRONG_PIGMENT_RELATION' : x.relationType || 'CORE_LIGHT_RELATION',
    grammarShape: x.grammarShape,
    subjectSet,
    subjectValidity: x.subjectValidity,
    voice: x.voice || 'ACTIVE',
    verbLemma: x.verbLemma,
    verbSurface: x.verbSurface,
    verbForm: x.verbForm,
    predicateStart: x.predicateStart,
    predicateEnd: x.predicateEnd,
    ...(chain.length ? { auxiliaryChain: x.auxiliaryChain } : {}),
    modal: normalizeV2RecordModal(passive ? auxiliary.modal : x.modal || null),
    controlChain: x.controlChain || null,
    polarity: passive ? state.polarity : unsupportedOr ? 'UNRESOLVED' : x.polarity,
    polarityReason: passive ? state.reason : unsupportedOr ? 'UNSUPPORTED_SUBJECT_COORDINATION' : x.polarityReason,
    directObject: x.directObject,
    lightObject: x.lightObject || null,
    instrumentSet: x.instrumentSet || null,
    objectBarriers: x.objectBarriers || null,
    objectBarrierEncountered: Boolean(x.objectBarriers),
    processContext: x.processContext || null,
    qualifies: Boolean(passive
      ? agentValid && (!passiveContextRequired || x.processContext)
        && x.lightObject?.normalized === 'light-energy'
        && auxiliaryValid && state.polarity === 'AFFIRMED' && !destructive
      : x.qualifies),
    rejectionReasons,
    evidenceSpan: x.evidenceSpan,
  };
}
function detectContradictions(records){
  const propositionKey = (record) => JSON.stringify([
    record.subjectSet?.lemma || '', record.subjectSet?.role || '', record.verbLemma || '',
    record.directObject?.role || '', record.directObject?.normalized || '',
  ]);
  const pairs = [];
  records.forEach((left, leftIndex) => {
    records.forEach((right, rightIndex) => {
      if (rightIndex <= leftIndex) return;
      const pair = [{ record: left, index: leftIndex }, { record: right, index: rightIndex }];
      const positive = pair.find(({ record }) => record.qualifies && record.polarity === 'AFFIRMED');
      const negative = pair.find(({ record }) => record.polarity === 'NEGATED');
      if (!positive || !negative || propositionKey(positive.record) !== propositionKey(negative.record)) return;
      pairs.push({
        pairIds: [`relation-${positive.index}`, `relation-${negative.index}`],
        propositionKey: propositionKey(positive.record),
      });
    });
  });
  return pairs;
}
function hasUnrelatedNegationV2(sentences,records){if(!records.some(r=>r.qualifies&&r.polarity==='AFFIRMED'))return false;return sentences.some(sentence=>segmentClausesV2(sentence).some(clause=>{const ts=tokenizeV2(clause.text);if(!ts.some(t=>['not','never','cannot',"can't"].includes(t.form)))return false;return !records.some(r=>r.evidenceSpan?.text===clause.text)&&records.some(r=>r.qualifies&&r.evidenceSpan?.text!==clause.text);}));}
function detectInvalidChlorophyllClaimsV2(records){
  return records.filter((record) =>
    (record.relationType === 'WRONG_PIGMENT_RELATION' && record.polarity === 'AFFIRMED')
    || (record.subjectSet?.role === 'PIGMENT_AGENT' && record.subjectSet?.lemma === 'chlorophyll'
      && record.polarity === 'NEGATED' && record.polarityReason === 'LOCAL_NEGATION'));
}
const V2_FINGERPRINT_KNOWN_UNSUPPORTED_SUBJECTS = new Map([
  ['animal', 'ANIMAL'], ['animals', 'ANIMAL'], ['bacteria', 'BACTERIA'],
  ['bacterium', 'BACTERIA'], ['rock', 'ROCK'], ['rocks', 'ROCK'],
]);
const fingerprintSubjectMembers = (members) => (members || []).map(([lemma, role]) => [
  role === 'UNSUPPORTED'
    ? V2_FINGERPRINT_KNOWN_UNSUPPORTED_SUBJECTS.get(lemma) || 'UNSUPPORTED_SUBJECT' : lemma,
  role,
]);
function resolveButNegatedRelation(ts,verb,subject,object,sentenceText,primaryRecord){
  const butIndex=ts.findIndex((token,index)=>index>=object.tokenEnd&&token.form==='but');
  if(butIndex<0)return null;
  const continuationTokens=ts.slice(butIndex+1),continuation=parseButContinuationV2(continuationTokens,subject,object);
  if(!continuation)return null;
  const{predicate:secondVerb,predicateIndex,predicateToken,auxiliary,control,object:secondObject,pronoun,state}=continuation;
  const qualified=validateSubjectSet(subject)&&!V2_DESTRUCTIVE_RELATION_LEMMAS.has(secondVerb.lemma)
    &&state.polarity==='AFFIRMED';
  return buildRelationRecordV2({
    ...primaryRecord,
    verbLemma:secondVerb.lemma,
    verbSurface:secondVerb.surface,
    verbForm:secondVerb.form,
    predicateStart:predicateToken.start,
    predicateEnd:predicateToken.end,
    auxiliaryChain:describeActiveAuxiliaryChainV2(auxiliary,continuationTokens,predicateIndex),
    modal:auxiliary.modal,
    controlChain:control?{type:control.type,surface:control.surface,effect:control.polarity==='AFFIRMED'?'AFFIRM':control.polarity==='NEGATED'?'NEGATE':control.polarity,start:ts[butIndex+1].start,end:predicateToken.start}:null,
    polarity:state.polarity,
    polarityReason:state.reason,
    directObject:{start:secondObject.start,end:secondObject.end,surface:secondObject.surface,normalized:secondObject.normalized,role:secondObject.role},
    lightObject:{start:secondObject.start,end:secondObject.end,surface:secondObject.surface,normalized:'light-energy',binding:pronoun?'PRONOUN_ANTECEDENT':'DIRECT_OBJECT'},
    relationType:V2_DESTRUCTIVE_RELATION_LEMMAS.has(secondVerb.lemma)?'DESTRUCTIVE_RELATION':'CORE_LIGHT_RELATION',
    qualifies:qualified,
    rejectionReasons:[...(!validateSubjectSet(subject)?['INVALID_SUBJECT']:[]),...(V2_DESTRUCTIVE_RELATION_LEMMAS.has(secondVerb.lemma)?['DESTRUCTIVE_RELATION']:[])],
    evidenceSpan:{start:ts[0].start,end:ts.at(-1).end,text:sentenceText},
  });
}
function resolvePronounContinuationRelation(ts,object,sentenceText,primaryRecord,continuation){
  if(!continuation?.valid||!continuation.grammarValid)return null;
  const{second,secondIndex,secondSubject,secondAuxiliary:auxiliary,secondControl:control}=continuation;
  const state=composePredicatePolarity(auxiliary.modal,control,auxiliary),pronoun=ts[secondIndex+1];
  const validSubject=validateSubjectSet(secondSubject),directObject={start:pronoun.start,end:pronoun.end,surface:pronoun.form,normalized:'light-energy',role:'LIGHT_OBJECT'};
  const activeAuxiliary=describeActiveAuxiliaryChainV2(auxiliary,ts,secondIndex);
  return buildRelationRecordV2({
    ...primaryRecord,
    grammarShape:'PRONOUN_CONTINUATION',
    verbLemma:second.lemma,
    verbSurface:second.surface,
    verbForm:second.form,
    predicateStart:ts[secondIndex].start,
    predicateEnd:ts[secondIndex].end,
    auxiliaryChain:activeAuxiliary,
    modal:auxiliary.modal,
    controlChain:control?{type:control.type,surface:control.surface,effect:control.polarity==='AFFIRMED'?'AFFIRM':control.polarity==='NEGATED'?'NEGATE':control.polarity,start:ts[secondIndex-1]?.start||0,end:ts[secondIndex].start}:null,
    polarity:state.polarity,
    polarityReason:state.reason,
    directObject,
    lightObject:{start:pronoun.start,end:pronoun.end,surface:pronoun.form,normalized:'light-energy',binding:'PRONOUN_ANTECEDENT'},
    objectBarriers:null,
    relationType:V2_DESTRUCTIVE_RELATION_LEMMAS.has(second.lemma)?'DESTRUCTIVE_RELATION':'CORE_LIGHT_RELATION',
    qualifies:validSubject&&state.polarity==='AFFIRMED',
    rejectionReasons:validSubject?[]:['INVALID_SUBJECT'],
    evidenceSpan:{start:ts[0].start,end:ts.at(-1).end,text:sentenceText},
  });
}
function punctuationBoundaryTopologyV2(text){
  return(text.match(/[.!?;:]+(?=\s+\S)/g)||[]).map((run)=>[...run].map((mark)=>`${';:'.includes(mark)?'CLAUSE':'SENTENCE'}:${mark}`));
}
function resolveLocalChlorophyllSupport(records,sentences){
  for(const sentence of sentences)for(const clause of segmentClausesV2(sentence)){
    const tokens=tokenizeV2(clause.text),useIndex=tokens.findIndex((token,index)=>['use','uses','used'].includes(token.form)&&tokens[index+1]?.form==='chlorophyll'&&tokens[index+2]?.form==='to'&&V2_VERBS.has(tokens[index+3]?.form));
    if(useIndex<0)continue;
    const embeddedIndex=useIndex+3,embedded=records.find((record)=>record.evidenceSpan?.text===clause.text
      &&record.predicateStart===tokens[embeddedIndex].start
      &&record.verbLemma===V2_VERBS.get(tokens[embeddedIndex].form)
      &&record.lightObject?.normalized==='light-energy');
    if(!embedded)continue;
    const instrument={start:tokens[useIndex+1].start,end:tokens[useIndex+1].end,surface:'chlorophyll',normalized:'chlorophyll',role:'CHLOROPHYLL'};
    return{
      embedded,
      record:{...embedded,grammarShape:'ACTIVE_INFINITIVAL_MEDIATED',relationType:'CHLOROPHYLL_SUPPORT',verbLemma:'use',verbSurface:tokens[useIndex].form,verbForm:/s$/.test(tokens[useIndex].form)?'PRESENT_3SG':'PAST',predicateStart:tokens[useIndex].start,predicateEnd:tokens[useIndex].end,directObject:instrument,instrumentSet:{start:instrument.start,end:instrument.end,lemma:'chlorophyll',surface:'chlorophyll'},qualifies:embedded.qualifies},
    };
  }
  return null;
}
function parseMinimalRelationGrammar(input) {
  const normalized = normalizeInputV2(input);
  const sentences = segmentSentencesV2(normalized);
  const relationRecords = [];
  const diagnostics = [];
  const topology = [];
  const orderedSubjects = [];
  const coordinationTopology = [];
  let malformed = false;

  for (const [sentenceIndex, sentence] of sentences.entries()) {
    let pronounAntecedentRecordStart = relationRecords.length;
    for (const clause of segmentClausesV2(sentence)) {
      const clauseRecordStart = relationRecords.length;
      if (clause.boundaryBefore !== 'but') pronounAntecedentRecordStart = clauseRecordStart;
      const tokens = tokenizeV2(clause.text);
      if (!tokens.length) continue;
      topology.push([sentenceIndex, clause.index]);

      const passive = bindLocalPassiveAgent(tokens);
      if (passive) {
        const valid = passive.agent.validity === 'ALL_VALID'
          && passive.agent.members.every((member) => member.lemma === 'chlorophyll');
        const object = {
          start: tokens[passive.light].start,
          end: tokens[passive.lightEnd].end,
          surface: tokens.slice(passive.light, passive.lightEnd + 1).map((token) => token.form).join(' '),
          normalized: 'light-energy',
          role: 'LIGHT_OBJECT',
        };
        const context = tokens.some((token, index) => token.lemma === 'photosynthesis'
          || token.lemma === 'during' && tokens[index + 1]?.lemma === 'photosynthesis');
        const contextRequired = passive.agent.members.every((member) => member.lemma === 'chlorophyll');
        const auxiliaryFunction = passive.auxiliaryChain.some((form) => V2_MODALS.has(form))
          ? 'MODAL'
          : passive.auxiliaryChain.some((form) => ['has', 'have', 'had'].includes(form)) ? 'HAVE' : 'BE';
        const subjectMembers = passive.agent.members.map((member) => [member.lemma, member.role]);
        orderedSubjects.push(subjectMembers);
        coordinationTopology.push({
          type: passive.agent.coordinator,
          cardinality: subjectMembers.length,
          orderedMembers: subjectMembers,
        });
        relationRecords.push(buildRelationRecordV2({
          grammarShape: 'PASSIVE_LOCAL_AGENT',
          voice: 'PASSIVE',
          subjectSet: {
            ...passive.agent.members[0],
            start: tokens[passive.by + 1]?.start,
            end: tokens.at(-1).end,
            valid,
            validityReason: valid ? 'SUPPORTED' : 'UNSUPPORTED',
          },
          subjectValidity: passive.agent.validity,
          verbLemma: passive.verb.lemma,
          verbSurface: passive.verb.surface,
          verbForm: 'PAST_PARTICIPLE',
          predicateStart: tokens[passive.verbIndex].start,
          predicateEnd: tokens[passive.verbIndex].end,
          auxiliaryChain: {
            start: tokens[passive.lightEnd + 1]?.start ?? tokens[passive.verbIndex].start,
            end: tokens[passive.verbIndex].start,
            function: auxiliaryFunction,
            lemma: passive.auxiliaryChain.at(-1) || '',
            surface: passive.auxiliaryChain.join(' '),
            chain: passive.auxiliaryChain,
          },
          polarity: 'AFFIRMED',
          polarityReason: 'DIRECT_ASSERTION',
          directObject: object,
          lightObject: { ...object, binding: 'PASSIVE_SUBJECT' },
          processContext: context ? 'LOCAL_ADJUNCT' : null,
          qualifies: valid && (!contextRequired || context),
          rejectionReasons: [
            ...(!valid ? ['UNSUPPORTED_CO_SUBJECT'] : []),
            ...(!contextRequired || context ? [] : ['LOCAL_PHOTOSYNTHESIS_CONTEXT_MISSING']),
          ],
          evidenceSpan: { start: tokens[0].start, end: tokens.at(-1).end, text: clause.text },
        }));
        continue;
      }

      let predicateIndex = -1;
      let predicate;
      let subjectSet;
      for (let index = 1; index < tokens.length; index += 1) {
        const candidatePredicate = validateFinitePredicate(tokens, index);
        const candidateSubjects = extractSubjectSet(tokens, index);
        const auxiliary = parseAuxiliaryChain(tokens, index);
        const control = resolveControlChain(tokens, index);
        const recognizedSubjectSurface = candidateSubjects.members.some((member) => [
          'plants', 'algae', 'green plants', 'some bacteria', 'photosynthetic bacteria',
          'animals', 'bacteria', 'rocks',
        ].includes(member.surface));
        if (candidatePredicate && (candidatePredicate.finite
          || candidateSubjects.members.length > 1
          || recognizedSubjectSurface
          || auxiliary.modal
          || auxiliary.negators.length
          || control
          || ['do', 'does', 'did'].includes(auxiliary.chain[0])
          || tokens[index - 1]?.form === 'to')) {
          predicateIndex = index;
          predicate = candidatePredicate;
          subjectSet = candidateSubjects;
          break;
        }
      }

      const auxiliary = predicateIndex < 0 ? null : parseAuxiliaryChain(tokens, predicateIndex);
      const control = predicateIndex < 0 ? null : resolveControlChain(tokens, predicateIndex);
      const recognizedSubjectSurface = subjectSet?.members.some((member) => [
        'plants', 'algae', 'green plants', 'some bacteria', 'photosynthetic bacteria',
        'animals', 'bacteria', 'rocks',
      ].includes(member.surface));
      if (predicateIndex < 0 || (!predicate.finite
        && !auxiliary.modal
        && !auxiliary.negators.length
        && !control
        && !['do', 'does', 'did'].includes(auxiliary.chain[0])
        && tokens[predicateIndex - 1]?.form !== 'to'
        && !(subjectSet.members.length > 1 || recognizedSubjectSurface))) {
        malformed = true;
        diagnostics.push('GRAMMAR_SHAPE_NOT_ACCEPTED');
        continue;
      }

      if (!subjectSet.members.length) {
        malformed = true;
        diagnostics.push('GRAMMAR_SHAPE_NOT_ACCEPTED');
        continue;
      }

      if (!validateActiveFinitePredicateV2(tokens, predicateIndex, predicate, subjectSet, auxiliary, control)) {
        malformed = true;
        diagnostics.push('GRAMMAR_SHAPE_NOT_ACCEPTED');
        continue;
      }

      const state = composePredicatePolarity(auxiliary.modal, control, auxiliary);
      let objectIndex = predicateIndex + 1;
      if (tokens[objectIndex]?.lemma === 'and' && V2_VERBS.has(tokens[objectIndex + 1]?.form)) objectIndex += 2;
      if (tokens[objectIndex]?.form === 'the') objectIndex += 1;
      if (tokens[objectIndex]?.form === 'chlorophyll' && tokens[objectIndex + 1]?.form === 'to') objectIndex += 2;
      let object = bindDirectObject(tokens, objectIndex);
      if (!object) {
        malformed = true;
        diagnostics.push('GRAMMAR_SHAPE_NOT_ACCEPTED');
        continue;
      }

      const subjectIdentity = subjectSet.members[0];
      const pronounRecordStart = clause.boundaryBefore === 'but'
        ? pronounAntecedentRecordStart
        : clauseRecordStart;
      const priorSubjectRecords = relationRecords.slice(pronounRecordStart).filter((record) =>
        record.subjectSet?.lemma === subjectIdentity.lemma
        && record.subjectSet?.role === subjectIdentity.role
        && record.directObject);
      const priorObjectIdentities = new Set(priorSubjectRecords.map((record) => JSON.stringify([
        record.directObject.role, record.directObject.normalized,
      ])));
      const bindsLocalPronoun = object.surface === 'it'
        && priorSubjectRecords.length > 0
        && priorObjectIdentities.size === 1
        && priorObjectIdentities.has(JSON.stringify(['LIGHT_OBJECT', 'light-energy']));
      if (bindsLocalPronoun) {
        object = { ...object, normalized: 'light-energy', role: 'LIGHT_OBJECT' };
      }

      const barrier = detectObjectBarrier(tokens, predicateIndex + 1);
      const coordinatedPredicates = resolveCoordinatedPredicates(tokens, predicateIndex, objectIndex);
      const pronoun = resolvePronounContinuation(tokens, object);
      if (coordinatedPredicates.invalid) {
        malformed = true;
        diagnostics.push('GRAMMAR_SHAPE_NOT_ACCEPTED');
      }

      const valid = validateSubjectSet(subjectSet);
      const light = object.normalized === 'light-energy';
      const allowed = (!pronoun?.valid || pronoun.grammarValid)
        && validateActiveTailV2(tokens, object.tokenEnd, pronoun, subjectSet, object);
      if (!allowed) {
        malformed = true;
        diagnostics.push('GRAMMAR_SHAPE_NOT_ACCEPTED');
      }

      let polarity = state.polarity;
      let polarityReason = state.reason;
      if ((!pronoun?.valid && pronoun) || (!light && tokens.slice(object.tokenEnd)
        .some((token) => ['light', 'sunlight'].includes(token.form)))) {
        polarity = 'UNRESOLVED';
        polarityReason = 'OBJECT_BINDING_UNRESOLVED';
      }
      if (barrier) {
        polarity = 'UNRESOLVED';
        polarityReason = barrier.type;
      }
      if (['not', 'never'].includes(tokens[predicateIndex - 1]?.lemma) && !control && !auxiliary.modal) {
        polarity = 'NEGATED';
        polarityReason = 'LOCAL_NEGATION';
      }

      const destructive = V2_DESTRUCTIVE_RELATION_LEMMAS.has(predicate.lemma);
      if (destructive) diagnostics.push('DESTRUCTIVE_RELATION');
      const malformedSubject = subjectSet.validity === 'ALL_INVALID'
        && subjectSet.members[0]?.surface?.includes(' ');
      if (malformedSubject) {
        malformed = true;
        diagnostics.push('GRAMMAR_SHAPE_NOT_ACCEPTED');
      }

      const subject = subjectSet.members[0];
      orderedSubjects.push(subjectSet.members.map((member) => [member.lemma, member.role]));
      coordinationTopology.push({
        type: subjectSet.coordinator,
        cardinality: subjectSet.members.length,
        orderedMembers: subjectSet.members.map((member) => [member.lemma, member.role]),
      });
      const subjectRecord = {
        ...subject,
        start: tokens[0].start,
        end: tokens[predicateIndex - 1].end,
        valid: subject.valid,
        validityReason: subject.valid ? 'SUPPORTED' : 'UNSUPPORTED',
      };
      const shape = coordinatedPredicates.length > 1
        ? 'ACTIVE_COORDINATED_SHARED_OBJECT'
        : pronoun ? 'PRONOUN_CONTINUATION'
          : object.role === 'CHLOROPHYLL' ? 'ACTIVE_INFINITIVAL_MEDIATED' : 'ACTIVE_SIMPLE';
      const rejectionReasons = [
        ...(!valid ? [
          subjectSet.validity === 'MIXED_INVALID'
            || subjectSet.validity === 'ALL_VALID' && !isSupportedSubjectCoordinationV2(subjectSet)
            ? 'UNSUPPORTED_CO_SUBJECT'
            : 'INVALID_SUBJECT',
        ] : []),
        ...(!light ? ['LIGHT_OBJECT_MISSING'] : []),
        ...(!allowed ? ['GRAMMAR_SHAPE_NOT_ACCEPTED'] : []),
        ...(coordinatedPredicates.invalid ? ['GRAMMAR_SHAPE_NOT_ACCEPTED'] : []),
        ...(barrier ? [barrier.type] : []),
        ...(destructive ? ['DESTRUCTIVE_RELATION'] : []),
      ];

      const primaryRecord=buildRelationRecordV2({
        grammarShape: shape,
        subjectSet: subjectRecord,
        subjectValidity: subjectSet.validity,
        verbLemma: predicate.lemma,
        verbSurface: predicate.surface,
        verbForm: predicate.form,
        predicateStart: tokens[predicateIndex].start,
        predicateEnd: tokens[predicateIndex].end,
        auxiliaryChain: describeActiveAuxiliaryChainV2(auxiliary, tokens, predicateIndex),
        modal: auxiliary.modal,
        controlChain: control ? {
          type: control.type,
          surface: control.surface,
          effect: control.polarity === 'AFFIRMED' ? 'AFFIRM'
            : control.polarity === 'NEGATED' ? 'NEGATE' : control.polarity,
          start: Math.max(0, tokens[predicateIndex - 1]?.start || 0),
          end: tokens[predicateIndex].start,
        } : null,
        polarity,
        polarityReason,
        directObject: {
          start: object.start,
          end: object.end,
          surface: object.surface,
          normalized: object.normalized || object.surface,
          role: object.role,
        },
        lightObject: light ? {
          start: object.start,
          end: object.end,
          surface: object.surface,
          normalized: 'light-energy',
          binding: coordinatedPredicates.length > 1 ? 'SHARED_OBJECT'
            : pronoun || bindsLocalPronoun ? 'PRONOUN_ANTECEDENT' : 'DIRECT_OBJECT',
        } : null,
        objectBarriers: barrier,
        processContext: 'EXPLICIT_SUBJECT',
        relationType: destructive ? 'DESTRUCTIVE_RELATION' : 'CORE_LIGHT_RELATION',
        qualifies: valid && light && allowed && !destructive && !barrier
          && !coordinatedPredicates.invalid && polarity === 'AFFIRMED',
        rejectionReasons,
        evidenceSpan: { start: tokens[0].start, end: tokens.at(-1).end, text: clause.text },
      });
      relationRecords.push(primaryRecord);

      const pronounContinuation=resolvePronounContinuationRelation(tokens,object,clause.text,primaryRecord,pronoun);
      if(allowed&&pronounContinuation)relationRecords.push(pronounContinuation);

      const coordinatedNegative = allowed && resolveButNegatedRelation(
        tokens, predicate, subjectSet, object, clause.text, primaryRecord,
      );
      if (coordinatedNegative) relationRecords.push(coordinatedNegative);

      diagnostics.push(shape, subjectSet.validity, polarity, polarityReason);
      if (subjectSet.members.length > 1) diagnostics.push('orderedSubjectSet');
      if (!valid) diagnostics.push('UNSUPPORTED_CO_SUBJECT');
      if (!light) diagnostics.push('LIGHT_OBJECT_MISSING');
      if (barrier) diagnostics.push(barrier.type);

      if (shape === 'ACTIVE_COORDINATED_SHARED_OBJECT') {
        const secondPredicateIndex = coordinatedPredicates[1];
        const secondPredicate = validateFinitePredicate(tokens, secondPredicateIndex);
        if (secondPredicate) {
          const secondDestructive = V2_DESTRUCTIVE_RELATION_LEMMAS.has(secondPredicate.lemma);
          const secondRejections = primaryRecord.rejectionReasons.filter((reason) => reason !== 'DESTRUCTIVE_RELATION');
          if (secondDestructive) secondRejections.push('DESTRUCTIVE_RELATION');
          relationRecords.push(buildRelationRecordV2({
            ...primaryRecord,
            verbLemma: secondPredicate.lemma,
            verbSurface: secondPredicate.surface,
            verbForm: secondPredicate.form,
            predicateStart: tokens[secondPredicateIndex].start,
            predicateEnd: tokens[secondPredicateIndex].end,
            relationType: secondDestructive ? 'DESTRUCTIVE_RELATION' : 'CORE_LIGHT_RELATION',
            qualifies: valid && light && allowed && !barrier && !coordinatedPredicates.invalid
              && !secondDestructive && polarity === 'AFFIRMED',
            rejectionReasons: secondRejections,
            lightObject: {
              start: object.start,
              end: object.end,
              surface: object.surface,
              normalized: 'light-energy',
              binding: 'SHARED_OBJECT',
            },
          }));
        }
      }
    }
  }

  const chlorophyllSupport = resolveLocalChlorophyllSupport(relationRecords, sentences);
  if (chlorophyllSupport) relationRecords.push(chlorophyllSupport.record);
  if (sentences.length > 1) diagnostics.push('SENTENCE');
  if (topology.length > sentences.length) diagnostics.push('CLAUSE');
  if (relationRecords.some((record) => record.objectBarriers?.type === 'SENTENCE')) diagnostics.push('SENTENCE');
  if (relationRecords.some((record) => record.objectBarriers?.type === 'CLAUSE')) {
    diagnostics.push('CLAUSE', 'FINITE_PREDICATE');
  }
  if (relationRecords.some((record) => record.directObject?.role === 'NON_LIGHT_OBJECT')) diagnostics.push('DIRECT_OBJECT');

  const contradictions = detectContradictions(relationRecords);
  const invalidChlorophyllClaims = detectInvalidChlorophyllClaimsV2(relationRecords);
  const assertedWrongPigment = invalidChlorophyllClaims.some((record) =>
    record.relationType === 'WRONG_PIGMENT_RELATION' && record.polarity === 'AFFIRMED');
  const affirmedDestructive = relationRecords.some((record) =>
    record.relationType === 'DESTRUCTIVE_RELATION' && record.polarity === 'AFFIRMED');
  if (invalidChlorophyllClaims.length) diagnostics.push('WRONG_PIGMENT_RELATION');
  if (affirmedDestructive) diagnostics.push('DESTRUCTIVE_RELATION');
  if (contradictions.length) diagnostics.push('CONTRADICTION_PRESENT');

  return {
    evaluatorId: V2_ID,
    normalized,
    sentences,
    relationRecords,
    passed: relationRecords.some((record) => record.qualifies)
      && !contradictions.length && !invalidChlorophyllClaims.length && !affirmedDestructive,
    polarity: contradictions.length ? 'CONTRADICTED'
      : assertedWrongPigment ? 'AFFIRMED'
        : relationRecords[0]?.subjectValidity === 'ALL_INVALID'
          && relationRecords[0]?.subjectSet?.surface?.includes(' ') ? 'UNRESOLVED'
          : relationRecords[0]?.subjectValidity === 'ALL_INVALID' ? 'ALL_INVALID'
            : malformed && !relationRecords.some((record) => record.qualifies) ? 'UNRESOLVED'
              : relationRecords[0]?.subjectValidity === 'MIXED_INVALID' ? 'MIXED_INVALID'
                : relationRecords[0]?.polarity || 'UNRESOLVED',
    diagnostics: [...new Set(diagnostics)],
    punctuationTopology: punctuationBoundaryTopologyV2(normalized),
    topology,
    hasMalformed: malformed,
    malformedShape: malformed
      ? tokenizeV2(normalized).map((token) => V2_SUBJECTS.has(token.form) ? 'SUBJECT'
        : V2_VERBS.has(token.form) ? 'VERB'
          : ['light', 'energy', 'sunlight'].includes(token.form) ? 'LIGHT' : 'OTHER').join(' ')
      : null,
    subjectSet: orderedSubjects,
    coordinationTopology,
    barriers: relationRecords.map((record) => record.objectBarriers?.type).filter(Boolean),
    contradictions,
    positiveLightEnergy: relationRecords.some((record) => record.qualifies),
    positiveChlorophyllBinding: relationRecords.some((record) =>
      record.qualifies && record.relationType === 'CHLOROPHYLL_SUPPORT'),
    invalidChlorophyllClaims,
  };
}
function expandCoordinatedSubjectRecords(records){
  return records.flatMap((original)=>{
    const chain=original.auxiliaryChain?.chain||[];
    const auxiliaryFunction=chain.some((form)=>V2_MODALS.has(form))?'MODAL':chain.some((form)=>['has','have','had'].includes(form))?'HAVE':original.auxiliaryChain?.function;
    const record=auxiliaryFunction?{...original,auxiliaryChain:{...original.auxiliaryChain,function:auxiliaryFunction}}:original;
    const text=record.evidenceSpan?.text;
    if(!text||!record.subjectSet?.coordinator||record.subjectSet.coordinator==='SINGLE')return[record];
    const tokens=tokenizeV2(text),passive=record.voice==='PASSIVE';
    const byIndex=passive?tokens.findIndex((token)=>token.form==='by'):-1;
    const predicateIndex=tokens.findIndex((token)=>token.start===record.predicateStart);
    const startIndex=passive?byIndex+1:0,endIndex=passive?tokens.length:predicateIndex;
    if(startIndex<0||endIndex<0)return[record];
    const members=passive
      ?extractSubjectSet(tokens.slice(startIndex),tokens.length-startIndex).members
      :extractSubjectSet(tokens,predicateIndex).members;
    if(members.length<2)return[record];
    let cursor=startIndex;
    const expanded=members.map((member)=>{
      const words=member.surface.split(/\s+/);let tokenIndex=-1;
      for(let index=cursor;index+words.length<=endIndex;index++){
        if(words.every((word,offset)=>tokens[index+offset]?.form===word)){tokenIndex=index;break;}
      }
      if(tokenIndex<0)return null;
      cursor=tokenIndex+words.length;
      const wrongPigment=member.role==='PIGMENT_AGENT'&&member.lemma!=='chlorophyll';
      return{
        ...record,
        relationType:wrongPigment?'WRONG_PIGMENT_RELATION':record.relationType,
        rejectionReasons:wrongPigment?[...new Set([...record.rejectionReasons,'WRONG_PIGMENT_RELATION'])]:record.rejectionReasons,
        subjectSet:{...record.subjectSet,surface:member.surface,lemma:member.lemma,role:member.role,start:tokens[tokenIndex].start,end:tokens[tokenIndex+words.length-1].end,valid:member.valid,validityReason:member.valid?'SUPPORTED':'UNSUPPORTED'},
      };
    });
    return expanded.every(Boolean)?expanded:[record];
  });
}
const evaluatePhotosynthesisRelationsV2 = (input)=>{
  const result=parseMinimalRelationGrammar(input),relationRecords=expandCoordinatedSubjectRecords(result.relationRecords);
  const contradictions=detectContradictions(relationRecords),invalidChlorophyllClaims=detectInvalidChlorophyllClaimsV2(relationRecords);
  const affirmedWrongPigment=invalidChlorophyllClaims.some((record)=>record.relationType==='WRONG_PIGMENT_RELATION'&&record.polarity==='AFFIRMED');
  const affirmedDestructive=relationRecords.some((record)=>record.relationType==='DESTRUCTIVE_RELATION'&&record.polarity==='AFFIRMED');
  return{
    ...result,
    relationRecords,
    contradictions,
    invalidChlorophyllClaims,
    diagnostics:[...new Set([...result.diagnostics,...(invalidChlorophyllClaims.length?['WRONG_PIGMENT_RELATION']:[]),...(contradictions.length?['CONTRADICTION_PRESENT']:[])])],
    passed:relationRecords.some((record)=>record.qualifies)&&!contradictions.length&&!invalidChlorophyllClaims.length&&!affirmedDestructive,
    polarity:contradictions.length?'CONTRADICTED':affirmedWrongPigment?'AFFIRMED':result.polarity,
    barriers:relationRecords.map((record)=>record.objectBarriers?.type).filter(Boolean),
    positiveLightEnergy:relationRecords.some((record)=>record.qualifies),
    positiveChlorophyllBinding:relationRecords.some((record)=>record.qualifies&&record.relationType==='CHLOROPHYLL_SUPPORT'),
  };
};
function semanticCaseFingerprint(input,decision=null){
  const r=typeof input==='string'?evaluatePhotosynthesisRelationsV2(input):input,records=r.relationRecords||[],text=typeof input==='string'?normalizeInputV2(input):r.normalized||'',coordination=r.coordinationTopology||[];
  const normalizeDirectObject = (object) => object?.role === 'NON_LIGHT_OBJECT' ? null : object?.normalized;
  const f={
    grammarShape:{records:records.map(x=>x.grammarShape||'UNRESOLVED'),malformedRoleOrder:r.malformedShape||null,malformedLexicalStructure:r.hasMalformed?tokenizeV2(text).map(t=>{const role=V2_SUBJECTS.has(t.form)?'SUBJECT':V2_VERBS.has(t.form)?'VERB':['light','energy','sunlight'].includes(t.form)?'LIGHT':'OTHER';const structural=role!=='OTHER'||V2_MODALS.has(t.form)||['and','or','but','not','never','do','does','did','is','are','was','were','has','have','had','to','fail','fails','failed','appear','appears','seem','seems','during','while','although','because','whereas','if','unless','when','since','in','for','into','near','with','by','as',',',';',';',':','.','!','?'].includes(t.form);return structural?{role,lemma:t.lemma,form:t.form}:{role};}):null},
    orderedSubjectLemmasAndRoleClasses:(r.subjectSet||[]).map(fingerprintSubjectMembers),coordinationTypeAndCardinality:coordination.map((group)=>({...group,orderedMembers:fingerprintSubjectMembers(group.orderedMembers)})),voice:records.map(x=>x.voice||'ACTIVE'),verbLemmaAndMorphology:records.map(x=>[x.verbLemma,x.verbForm]),
    directObjectRoleAndNormalizedLightForm:records.map(x=>x.directObject?[x.directObject.role,normalizeDirectObject(x.directObject)]:null),objectBindingOrigin:records.map(x=>x.lightObject?.binding||null),
    auxiliaryChain:records.map(x=>x.auxiliaryChain?.chain||[]),modal:records.map(x=>x.modal||null),controlChain:records.map(x=>x.controlChain?[x.controlChain.type,x.controlChain.surface]:null),
    polarityStructure:records.map(x=>[x.polarity||'UNRESOLVED',x.polarityReason||'']),orderedBarrierTypes:r.barriers||[],clauseSentenceTopology:r.topology||[],
    contextBindingType:records.map(x=>x.processContext||null),pronounAntecedentTopology:records.map((x,i)=>({recordIndex:i,shape:x.grammarShape,binding:x.lightObject?.binding||null,antecedentObject:x.lightObject?.binding==='PRONOUN_ANTECEDENT'?normalizeDirectObject(x.directObject):null})),
    pigmentIdentity:[...new Set((text.match(/\b(?:chlorophyll|melanin|carotene|xanthophyll)\b/gi)||[]).map(x=>x.toLowerCase()))],invalidClaimType:records.map(x=>x.relationType||null),expectedDecision:decision||(r.passed?'PASS':'FAIL'),
  };
  return require('node:crypto').createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(f).sort(([a],[b])=>a.localeCompare(b))))).digest('hex');
}
const PHOTOSYNTHESIS_SEMANTIC_EVALUATOR_REGISTRY = Object.freeze({
  [PHOTOSYNTHESIS_EVALUATOR_ID]: evaluatePhotosynthesisRelations,
  [V2_ID]: evaluatePhotosynthesisRelationsV2,
});

module.exports = {
  PHOTOSYNTHESIS_EVALUATOR_ID,
  PHOTOSYNTHESIS_SEMANTIC_EVALUATOR_REGISTRY,
  normalizeInput,
  segmentSentences,
  segmentClauses,
  tokenize,
  normalizeExactFormLemma,
  bindSubject,
  bindLightEnergyObject,
  resolveRelationLocalPolarity,
  extractCandidateRelations,
  resolveContinuations,
  detectInvalidChlorophyllClaims,
  evaluatePhotosynthesisRelations,
  V2_ID,
  normalizeInputV2, segmentSentencesV2, segmentClausesV2, tokenizeV2, normalizeExactFormLemmaV2,
  parseMinimalRelationGrammar: evaluatePhotosynthesisRelationsV2, parseAuxiliaryChain, validateFinitePredicate, extractSubjectSet,
  validateSubjectAgreement, validateSubjectSet, bindDirectObject, detectObjectBarrier,
  resolveCoordinatedPredicates, bindLocalPassiveAgent, resolveModalState, resolveControlChain,
  composePredicatePolarity, resolvePronounContinuation, buildRelationRecordV2, semanticCaseFingerprint,
  detectContradictions, evaluatePhotosynthesisRelationsV2,
  detectInvalidChlorophyllClaimsV2,
};

}

export function createDerivedEvaluator() {
  const module = { exports: {} };
  const exports = module.exports;
  const require = (specifier) => {
    if (specifier !== 'node:crypto') throw new Error('unreviewed evaluator dependency: ' + specifier);
    return __p1Crypto;
  };
  __p1CjsFactory.call(module.exports, exports, require, module, '/work/input/candidate.mjs', '/work/input');
  return module.exports;
}

function __p1RunIdValid(runId) {
  return typeof runId === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(runId);
}

function __p1ScratchWritable(runId) {
  const scratchPath = '/tmp/p1-candidate-' + runId + '.tmp';
  let descriptor;
  let created = false;
  let writable = false;
  try {
    descriptor = openSync(scratchPath, 'wx', 0o600);
    created = true;
    writable = writeSync(descriptor, 'p1') === 2;
  } catch {}
  try { if (descriptor !== undefined) closeSync(descriptor); } catch { writable = false; }
  try { if (created) unlinkSync(scratchPath); } catch { writable = false; }
  return writable;
}

async function __p1RunQualification() {
  const runId = process.argv[2];
  if (process.argv.length !== 3 || !__p1RunIdValid(runId)) {
    process.stderr.write('invalid CandidateQualification runId\n');
    process.exitCode = 2;
    return;
  }
  const observations = {
    snapshotReadable: false,
    scratchWritable: false,
    networkDenied: false,
    sensitiveEnvAbsent: false,
    processCreationDenied: false,
    processErrorCode: 'NOT_ATTEMPTED',
    resultSerialized: false,
  };
  let semanticPass = false;
  try {
    const evaluator = createDerivedEvaluator().evaluatePhotosynthesisRelationsV2;
    if (typeof evaluator !== 'function') throw new Error('selected V2 evaluator export is not callable');
    const positive = evaluator('Photosynthesis converts light energy into chemical energy.');
    const negative = evaluator('Photosynthesis does not capture light energy.');
    semanticPass = positive.passed === true
      && positive.polarity === 'AFFIRMED'
      && positive.relationRecords.some((record) => record.qualifies && record.polarity === 'AFFIRMED')
      && negative.passed === false
      && negative.polarity === 'NEGATED'
      && negative.relationRecords.some((record) => record.polarity === 'NEGATED');
  } catch (error) {
    process.stderr.write('CandidateQualification evaluator sentinel failed: ' + (error?.name || 'Error') + '\n');
  }
  try { observations.snapshotReadable = readFileSync(process.argv[1]).length > 0; } catch {}
  observations.scratchWritable = __p1ScratchWritable(runId);
  const permission = process.permission;
  try { observations.networkDenied = typeof permission?.has === 'function' && permission.has('net') === false; } catch {}
  try { observations.processCreationDenied = typeof permission?.has === 'function' && permission.has('child') === false; } catch {}
  const sensitiveNames = ['OPENROUTER_API_KEY', 'GITHUB_TOKEN', 'CODEX_AUTH'];
  observations.sensitiveEnvAbsent = sensitiveNames.every((name) => process.env[name] === undefined);

  const result = { schemaVersion: 1, kind: 'p1-verifier-candidate-observation', runId, mode: 'CandidateQualification', observations };
  let serialized;
  try {
    serialized = JSON.stringify(result);
    observations.resultSerialized = typeof serialized === 'string';
    serialized = JSON.stringify(result);
    process.stdout.write(serialized + '\n');
  } catch {
    process.stderr.write('CandidateQualification result serialization failed\n');
    process.exitCode = 1;
    return;
  }
  const observationPass = observations.snapshotReadable
    && observations.scratchWritable
    && observations.networkDenied
    && observations.sensitiveEnvAbsent
    && observations.processCreationDenied
    && observations.resultSerialized;
  if (!semanticPass || !observationPass) process.exitCode = 1;
}

const __p1IsMain = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
const __p1EntryPath = process.argv[1]?.replace(/\\/g, '/');
if (__p1IsMain && __p1EntryPath?.endsWith('/candidate.mjs')) {
  await __p1RunQualification();
} else if (__p1IsMain) {
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

}

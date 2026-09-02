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

const PHOTOSYNTHESIS_SEMANTIC_EVALUATOR_REGISTRY = Object.freeze({
  [PHOTOSYNTHESIS_EVALUATOR_ID]: evaluatePhotosynthesisRelations,
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
};

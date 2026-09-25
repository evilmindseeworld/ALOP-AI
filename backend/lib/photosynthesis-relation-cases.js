'use strict';

/*
 * Deterministic generated matrix for photosynthesis-light-relation-v1.
 * The matrix is deliberately data-only: the evaluator, not this fixture, owns
 * the semantic decision. The suffix keeps every generated input and id stable
 * while exercising the same relation under controlled lexical variation.
 */
const POSITIVE_TEMPLATES = [
  (verb, light) => `Photosynthesis is how plants use chlorophyll to ${verb} ${light} and make food.`,
  (verb, light) => `Plants use chlorophyll to ${verb} ${light} during photosynthesis.`,
  (verb, light, thirdPerson) => `During photosynthesis, chlorophyll ${thirdPerson} ${light}.`,
  (verb, light, thirdPerson) => `Chlorophyll ${thirdPerson} ${light} for photosynthesis.`,
  (verb, light, thirdPerson) => `Photosynthesis ${thirdPerson} ${light}. It is driven by chlorophyll.`,
];

const POSITIVE_VERBS = ['capture', 'absorb', 'harness', 'convert'];
const POSITIVE_THIRD_PERSON = { capture: 'captures', absorb: 'absorbs', harness: 'harnesses', convert: 'converts' };
const LIGHT_OBJECTS = ['light energy', 'sunlight', 'solar energy', 'solar light'];

const NEGATIVE_TEMPLATES = [
  (light) => `Photosynthesis is the process by which plants convert ${light} into chemical energy.`,
  (light) => `Plants do not use chlorophyll to capture ${light} during photosynthesis.`,
  (light) => `Photosynthesis does not use chlorophyll to capture ${light}.`,
  (light) => `Photosynthesis never uses chlorophyll to harness ${light}.`,
  (light) => `Photosynthesis is not driven by chlorophyll, but it captures ${light}.`,
  (light) => `Photosynthesis cannot use chlorophyll to capture ${light}.`,
  (light) => `Photosynthesis uses chlorophyll to not capture ${light}.`,
  (light) => `Photosynthesis destroys ${light}. It is driven by chlorophyll.`,
  (light) => `Photosynthesis wastes ${light}. This process is powered by chlorophyll.`,
  (light) => `Photosynthesis ignores ${light} completely. It is powered by chlorophyll.`,
  (light) => `Plants use melanin instead of chlorophyll to capture ${light}.`,
  (light) => `Photosynthesis uses melanin to capture ${light}, and chlorophyll plays no role.`,
  (light) => `Chlorophyll is unrelated to photosynthesis, although plants capture ${light}.`,
  (light) => `Chlorophyll plays no role in photosynthesis; plants capture ${light}.`,
  (light) => `Chlorophyll prevents plants from using ${light}.`,
  (light) => `Photosynthesis converts ${light} into chemical energy. Chlorophyll is a pigment found in plants.`,
  () => 'Plants, chlorophyll, and light are mentioned here, but plants do not use chlorophyll and release no oxygen during photosynthesis.',
];

const makeCase = (kind, index, answer, expected) => Object.freeze({
  id: `photosynthesis-light-relation-v1-generated-${kind}-${String(index).padStart(4, '0')}`,
  generated: true,
  answer: `${answer} Case ${index}.`,
  expected,
});

const generatedCases = [];
let positiveIndex = 0;
for (const template of POSITIVE_TEMPLATES) {
  for (const verb of POSITIVE_VERBS) {
    for (const light of LIGHT_OBJECTS) {
      for (let variant = 0; variant < 5; variant += 1) {
        positiveIndex += 1;
        generatedCases.push(makeCase('positive', positiveIndex, template(verb, light, POSITIVE_THIRD_PERSON[verb]), true));
      }
    }
  }
}

let negativeIndex = 0;
while (negativeIndex < 423) {
  const template = NEGATIVE_TEMPLATES[negativeIndex % NEGATIVE_TEMPLATES.length];
  const light = LIGHT_OBJECTS[negativeIndex % LIGHT_OBJECTS.length];
  negativeIndex += 1;
  generatedCases.push(makeCase('negative', negativeIndex, template(light), false));
}

if (generatedCases.length !== 823) {
  throw new Error(`photosynthesis generated case count drifted: ${generatedCases.length}`);
}

const PHOTOSYNTHESIS_RELATION_CASES = Object.freeze(generatedCases);

const canonicalCases = [
  {
    "classIds": [
      "AFFIRMATIVE_ACTIVE"
    ],
    "expectedDecision": "PASS",
    "expectedPolarity": "AFFIRMED",
    "id": "ACT-001",
    "requiredDiagnostics": [
      "ACTIVE_SIMPLE",
      "ALL_VALID",
      "AFFIRMED"
    ],
    "text": "Photosynthesis converts light energy into chemical energy."
  },
  {
    "classIds": [
      "INFINITIVAL_CHLOROPHYLL_MEDIATED"
    ],
    "expectedDecision": "PASS",
    "id": "INF-001",
    "expectedPolarity": "AFFIRMED",
    "requiredDiagnostics": [
      "ACTIVE_INFINITIVAL_MEDIATED",
      "CHLOROPHYLL_SUPPORT",
      "embeddedTargetQualifies"
    ],
    "text": "Photosynthesis uses chlorophyll to capture light energy."
  },
  {
    "classIds": [
      "COORDINATED_PREDICATES"
    ],
    "expectedDecision": "PASS",
    "expectedPolarity": "AFFIRMED",
    "id": "CP-001",
    "requiredDiagnostics": [
      "ACTIVE_COORDINATED_SHARED_OBJECT",
      "twoPredicateRecords",
      "SHARED_OBJECT"
    ],
    "text": "Photosynthesis captures and stores light energy."
  },
  {
    "classIds": [
      "COORDINATED_SUBJECTS_VALID"
    ],
    "expectedDecision": "PASS",
    "expectedPolarity": "AFFIRMED",
    "id": "CSV-001",
    "requiredDiagnostics": [
      "ALL_VALID",
      "orderedSubjectSet"
    ],
    "text": "Plants and algae capture light energy during photosynthesis."
  },
  {
    "classIds": [
      "UNCERTAIN_MODALITY",
      "KNOWN_REGRESSIONS"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "UNCERTAIN",
    "id": "ADV001",
    "requiredDiagnostics": [
      "UNCERTAIN",
      "POSSIBILITY"
    ],
    "text": "Photosynthesis may use chlorophyll to capture light energy."
  },
  {
    "classIds": [
      "DETACHED_OBJECT_DECOYS",
      "DIRECT_OBJECT_BARRIERS",
      "KNOWN_REGRESSIONS"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "UNRESOLVED",
    "id": "ADV002",
    "requiredDiagnostics": [
      "DIRECT_OBJECT",
      "SEPARATE_PROPOSITION"
    ],
    "text": "Photosynthesis uses chlorophyll to capture carbon dioxide and light is nearby."
  },
  {
    "classIds": [
      "MALFORMED_SYNTAX",
      "KNOWN_REGRESSIONS"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "UNRESOLVED",
    "id": "ADV003",
    "requiredDiagnostics": [
      "GRAMMAR_SHAPE_NOT_ACCEPTED"
    ],
    "text": "Photosynthesis chlorophyll capture light energy."
  },
  {
    "classIds": [
      "DOUBLE_NEGATION",
      "NESTED_CONTROL",
      "KNOWN_REGRESSIONS"
    ],
    "expectedDecision": "PASS",
    "expectedPolarity": "AFFIRMED",
    "id": "ADV004",
    "requiredDiagnostics": [
      "NOT_FAIL_TO",
      "SANCTIONED_NOT_FAIL_TO"
    ],
    "text": "Photosynthesis does not fail to use chlorophyll to capture light energy."
  },
  {
    "classIds": [
      "AFFIRMATIVE_PASSIVE",
      "KNOWN_REGRESSIONS"
    ],
    "expectedDecision": "PASS",
    "expectedPolarity": "AFFIRMED",
    "id": "ADV005",
    "requiredDiagnostics": [
      "PASSIVE_LOCAL_AGENT",
      "local agent span"
    ],
    "text": "Light energy is captured by chlorophyll during photosynthesis."
  },
  {
    "classIds": [
      "COORDINATED_SUBJECTS_MIXED_INVALID",
      "KNOWN_REGRESSIONS"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "MIXED_INVALID",
    "id": "ADV006",
    "requiredDiagnostics": [
      "MIXED_INVALID",
      "UNSUPPORTED_CO_SUBJECT"
    ],
    "text": "Animals and plants use chlorophyll to capture light energy during photosynthesis."
  },
  {
    "classIds": [
      "COORDINATED_SUBJECTS_MIXED_INVALID"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "MIXED_INVALID",
    "id": "CSI-002",
    "requiredDiagnostics": [
      "MIXED_INVALID",
      "UNSUPPORTED_CO_SUBJECT"
    ],
    "text": "Plants and animals use chlorophyll to capture light energy during photosynthesis."
  },
  {
    "classIds": [
      "COORDINATED_SUBJECTS_MIXED_INVALID"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "MIXED_INVALID",
    "id": "CSI-003",
    "requiredDiagnostics": [
      "MIXED_INVALID",
      "UNSUPPORTED_CO_SUBJECT"
    ],
    "text": "Plants, algae, and animals capture light energy during photosynthesis."
  },
  {
    "classIds": [
      "COORDINATED_SUBJECTS_VALID"
    ],
    "expectedDecision": "PASS",
    "expectedPolarity": "AFFIRMED",
    "id": "SEP-001",
    "requiredDiagnostics": [
      "independent second proposition",
      "ALL_VALID"
    ],
    "text": "Animals move nearby, and plants capture light energy during photosynthesis."
  },
  {
    "classIds": [
      "DIRECT_OBJECT_BARRIERS"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "UNRESOLVED",
    "id": "DOB-001",
    "requiredDiagnostics": [
      "DIRECT_OBJECT",
      "LIGHT_OBJECT_MISSING"
    ],
    "text": "Photosynthesis captures carbon dioxide near light energy."
  },
  {
    "classIds": [
      "FINITE_PREDICATE_BARRIERS"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "UNRESOLVED",
    "id": "FPB-001",
    "requiredDiagnostics": [
      "FINITE_PREDICATE",
      "CLAUSE"
    ],
    "text": "Photosynthesis captures carbon dioxide while light energy is present."
  },
  {
    "classIds": [
      "SENTENCE_BOUNDARY"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "UNRESOLVED",
    "id": "SB-001",
    "requiredDiagnostics": [
      "SENTENCE"
    ],
    "text": "Photosynthesis converts chemicals. Light energy exists."
  },
  {
    "classIds": [
      "MALFORMED_SYNTAX"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "UNRESOLVED",
    "id": "MAL-002",
    "requiredDiagnostics": [
      "GRAMMAR_SHAPE_NOT_ACCEPTED"
    ],
    "text": "Photosynthesis light energy capture chlorophyll."
  },
  {
    "classIds": [
      "MALFORMED_SYNTAX"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "UNRESOLVED",
    "id": "MAL-003",
    "requiredDiagnostics": [
      "GRAMMAR_SHAPE_NOT_ACCEPTED"
    ],
    "text": "Chlorophyll light photosynthesis captures energy."
  },
  {
    "classIds": [
      "LOCAL_NEGATION"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "NEGATED",
    "id": "NEG-001",
    "requiredDiagnostics": [
      "NEGATED",
      "localNegationSpan"
    ],
    "text": "Photosynthesis does not capture light energy."
  },
  {
    "classIds": [
      "UNCERTAIN_MODALITY"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "UNCERTAIN",
    "id": "MOD-CAN",
    "requiredDiagnostics": [
      "UNCERTAIN",
      "CAPABILITY_NOT_ACTUALITY"
    ],
    "text": "Photosynthesis can capture light energy."
  },
  {
    "classIds": [
      "NEGATED_MODALITY"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "NEGATED",
    "id": "MOD-CANNOT",
    "requiredDiagnostics": [
      "NEGATED",
      "ASSERTED_INABILITY"
    ],
    "text": "Photosynthesis cannot capture light energy."
  },
  {
    "classIds": [
      "NEGATED_MODALITY"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "NEGATED",
    "id": "MOD-CANT",
    "requiredDiagnostics": [
      "NEGATED",
      "ASSERTED_INABILITY"
    ],
    "text": "Photosynthesis can't capture light energy."
  },
  {
    "classIds": [
      "UNCERTAIN_MODALITY"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "UNCERTAIN",
    "id": "MOD-MAY",
    "requiredDiagnostics": [
      "UNCERTAIN",
      "POSSIBILITY"
    ],
    "text": "Photosynthesis may capture light energy."
  },
  {
    "classIds": [
      "UNCERTAIN_MODALITY"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "UNCERTAIN",
    "id": "MOD-MAYNOT",
    "requiredDiagnostics": [
      "UNCERTAIN",
      "POSSIBLE_NEGATION_OR_WITHHOLDING"
    ],
    "text": "Photosynthesis may not capture light energy."
  },
  {
    "classIds": [
      "UNCERTAIN_MODALITY"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "UNCERTAIN",
    "id": "MOD-MIGHT",
    "requiredDiagnostics": [
      "UNCERTAIN",
      "WEAK_POSSIBILITY"
    ],
    "text": "Photosynthesis might capture light energy."
  },
  {
    "classIds": [
      "UNCERTAIN_MODALITY"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "UNCERTAIN",
    "id": "MOD-MIGHTNOT",
    "requiredDiagnostics": [
      "UNCERTAIN",
      "WEAK_POSSIBLE_NEGATION"
    ],
    "text": "Photosynthesis might not capture light energy."
  },
  {
    "classIds": [
      "UNCERTAIN_MODALITY"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "UNCERTAIN",
    "id": "MOD-COULD",
    "requiredDiagnostics": [
      "UNCERTAIN",
      "POSSIBILITY_OR_CAPABILITY"
    ],
    "text": "Photosynthesis could capture light energy."
  },
  {
    "classIds": [
      "NEGATED_MODALITY"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "NEGATED",
    "id": "MOD-COULDNOT",
    "requiredDiagnostics": [
      "NEGATED",
      "ASSERTED_INABILITY"
    ],
    "text": "Photosynthesis could not capture light energy."
  },
  {
    "classIds": [
      "AFFIRMED_MODALITY"
    ],
    "expectedDecision": "PASS",
    "expectedPolarity": "AFFIRMED",
    "id": "MOD-MUST",
    "requiredDiagnostics": [
      "AFFIRMED",
      "ASSERTED_NECESSITY"
    ],
    "text": "Photosynthesis must capture light energy."
  },
  {
    "classIds": [
      "NEGATED_MODALITY"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "NEGATED",
    "id": "MOD-MUSTNOT",
    "requiredDiagnostics": [
      "NEGATED",
      "NECESSARY_NEGATION"
    ],
    "text": "Photosynthesis must not capture light energy."
  },
  {
    "classIds": [
      "UNCERTAIN_MODALITY"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "UNRESOLVED",
    "id": "MOD-SHOULD",
    "requiredDiagnostics": [
      "UNRESOLVED",
      "NORMATIVE_OR_EXPECTED"
    ],
    "text": "Photosynthesis should capture light energy."
  },
  {
    "classIds": [
      "UNCERTAIN_MODALITY"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "UNRESOLVED",
    "id": "MOD-SHOULDNOT",
    "requiredDiagnostics": [
      "UNRESOLVED",
      "NORMATIVE_NEGATION"
    ],
    "text": "Photosynthesis should not capture light energy."
  },
  {
    "classIds": [
      "UNCERTAIN_MODALITY"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "UNRESOLVED",
    "id": "MOD-WOULD",
    "requiredDiagnostics": [
      "UNRESOLVED",
      "CONDITIONAL_OR_COUNTERFACTUAL"
    ],
    "text": "Photosynthesis would capture light energy."
  },
  {
    "classIds": [
      "UNCERTAIN_MODALITY"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "UNRESOLVED",
    "id": "MOD-WOULDNOT",
    "requiredDiagnostics": [
      "UNRESOLVED",
      "CONDITIONAL_NEGATION"
    ],
    "text": "Photosynthesis would not capture light energy."
  },
  {
    "classIds": [
      "NESTED_CONTROL"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "NEGATED",
    "id": "CTRL-FAIL",
    "requiredDiagnostics": [
      "NEGATED",
      "FAIL_TO"
    ],
    "text": "Photosynthesis fails to capture light energy."
  },
  {
    "classIds": [
      "NESTED_CONTROL"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "NEGATED",
    "id": "CTRL-FAILED",
    "requiredDiagnostics": [
      "NEGATED",
      "FAIL_TO"
    ],
    "text": "Photosynthesis failed to capture light energy."
  },
  {
    "classIds": [
      "DOUBLE_NEGATION"
    ],
    "expectedDecision": "PASS",
    "expectedPolarity": "AFFIRMED",
    "id": "CTRL-DIDNOTFAIL",
    "requiredDiagnostics": [
      "AFFIRMED",
      "NOT_FAIL_TO"
    ],
    "text": "Photosynthesis did not fail to capture light energy."
  },
  {
    "classIds": [
      "DOUBLE_NEGATION"
    ],
    "expectedDecision": "PASS",
    "expectedPolarity": "AFFIRMED",
    "id": "CTRL-NEVERFAIL",
    "requiredDiagnostics": [
      "AFFIRMED",
      "NEVER_FAIL_TO"
    ],
    "text": "Photosynthesis never fails to capture light energy."
  },
  {
    "classIds": [
      "NESTED_CONTROL"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "UNRESOLVED",
    "id": "CTRL-NOTAPPEAR",
    "requiredDiagnostics": [
      "UNRESOLVED",
      "NOT_APPEAR_TO"
    ],
    "text": "Photosynthesis does not appear to capture light energy."
  },
  {
    "classIds": [
      "NESTED_CONTROL"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "UNCERTAIN",
    "id": "CTRL-APPEARNOT",
    "requiredDiagnostics": [
      "UNCERTAIN",
      "APPEAR_NOT_TO"
    ],
    "text": "Photosynthesis appears not to capture light energy."
  },
  {
    "classIds": [
      "NESTED_CONTROL"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "UNRESOLVED",
    "id": "CTRL-NOTSEEM",
    "requiredDiagnostics": [
      "UNRESOLVED",
      "NOT_SEEM_TO"
    ],
    "text": "Photosynthesis does not seem to capture light energy."
  },
  {
    "classIds": [
      "NESTED_CONTROL"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "UNCERTAIN",
    "id": "CTRL-SEEMNOT",
    "requiredDiagnostics": [
      "UNCERTAIN",
      "SEEM_NOT_TO"
    ],
    "text": "Photosynthesis seems not to capture light energy."
  },
  {
    "classIds": [
      "UNRELATED_NEGATION"
    ],
    "expectedDecision": "PASS",
    "expectedPolarity": "AFFIRMED",
    "id": "UNN-001",
    "requiredDiagnostics": [
      "unrelated negation ignored",
      "AFFIRMED"
    ],
    "text": "Animals do not move, and photosynthesis captures light energy."
  },
  {
    "classIds": [
      "CLAUSE_BOUNDARY"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "UNRESOLVED",
    "id": "CB-001",
    "requiredDiagnostics": [
      "CLAUSE"
    ],
    "text": "Photosynthesis captures carbon dioxide; light energy is present."
  },
  {
    "classIds": [
      "PRONOUN_CONTINUATION"
    ],
    "expectedDecision": "PASS",
    "expectedPolarity": "AFFIRMED",
    "id": "PRON-001",
    "requiredDiagnostics": [
      "unique local light-object antecedent",
      "PRONOUN_ANTECEDENT"
    ],
    "text": "Photosynthesis captures light energy and stores it."
  },
  {
    "classIds": [
      "PRONOUN_CONTINUATION"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "UNRESOLVED",
    "id": "PRON-002",
    "requiredDiagnostics": [
      "pronoun resolves to carbon dioxide",
      "LIGHT_OBJECT_MISSING"
    ],
    "text": "Photosynthesis captures carbon dioxide and stores it near light energy."
  },
  {
    "classIds": [
      "INVALID_SUBJECT"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "ALL_INVALID",
    "id": "IS-001",
    "requiredDiagnostics": [
      "ALL_INVALID"
    ],
    "text": "Animals capture light energy during photosynthesis."
  },
  {
    "classIds": [
      "INVALID_OBJECT"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "AFFIRMED",
    "id": "IO-001",
    "requiredDiagnostics": [
      "LIGHT_OBJECT_MISSING"
    ],
    "text": "Photosynthesis captures heat energy."
  },
  {
    "classIds": [
      "DESTRUCTIVE_RELATION"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "AFFIRMED",
    "id": "DEST-001",
    "requiredDiagnostics": [
      "DESTRUCTIVE_RELATION"
    ],
    "text": "Photosynthesis destroys light energy."
  },
  {
    "classIds": [
      "WRONG_PIGMENT"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "AFFIRMED",
    "id": "WP-001",
    "requiredDiagnostics": [
      "WRONG_PIGMENT_RELATION"
    ],
    "text": "Melanin rather than chlorophyll captures the light for photosynthesis."
  },
  {
    "classIds": [
      "CONTRADICTION"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "CONTRADICTED",
    "id": "CON-001",
    "requiredDiagnostics": [
      "CONTRADICTION_PRESENT"
    ],
    "text": "Photosynthesis captures light energy but does not capture light energy."
  },
  {
    "classIds": [
      "PUNCTUATION_ABUSE"
    ],
    "expectedDecision": "FAIL",
    "expectedPolarity": "UNRESOLVED",
    "id": "PUN-001",
    "requiredDiagnostics": [
      "SENTENCE"
    ],
    "text": "Photosynthesis captures carbon dioxide!!! Light energy exists."
  },
  {
    "classIds": [
      "NO_STITCHING"
    ],
    "expectedDecision": "FAIL",
    "id": "NS-001",
    "expectedPolarity": "ALL_INVALID",
    "requiredDiagnostics": [
      "NO_CROSS_BOUNDARY_STITCHING"
    ],
    "text": "Chlorophyll is present; animals capture light energy."
  },
  {
    "classIds": [
      "AFFIRMATIVE_ACTIVE",
      "KNOWN_REGRESSIONS"
    ],
    "expectedDecision": "PASS",
    "expectedPolarity": "AFFIRMED",
    "id": "KREG-001",
    "requiredDiagnostics": [
      "ACTIVE_SIMPLE",
      "complete first-sentence active relation independently qualifies"
    ],
    "text": "Photosynthesis is the process by which green plants, algae, and some bacteria convert light energy into chemical energy, storing it in glucose molecules. It uses carbon dioxide and water, releasing oxygen as a byproduct, and is driven by chlorophyll in the presence of sunlight."
  }
];
const requiredTestClasses = [
  {
    "allowedParameterDimensions": [
      "SL",
      "VL",
      "VF",
      "LO",
      "CX"
    ],
    "classId": "AFFIRMATIVE_ACTIVE",
    "expectedDecision": "PASS",
    "minimumUniqueSemanticCases": 8,
    "purpose": "ordinary valid active relations",
    "requiredCanonicalCases": [
      "ACT-001",
      "KREG-001"
    ],
    "requiredDiagnosticProperties": [
      "grammarShape=ACTIVE_SIMPLE",
      "subjectValidity=ALL_VALID",
      "polarity=AFFIRMED"
    ]
  },
  {
    "allowedParameterDimensions": [
      "SL",
      "VL",
      "LO",
      "AX",
      "CX"
    ],
    "classId": "AFFIRMATIVE_PASSIVE",
    "expectedDecision": "PASS",
    "minimumUniqueSemanticCases": 6,
    "purpose": "valid local passive-agent relations",
    "requiredCanonicalCases": [
      "ADV005"
    ],
    "requiredDiagnosticProperties": [
      "grammarShape=PASSIVE_LOCAL_AGENT",
      "localByAgentSpan"
    ]
  },
  {
    "allowedParameterDimensions": [
      "SL",
      "VL",
      "VF",
      "LO",
      "AX",
      "CX"
    ],
    "classId": "INFINITIVAL_CHLOROPHYLL_MEDIATED",
    "expectedDecision": "PASS",
    "minimumUniqueSemanticCases": 6,
    "purpose": "mediated chlorophyll construction with embedded target",
    "requiredCanonicalCases": [
      "INF-001"
    ],
    "requiredDiagnosticProperties": [
      "twoRelationRecords",
      "embeddedTargetQualifies",
      "useDirectObject=CHLOROPHYLL"
    ]
  },
  {
    "allowedParameterDimensions": [
      "VL",
      "PO",
      "LO",
      "AX"
    ],
    "classId": "COORDINATED_PREDICATES",
    "expectedDecision": "PASS",
    "minimumUniqueSemanticCases": 6,
    "purpose": "shared-object coordination",
    "requiredCanonicalCases": [
      "CP-001"
    ],
    "requiredDiagnosticProperties": [
      "twoPredicateRecords",
      "oneSharedObjectSpan"
    ]
  },
  {
    "allowedParameterDimensions": [
      "SL",
      "SO",
      "SC",
      "VF"
    ],
    "classId": "COORDINATED_SUBJECTS_VALID",
    "expectedDecision": "PASS",
    "minimumUniqueSemanticCases": 6,
    "purpose": "complete valid ordered subject sets",
    "requiredCanonicalCases": [
      "CSV-001"
    ],
    "requiredDiagnosticProperties": [
      "subjectValidity=ALL_VALID",
      "orderedSubjectSet"
    ]
  },
  {
    "allowedParameterDimensions": [
      "SL",
      "SO",
      "SC",
      "VF"
    ],
    "classId": "COORDINATED_SUBJECTS_MIXED_INVALID",
    "expectedDecision": "FAIL",
    "minimumUniqueSemanticCases": 8,
    "purpose": "mixed valid and unsupported co-subjects",
    "requiredCanonicalCases": [
      "ADV006",
      "CSI-002",
      "CSI-003"
    ],
    "requiredDiagnosticProperties": [
      "subjectValidity=MIXED_INVALID",
      "UNSUPPORTED_CO_SUBJECT"
    ]
  },
  {
    "allowedParameterDimensions": [
      "VL",
      "LO",
      "OB",
      "BD"
    ],
    "classId": "DETACHED_OBJECT_DECOYS",
    "expectedDecision": "FAIL",
    "minimumUniqueSemanticCases": 8,
    "purpose": "later light decoys cannot bind backwards",
    "requiredCanonicalCases": [
      "ADV002"
    ],
    "requiredDiagnosticProperties": [
      "DIRECT_OBJECT",
      "SEPARATE_PROPOSITION"
    ]
  },
  {
    "allowedParameterDimensions": [
      "VL",
      "OB",
      "LO"
    ],
    "classId": "DIRECT_OBJECT_BARRIERS",
    "expectedDecision": "FAIL",
    "minimumUniqueSemanticCases": 6,
    "purpose": "non-light direct object stops object search",
    "requiredCanonicalCases": [
      "DOB-001"
    ],
    "requiredDiagnosticProperties": [
      "DIRECT_OBJECT"
    ]
  },
  {
    "allowedParameterDimensions": [
      "VL",
      "VF",
      "OB",
      "BD"
    ],
    "classId": "FINITE_PREDICATE_BARRIERS",
    "expectedDecision": "FAIL",
    "minimumUniqueSemanticCases": 6,
    "purpose": "finite and subordinate predicates stop object search",
    "requiredCanonicalCases": [
      "FPB-001"
    ],
    "requiredDiagnosticProperties": [
      "FINITE_PREDICATE"
    ]
  },
  {
    "allowedParameterDimensions": [
      "SL",
      "SO",
      "VL",
      "VF",
      "LO"
    ],
    "classId": "MALFORMED_SYNTAX",
    "expectedDecision": "FAIL",
    "minimumUniqueSemanticCases": 9,
    "purpose": "noun piles and role-order fragments fail closed",
    "requiredCanonicalCases": [
      "ADV003",
      "MAL-002",
      "MAL-003"
    ],
    "requiredDiagnosticProperties": [
      "GRAMMAR_SHAPE_NOT_ACCEPTED"
    ]
  },
  {
    "allowedParameterDimensions": [
      "AX",
      "VL",
      "LO"
    ],
    "classId": "LOCAL_NEGATION",
    "expectedDecision": "FAIL",
    "minimumUniqueSemanticCases": 8,
    "purpose": "relation-local explicit negation",
    "requiredCanonicalCases": [
      "NEG-001"
    ],
    "requiredDiagnosticProperties": [
      "polarity=NEGATED",
      "localNegationSpan"
    ]
  },
  {
    "allowedParameterDimensions": [
      "MO",
      "AX",
      "VL",
      "VO"
    ],
    "classId": "UNCERTAIN_MODALITY",
    "expectedDecision": "FAIL",
    "minimumUniqueSemanticCases": 12,
    "purpose": "possibility and capability never affirm facts",
    "requiredCanonicalCases": [
      "ADV001",
      "MOD-CAN",
      "MOD-MAY",
      "MOD-MAYNOT",
      "MOD-MIGHT",
      "MOD-MIGHTNOT",
      "MOD-COULD"
    ],
    "requiredDiagnosticProperties": [
      "polarity=UNCERTAIN",
      "modalPreserved"
    ]
  },
  {
    "allowedParameterDimensions": [
      "MO",
      "AX",
      "VL",
      "VO"
    ],
    "classId": "NEGATED_MODALITY",
    "expectedDecision": "FAIL",
    "minimumUniqueSemanticCases": 8,
    "purpose": "asserted inability or necessary negation",
    "requiredCanonicalCases": [
      "MOD-CANNOT",
      "MOD-CANT",
      "MOD-COULDNOT",
      "MOD-MUSTNOT"
    ],
    "requiredDiagnosticProperties": [
      "polarity=NEGATED",
      "modalPreserved"
    ]
  },
  {
    "allowedParameterDimensions": [
      "MO",
      "AX",
      "VL",
      "VO"
    ],
    "classId": "AFFIRMED_MODALITY",
    "expectedDecision": "PASS",
    "minimumUniqueSemanticCases": 4,
    "purpose": "asserted necessity is an affirmative fact",
    "requiredCanonicalCases": [
      "MOD-MUST"
    ],
    "requiredDiagnosticProperties": [
      "polarity=AFFIRMED",
      "ASSERTED_NECESSITY"
    ]
  },
  {
    "allowedParameterDimensions": [
      "CO",
      "VL",
      "VF",
      "AX"
    ],
    "classId": "NESTED_CONTROL",
    "expectedDecision": "FAIL",
    "minimumUniqueSemanticCases": 10,
    "purpose": "supported lexical control expressions",
    "requiredCanonicalCases": [
      "CTRL-FAIL",
      "CTRL-FAILED",
      "CTRL-NOTAPPEAR",
      "CTRL-APPEARNOT",
      "CTRL-NOTSEEM",
      "CTRL-SEEMNOT"
    ],
    "requiredDiagnosticProperties": [
      "controlChain",
      "polarityReason"
    ]
  },
  {
    "allowedParameterDimensions": [
      "CO",
      "VL",
      "VF",
      "AX"
    ],
    "classId": "DOUBLE_NEGATION",
    "expectedDecision": "PASS",
    "minimumUniqueSemanticCases": 6,
    "purpose": "explicit sanctioned not-fail-to compositions",
    "requiredCanonicalCases": [
      "ADV004",
      "CTRL-DIDNOTFAIL",
      "CTRL-NEVERFAIL"
    ],
    "requiredDiagnosticProperties": [
      "NOT_FAIL_TO",
      "NEVER_FAIL_TO"
    ]
  },
  {
    "allowedParameterDimensions": [
      "BD",
      "PU",
      "SL",
      "VL"
    ],
    "classId": "UNRELATED_NEGATION",
    "expectedDecision": "PASS",
    "minimumUniqueSemanticCases": 6,
    "purpose": "negation in another proposition is isolated",
    "requiredCanonicalCases": [
      "UNN-001"
    ],
    "requiredDiagnosticProperties": [
      "targetPolarity=AFFIRMED",
      "unrelatedNegationIgnored"
    ]
  },
  {
    "allowedParameterDimensions": [
      "BD",
      "PU",
      "OB"
    ],
    "classId": "CLAUSE_BOUNDARY",
    "expectedDecision": "FAIL",
    "minimumUniqueSemanticCases": 8,
    "purpose": "clause punctuation blocks relation stitching",
    "requiredCanonicalCases": [
      "CB-001"
    ],
    "requiredDiagnosticProperties": [
      "CLAUSE"
    ]
  },
  {
    "allowedParameterDimensions": [
      "BD",
      "PU",
      "OB"
    ],
    "classId": "SENTENCE_BOUNDARY",
    "expectedDecision": "FAIL",
    "minimumUniqueSemanticCases": 6,
    "purpose": "sentence punctuation blocks relation stitching",
    "requiredCanonicalCases": [
      "SB-001"
    ],
    "requiredDiagnosticProperties": [
      "SENTENCE"
    ]
  },
  {
    "allowedParameterDimensions": [
      "PR",
      "BD",
      "SL",
      "VL"
    ],
    "classId": "PRONOUN_CONTINUATION",
    "expectedDecision": "FAIL",
    "minimumUniqueSemanticCases": 6,
    "purpose": "restricted local it antecedent resolution",
    "requiredCanonicalCases": [
      "PRON-001",
      "PRON-002"
    ],
    "requiredDiagnosticProperties": [
      "antecedentIdOrAmbiguous",
      "noDistantBinding"
    ]
  },
  {
    "allowedParameterDimensions": [
      "SL",
      "SO",
      "SC",
      "VL"
    ],
    "classId": "INVALID_SUBJECT",
    "expectedDecision": "FAIL",
    "minimumUniqueSemanticCases": 8,
    "purpose": "unsupported process subjects fail",
    "requiredCanonicalCases": [
      "IS-001"
    ],
    "requiredDiagnosticProperties": [
      "subjectValidity=ALL_INVALID"
    ]
  },
  {
    "allowedParameterDimensions": [
      "VL",
      "LO",
      "OB"
    ],
    "classId": "INVALID_OBJECT",
    "expectedDecision": "FAIL",
    "minimumUniqueSemanticCases": 8,
    "purpose": "non-light objects do not qualify",
    "requiredCanonicalCases": [
      "IO-001"
    ],
    "requiredDiagnosticProperties": [
      "LIGHT_OBJECT_MISSING"
    ]
  },
  {
    "allowedParameterDimensions": [
      "SL",
      "VL",
      "LO",
      "MO"
    ],
    "classId": "DESTRUCTIVE_RELATION",
    "expectedDecision": "FAIL",
    "minimumUniqueSemanticCases": 6,
    "purpose": "destructive verbs disqualify asserted claims",
    "requiredCanonicalCases": [
      "DEST-001"
    ],
    "requiredDiagnosticProperties": [
      "DESTRUCTIVE_RELATION"
    ]
  },
  {
    "allowedParameterDimensions": [
      "PG",
      "SO",
      "VL",
      "LO"
    ],
    "classId": "WRONG_PIGMENT",
    "expectedDecision": "FAIL",
    "minimumUniqueSemanticCases": 6,
    "purpose": "wrong-pigment claims disqualify",
    "requiredCanonicalCases": [
      "WP-001"
    ],
    "requiredDiagnosticProperties": [
      "WRONG_PIGMENT_RELATION"
    ]
  },
  {
    "allowedParameterDimensions": [
      "VL",
      "MO",
      "CO",
      "BD"
    ],
    "classId": "CONTRADICTION",
    "expectedDecision": "FAIL",
    "minimumUniqueSemanticCases": 6,
    "purpose": "incompatible accepted relations are rejected",
    "requiredCanonicalCases": [
      "CON-001"
    ],
    "requiredDiagnosticProperties": [
      "CONTRADICTION_PRESENT",
      "contradictionPairIds"
    ]
  },
  {
    "allowedParameterDimensions": [
      "PU",
      "BD",
      "OB"
    ],
    "classId": "PUNCTUATION_ABUSE",
    "expectedDecision": "FAIL",
    "minimumUniqueSemanticCases": 8,
    "purpose": "abusive punctuation preserves boundaries",
    "requiredCanonicalCases": [
      "PUN-001"
    ],
    "requiredDiagnosticProperties": [
      "SENTENCE"
    ]
  },
  {
    "allowedParameterDimensions": [
      "BD",
      "OB",
      "SL",
      "LO"
    ],
    "classId": "NO_STITCHING",
    "expectedDecision": "FAIL",
    "minimumUniqueSemanticCases": 8,
    "purpose": "unrelated clauses never form one relation",
    "requiredCanonicalCases": [
      "NS-001"
    ],
    "requiredDiagnosticProperties": [
      "NO_CROSS_BOUNDARY_STITCHING"
    ]
  },
  {
    "allowedParameterDimensions": [
      "SL",
      "SO",
      "VL",
      "VF",
      "LO",
      "AX",
      "MO",
      "CO",
      "OB",
      "BD",
      "VO",
      "PU",
      "CX",
      "PO",
      "PR",
      "PG"
    ],
    "classId": "KNOWN_REGRESSIONS",
    "expectedDecision": "PASS_OR_FAIL_BY_CASE",
    "minimumUniqueSemanticCases": 8,
    "purpose": "frozen historical and adversarial regression cases",
    "requiredCanonicalCases": [
      "KREG-001",
      "ADV001",
      "ADV002",
      "ADV003",
      "ADV004",
      "ADV005",
      "ADV006"
    ],
    "requiredDiagnosticProperties": []
  }
];

const generatedV2Cases = [];
const generatedTexts = new Set(canonicalCases.map((item) => item.text));
const semanticVerbs = ['capture','absorb','harness','use','convert','transform','store'];
const verbForms = {
  capture:['capture','captures','captured','capturing'], absorb:['absorb','absorbs','absorbed','absorbing'],
  harness:['harness','harnesses','harnessed','harnessing'], use:['use','uses','used','using'],
  convert:['convert','converts','converted','converting'], transform:['transform','transforms','transformed','transforming'],
  store:['store','stores','stored','storing'], destroy:['destroy','destroys','destroyed','destroying'],
  waste:['waste','wastes','wasted','wasting'], ignore:['ignore','ignores','ignored','ignoring'],
  lose:['lose','loses','lost','losing'], block:['block','blocks','blocked','blocking'],
  reject:['reject','rejects','rejected','rejecting'], remove:['remove','removes','removed','removing'],
};
const verbPattern = /\b(?:captures?|captured|capturing|absorbs?|absorbed|absorbing|harnesses?|harnessed|harnessing|uses?|used|using|converts?|converted|converting|transforms?|transformed|transforming|stores?|stored|storing|destroys?|destroyed|destroying|wastes?|wasted|wasting|ignores?|ignored|ignoring|loses|lost|losing|blocks?|blocked|blocking|rejects?|rejected|rejecting|removes?|removed|removing|prevents?|prevented)\b/i;
const caseVerbReplacement = (text, lemma, replaceAll = false) => {
  const mediator = text.match(/\b(?:uses|used|use)\s+chlorophyll\s+to\s+/i);
  const before = mediator ? text.slice(0, mediator.index + mediator[0].length) : '';
  const after = mediator ? text.slice(before.length) : text;
  const replace = (surface) => {
    const form = Object.values(verbForms).find((forms) => forms.includes(surface.toLowerCase()));
    return form && verbForms[lemma] ? verbForms[lemma][form.indexOf(surface.toLowerCase())] : surface;
  };
  const changed = replaceAll
    ? after.replace(new RegExp(verbPattern.source, 'gi'), replace)
    : after.replace(verbPattern, replace);
  return before + changed;
};
const replaceInitialSubject = (text, subject) => text.replace(/^(?:Photosynthesis|Green plants|Some bacteria|Photosynthetic bacteria|Plants|Algae|Animals|Rocks|Bacteria)(?:\s+(?:and|or)\s+(?:green plants|some bacteria|photosynthetic bacteria|plants|algae|animals|rocks|bacteria))*\b/i, subject);
const structuralVariants = {
  DETACHED_OBJECT_DECOYS: [
    ['Photosynthesis uses chlorophyll to absorb starch and light is nearby.',['VL']],
    ['Photosynthesis uses chlorophyll to harness water vapor and light is nearby.',['VL']],
    ['Photosynthesis uses chlorophyll to use mineral salts and light is nearby.',['VL']],
    ['Photosynthesis uses chlorophyll to convert ultraviolet radiation and light is nearby.',['VL']],
    ['Photosynthesis uses chlorophyll to transform leaf tissue and light is nearby.',['VL']],
    ['Photosynthesis uses chlorophyll to store sugar molecules and light is nearby.',['VL']],
    ['Photosynthesis uses chlorophyll to capture nitrogen; light energy is nearby.',['BD']],
  ],
  LOCAL_NEGATION: [
    ['Photosynthesis does not capture water.',['LO']],
    ['Photosynthesis does not absorb heat energy.',['VL','LO']],
    ['Photosynthesis does not harness carbon dioxide.',['VL','LO']],
    ['Photosynthesis does not use oxygen.',['VL','LO']],
    ['Photosynthesis does not convert sugar.',['VL','LO']],
    ['Photosynthesis does not transform nutrients.',['VL','LO']],
    ['Photosynthesis does not store starch.',['VL','LO']],
  ],
  INVALID_SUBJECT: [['Rocks and animals capture light energy during photosynthesis.',['SC']]],
  INVALID_OBJECT: [
    ['Photosynthesis absorbs water.',['VL']],
    ['Photosynthesis harnesses carbon dioxide.',['VL']],
    ['Photosynthesis uses oxygen.',['VL']],
    ['Photosynthesis converts nutrients.',['VL']],
    ['Photosynthesis transforms starch.',['VL']],
    ['Photosynthesis stores sugar.',['VL']],
    ['Photosynthesis uses chlorophyll while light energy is present.',['LO']],
  ],
  CLAUSE_BOUNDARY: ['while','although','because','whereas','if','unless','when','since'].map((marker) => [`Photosynthesis captures carbon dioxide ${marker} light energy is present.`,['BD']]),
  SENTENCE_BOUNDARY: [
    ...[['; ',['BD','PU']],[': ',['BD','PU']],['? ',['PU']],['! ',['PU']]]
      .map(([separator,dimensions],index) => index < 2
        ? [`Photosynthesis converts chemicals${separator}light energy exists.`,dimensions]
        : index === 2
          ? ['Photosynthesis converts chemicals. Photosynthesis converts chemicals. Light energy exists.',['BD']]
          : ['Photosynthesis converts chemicals. Light energy exists. Photosynthesis converts chemicals.',['BD']]),
    ['Photosynthesis converts chemicals. Light energy exists. Animals capture light energy.',['BD']],
    ['Photosynthesis converts chemicals. Light energy exists; plants capture carbon dioxide.',['BD','PU']],
  ],
  PUNCTUATION_ABUSE: [
    ...[['??',['PU']],[':!',['PU','BD']],['?!?',['PU']],[':',['PU','BD']],[';',['PU','BD']],['...',['PU']]]
      .map(([punctuation,dimensions],index) => index === 0
        ? ['Photosynthesis captures carbon dioxide!; Light energy exists.',['PU','BD']]
        : index === 4
          ? ['Photosynthesis captures carbon dioxide:!; Light energy exists.',['PU','BD']]
          : index === 5
            ? ['Photosynthesis captures carbon dioxide?!; Light energy exists.',['PU','BD']]
            : [`Photosynthesis captures carbon dioxide${punctuation} Light energy exists.`,dimensions]),
    ['Photosynthesis captures carbon dioxide?! Light energy exists. Animals capture light energy.',['PU','BD']],
  ],
  NO_STITCHING: [
    ['Chlorophyll is present. Animals capture light energy.',['BD']],
    ['Chlorophyll is present; melanin captures light energy.',['SL']],
    ['Chlorophyll is present; carotene captures light energy.',['SL']],
    ['Chlorophyll is present; xanthophyll captures light energy.',['SL']],
    ['Chlorophyll is present; light energy is captured by rocks.',['OB']],
    ['Chlorophyll is present; chlorophyll captures water.',['SL','LO']],
    ['Chlorophyll is present; rocks capture water.',['LO']],
  ],
};
for (const row of requiredTestClasses) {
  const seed = canonicalCases.find((item) => row.requiredCanonicalCases.includes(item.id));
  if (!seed) continue;
  const canonicalForClass = canonicalCases.filter((item) => item.classIds.includes(row.classId));
  const needed = row.classId === 'PRONOUN_CONTINUATION' ? semanticVerbs.length
    : Math.max(0, row.minimumUniqueSemanticCases - canonicalForClass.length)
      + (row.classId === 'AFFIRMATIVE_ACTIVE' ? 9 : 0)
      + (row.classId === 'SENTENCE_BOUNDARY' ? 1 : 0);
  let serial = 0;
  const expectedDecision = row.classId === 'PRONOUN_CONTINUATION' ? 'PASS'
    : row.expectedDecision === 'PASS_OR_FAIL_BY_CASE' ? seed.expectedDecision : row.expectedDecision;
  const add = (text, parameterDimensions) => {
    if (serial >= needed || generatedTexts.has(text) || parameterDimensions.some((dimension) => !row.allowedParameterDimensions.includes(dimension))) return;
    generatedTexts.add(text);
    serial += 1;
    generatedV2Cases.push({
      id: `V2-${row.classId}-${String(serial).padStart(3,'0')}`,
      text,
      expectedDecision,
      classIds: [row.classId],
      parameterDimensions,
      requiredDiagnostics: row.classId === 'NO_STITCHING' ? ['NO_CROSS_BOUNDARY_STITCHING'] : [],
    });
  };
  for (const [text, dimensions] of structuralVariants[row.classId] || []) add(text,dimensions);
  if (row.classId === 'AFFIRMATIVE_ACTIVE') for (const subject of ['Plants','Green plants','Algae','Some bacteria','Photosynthetic bacteria']) for (const verb of semanticVerbs) add(`${subject} ${verbForms[verb][0]} light energy during photosynthesis.`,['SL','VF',...(verb==='convert'?[]:['VL'])]);
  if (row.classId === 'COORDINATED_SUBJECTS_VALID') for (const [subject,dimensions] of [['Algae and plants',['SO']],['Plants, algae, and some bacteria',['SO','SC']],['Green plants and algae',['SO','SL']],['Algae and photosynthetic bacteria',['SO']],['Some bacteria and green plants',['SO']],['Plants and algae and some bacteria',['SC','SO']]]) add(replaceInitialSubject(seed.text,subject),dimensions);
  if (row.classId === 'COORDINATED_SUBJECTS_MIXED_INVALID') for (const [subject,dimensions] of [['Plants and animals',['SO']],['Animals and algae',['SL']],['Algae and rocks',['SL']],['Animals and green plants',['SL']],['Animals and some bacteria',['SL']],['Rocks, plants, algae, and some bacteria',['SC']]]) add(replaceInitialSubject(seed.text,subject),dimensions);
  if (row.classId === 'PRONOUN_CONTINUATION') for (const verb of semanticVerbs) add(seed.text.replace(/\bstores it\b/i,`${verbForms[verb][1]} it`),['VL']);
  if (row.allowedParameterDimensions.includes('VL')) {
    const verbs = row.classId === 'DESTRUCTIVE_RELATION' ? ['destroy','waste','ignore','lose','block','reject','remove'] : semanticVerbs;
    for (const verb of verbs) add(caseVerbReplacement(seed.text,verb,row.classId==='CONTRADICTION'),['VL']);
  }
}

const b5SemanticSupplementCases = [
  {
    id: 'B5-PUNCTUATION_ABUSE-001',
    text: 'Photosynthesis captures carbon dioxide!?! Light energy exists.',
    expectedDecision: 'FAIL',
    classIds: ['PUNCTUATION_ABUSE'],
    parameterDimensions: ['PU'],
    requiredDiagnostics: [],
  },
];

module.exports = {
  EXPECTED_GENERATED_CASE_COUNT: 823,
  EXPECTED_V2_GENERATED_CASE_COUNT: 151,
  PHOTOSYNTHESIS_RELATION_CASES,
  generatedCases: PHOTOSYNTHESIS_RELATION_CASES,
  canonicalCases,
  requiredTestClasses,
  generatedV2Cases,
  b5SemanticSupplementCases,
};

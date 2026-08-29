import {
  GENDER_VALUES,
  HANDEDNESS_VALUES,
  QUESTIONNAIRE_RESULT_SCHEMA,
  STUDY_PROTOCOL_VERSION,
  STUDY_QUESTIONNAIRE_SCHEMA_ID,
  type AssessmentDraft,
  type AssessmentPage,
  type BlockRuntime,
  type ContractViolation,
  type Demographics,
  type QuestionnaireResult,
  type VariantId,
} from "./types"

export const QUESTIONNAIRE_PAGE_ORDER = [
  "participant_id",
  "demographics",
  "polar_setup",
  "session_ready",
  "vr_task_instructions",
  "self_assessment_manikin",
  "affect_vas",
  "emotion_representation_vas",
  "hand_embodiment",
  "complete",
] as const

export const QUESTIONNAIRE_CONTRACT = {
  demographics: {
    ageYears: { minimum: 0, maximum: 120 },
    handedness: HANDEDNESS_VALUES,
    gender: GENDER_VALUES,
    consentRequired: true,
  },
  sam: { minimum: 1, maximum: 9 },
  affectVas: { minimum: -100, maximum: 100, touchedRequired: true },
  emotionRepresentationVas: {
    minimum: 0,
    maximum: 100,
    touchedRequired: true,
  },
  handEmbodiment: { minimum: 1, maximum: 7 },
} as const

export function emptyAssessmentDraft(): AssessmentDraft {
  return {
    samValence: null,
    samArousal: null,
    samDominance: null,
    affectValence: 0,
    affectArousal: 0,
    affectValenceTouched: false,
    affectArousalTouched: false,
    anger: 0,
    disgust: 0,
    fear: 0,
    happiness: 0,
    sadness: 0,
    surprise: 0,
    angerTouched: false,
    disgustTouched: false,
    fearTouched: false,
    happinessTouched: false,
    sadnessTouched: false,
    surpriseTouched: false,
    handOwnership: null,
    handAgency: null,
  }
}

function rangeViolation(
  field: string,
  value: number | null,
  minimum: number,
  maximum: number,
): ContractViolation | null {
  if (!Number.isInteger(value) || value === null || value < minimum || value > maximum) {
    return {
      field,
      code: "out_of_range",
      detail: `Expected an integer from ${minimum} through ${maximum}.`,
    }
  }
  return null
}

export function validateDemographics(value: Demographics): ContractViolation[] {
  const violations: ContractViolation[] = []
  if (!value.firstName.trim()) {
    violations.push({ field: "first_name", code: "blank", detail: "First name is required." })
  }
  if (!value.lastName.trim()) {
    violations.push({ field: "last_name", code: "blank", detail: "Last name is required." })
  }
  const ageViolation = rangeViolation("age_years", value.ageYears, 0, 120)
  if (ageViolation) violations.push(ageViolation)
  if (!(HANDEDNESS_VALUES as readonly string[]).includes(value.handedness)) {
    violations.push({
      field: "handedness",
      code: "unknown_value",
      detail: "Handedness is not in the frozen set.",
    })
  }
  if (!(GENDER_VALUES as readonly string[]).includes(value.gender)) {
    violations.push({
      field: "gender",
      code: "unknown_value",
      detail: "Gender is not in the frozen set.",
    })
  }
  if (!value.consentConfirmed) {
    violations.push({
      field: "consent_confirmed",
      code: "required",
      detail: "Consent must be confirmed.",
    })
  }
  return violations
}

export function validateAssessmentPage(
  page: AssessmentPage,
  draft: AssessmentDraft,
): ContractViolation[] {
  const violations: ContractViolation[] = []
  if (page === "self_assessment_manikin") {
    const values = [
      ["sam.valence_raw_1_9", draft.samValence],
      ["sam.arousal_raw_1_9", draft.samArousal],
      ["sam.dominance_raw_1_9", draft.samDominance],
    ] as const
    for (const [field, value] of values) {
      const violation = rangeViolation(field, value, 1, 9)
      if (violation) violations.push(violation)
    }
  }
  if (page === "affect_vas") {
    const valence = rangeViolation(
      "affect_vas.valence_raw_neg100_pos100",
      draft.affectValence,
      -100,
      100,
    )
    const arousal = rangeViolation(
      "affect_vas.arousal_raw_neg100_pos100",
      draft.affectArousal,
      -100,
      100,
    )
    if (valence) violations.push(valence)
    if (arousal) violations.push(arousal)
    if (!draft.affectValenceTouched || !draft.affectArousalTouched) {
      violations.push({
        field: "affect_vas_touched",
        code: "untouched",
        detail: "Both affect scales must be touched.",
      })
    }
  }
  if (page === "emotion_representation_vas") {
    const values = [
      ["anger", draft.anger, draft.angerTouched],
      ["disgust", draft.disgust, draft.disgustTouched],
      ["fear", draft.fear, draft.fearTouched],
      ["happiness", draft.happiness, draft.happinessTouched],
      ["sadness", draft.sadness, draft.sadnessTouched],
      ["surprise", draft.surprise, draft.surpriseTouched],
    ] as const
    for (const [name, value, touched] of values) {
      const violation = rangeViolation(
        `emotion_representation_vas.${name}_raw_0_100`,
        value,
        0,
        100,
      )
      if (violation) violations.push(violation)
      if (!touched) {
        violations.push({
          field: `emotion_representation_vas_touched.${name}_raw_0_100`,
          code: "untouched",
          detail: `${name} must be touched.`,
        })
      }
    }
  }
  if (page === "hand_embodiment") {
    const ownership = rangeViolation(
      "hand_embodiment.ownership_raw_1_7",
      draft.handOwnership,
      1,
      7,
    )
    const agency = rangeViolation(
      "hand_embodiment.agency_raw_1_7",
      draft.handAgency,
      1,
      7,
    )
    if (ownership) violations.push(ownership)
    if (agency) violations.push(agency)
  }
  return violations
}

export function assessmentComplete(draft: AssessmentDraft): boolean {
  return (
    validateAssessmentPage("self_assessment_manikin", draft).length === 0 &&
    validateAssessmentPage("affect_vas", draft).length === 0 &&
    validateAssessmentPage("emotion_representation_vas", draft).length === 0 &&
    validateAssessmentPage("hand_embodiment", draft).length === 0
  )
}

function validRfc3339Instant(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  )
}

export function createQuestionnaireResult(input: {
  sessionId: string
  participantId: string
  variantId: VariantId
  block: BlockRuntime
  draft: AssessmentDraft
  recordedAtUtc: string
}): QuestionnaireResult {
  if (!assessmentComplete(input.draft)) {
    throw new Error("assessment_incomplete")
  }
  if (!validRfc3339Instant(input.recordedAtUtc)) {
    throw new Error("recorded_at_utc_invalid")
  }
  return {
    contract_version: QUESTIONNAIRE_RESULT_SCHEMA,
    protocol_version: STUDY_PROTOCOL_VERSION,
    schema_id: STUDY_QUESTIONNAIRE_SCHEMA_ID,
    session_id: input.sessionId,
    participant_id: input.participantId,
    variant_id: input.variantId,
    block_order: input.block.blockOrder,
    block_id: input.block.blockId,
    condition_id: input.block.conditionId,
    sam: {
      valence_raw_1_9: input.draft.samValence as number,
      arousal_raw_1_9: input.draft.samArousal as number,
      dominance_raw_1_9: input.draft.samDominance as number,
    },
    affect_vas: {
      valence_raw_neg100_pos100: input.draft.affectValence,
      arousal_raw_neg100_pos100: input.draft.affectArousal,
    },
    affect_vas_touched: {
      valence_raw_neg100_pos100: input.draft.affectValenceTouched,
      arousal_raw_neg100_pos100: input.draft.affectArousalTouched,
    },
    emotion_representation_vas: {
      anger_raw_0_100: input.draft.anger,
      disgust_raw_0_100: input.draft.disgust,
      fear_raw_0_100: input.draft.fear,
      happiness_raw_0_100: input.draft.happiness,
      sadness_raw_0_100: input.draft.sadness,
      surprise_raw_0_100: input.draft.surprise,
    },
    emotion_representation_vas_touched: {
      anger_raw_0_100: input.draft.angerTouched,
      disgust_raw_0_100: input.draft.disgustTouched,
      fear_raw_0_100: input.draft.fearTouched,
      happiness_raw_0_100: input.draft.happinessTouched,
      sadness_raw_0_100: input.draft.sadnessTouched,
      surprise_raw_0_100: input.draft.surpriseTouched,
    },
    hand_embodiment: {
      ownership_raw_1_7: input.draft.handOwnership as number,
      agency_raw_1_7: input.draft.handAgency as number,
    },
    page_complete: true,
    complete: true,
    recorded_at_utc: input.recordedAtUtc,
  }
}

export interface QuestionnaireLongItem {
  itemId: string
  itemValue: number
  itemScale: "1-9" | "-100-100" | "0-100" | "1-7"
}

/** Frozen Android long-form row order (13 response rows per block). */
export function questionnaireLongItems(
  value: QuestionnaireResult,
): QuestionnaireLongItem[] {
  return [
    { itemId: "SAM1", itemValue: value.sam.valence_raw_1_9, itemScale: "1-9" },
    { itemId: "SAM2", itemValue: value.sam.arousal_raw_1_9, itemScale: "1-9" },
    { itemId: "SAM3", itemValue: value.sam.dominance_raw_1_9, itemScale: "1-9" },
    {
      itemId: "valence",
      itemValue: value.affect_vas.valence_raw_neg100_pos100,
      itemScale: "-100-100",
    },
    {
      itemId: "arousal",
      itemValue: value.affect_vas.arousal_raw_neg100_pos100,
      itemScale: "-100-100",
    },
    {
      itemId: "Anger",
      itemValue: value.emotion_representation_vas.anger_raw_0_100,
      itemScale: "0-100",
    },
    {
      itemId: "Fear",
      itemValue: value.emotion_representation_vas.fear_raw_0_100,
      itemScale: "0-100",
    },
    {
      itemId: "Sadness",
      itemValue: value.emotion_representation_vas.sadness_raw_0_100,
      itemScale: "0-100",
    },
    {
      itemId: "Disgust",
      itemValue: value.emotion_representation_vas.disgust_raw_0_100,
      itemScale: "0-100",
    },
    {
      itemId: "Happiness",
      itemValue: value.emotion_representation_vas.happiness_raw_0_100,
      itemScale: "0-100",
    },
    {
      itemId: "Surprise",
      itemValue: value.emotion_representation_vas.surprise_raw_0_100,
      itemScale: "0-100",
    },
    {
      itemId: "Ownership",
      itemValue: value.hand_embodiment.ownership_raw_1_7,
      itemScale: "1-7",
    },
    {
      itemId: "Agency",
      itemValue: value.hand_embodiment.agency_raw_1_7,
      itemScale: "1-7",
    },
  ]
}

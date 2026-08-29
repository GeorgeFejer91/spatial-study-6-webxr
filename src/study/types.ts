export const STUDY_PROTOCOL_VERSION = "quest.questionnaire.v1" as const
export const STUDY_QUESTIONNAIRE_SCHEMA_ID = "study6-questionnaire-v8" as const
export const WEB_SESSION_SCHEMA = "spatial.study6.web_session.v1" as const
export const QUESTIONNAIRE_RESULT_SCHEMA =
  "spatial.study6.questionnaire_result.v1" as const

export const VARIANT_IDS = ["DHS", "SHD"] as const
export type VariantId = (typeof VARIANT_IDS)[number]

export const LANGUAGE_CODES = ["en", "de"] as const
export type LanguageCode = (typeof LANGUAGE_CODES)[number]

export const TIMING_MODES = ["full", "clipped"] as const
export type TimingMode = (typeof TIMING_MODES)[number]

export const TIMING_DURATION_MS: Record<TimingMode, number> = {
  clipped: 10_000,
  full: 300_000,
}

export const CONDITION_IDS = ["HC_HE", "LC_HE", "HC_LE", "LC_LE"] as const
export type ConditionId = (typeof CONDITION_IDS)[number]

export const AUDIO_VARIANT_IDS = ["V01", "V02", "V03", "V04"] as const
export type AudioVariantId = (typeof AUDIO_VARIANT_IDS)[number]

export const EXPERIMENT_PAGES = [
  "operator_setup",
  "participant_id",
  "demographics",
  "block_ready",
  "stimulus",
  "self_assessment_manikin",
  "affect_vas",
  "emotion_representation_vas",
  "hand_embodiment",
  "technical_hold",
  "complete",
] as const
export type ExperimentPage = (typeof EXPERIMENT_PAGES)[number]

export const ASSESSMENT_PAGES = [
  "self_assessment_manikin",
  "affect_vas",
  "emotion_representation_vas",
  "hand_embodiment",
] as const
export type AssessmentPage = (typeof ASSESSMENT_PAGES)[number]

export const HANDEDNESS_VALUES = [
  "right",
  "left",
  "ambidextrous",
  "prefer_not_to_say",
] as const
export type Handedness = (typeof HANDEDNESS_VALUES)[number]

export const GENDER_VALUES = [
  "male",
  "female",
  "other",
  "prefer_not_to_say",
] as const
export type Gender = (typeof GENDER_VALUES)[number]

export interface StudyConfiguration {
  variantId: VariantId
  languageCode: LanguageCode
  timingMode: TimingMode
}

export interface VariantSpec {
  participantPrefix: "PH" | "PI"
  dataFolder: string
  apkFileCode: string
  mappingTarget: "hand_avatar" | "background_environment"
  mediaSurface: "Hand" | "Env"
}

export interface PlannedBlock {
  permutationId: string
  blockOrder: number
  conditionId: ConditionId
  audioVariantId: AudioVariantId
  audioFile: string
  mediaId: string
  videoFile: string
}

export interface Demographics {
  firstName: string
  lastName: string
  ageYears: number
  handedness: Handedness
  gender: Gender
  consentConfirmed: boolean
}

export interface AssessmentDraft {
  samValence: number | null
  samArousal: number | null
  samDominance: number | null
  affectValence: number
  affectArousal: number
  affectValenceTouched: boolean
  affectArousalTouched: boolean
  anger: number
  disgust: number
  fear: number
  happiness: number
  sadness: number
  surprise: number
  angerTouched: boolean
  disgustTouched: boolean
  fearTouched: boolean
  happinessTouched: boolean
  sadnessTouched: boolean
  surpriseTouched: boolean
  handOwnership: number | null
  handAgency: number | null
}

export interface QuestionnaireResult {
  contract_version: typeof QUESTIONNAIRE_RESULT_SCHEMA
  protocol_version: typeof STUDY_PROTOCOL_VERSION
  schema_id: typeof STUDY_QUESTIONNAIRE_SCHEMA_ID
  session_id: string
  participant_id: string
  variant_id: VariantId
  block_order: number
  block_id: string
  condition_id: ConditionId
  sam: {
    valence_raw_1_9: number
    arousal_raw_1_9: number
    dominance_raw_1_9: number
  }
  affect_vas: {
    valence_raw_neg100_pos100: number
    arousal_raw_neg100_pos100: number
  }
  affect_vas_touched: {
    valence_raw_neg100_pos100: boolean
    arousal_raw_neg100_pos100: boolean
  }
  emotion_representation_vas: {
    anger_raw_0_100: number
    disgust_raw_0_100: number
    fear_raw_0_100: number
    happiness_raw_0_100: number
    sadness_raw_0_100: number
    surprise_raw_0_100: number
  }
  emotion_representation_vas_touched: {
    anger_raw_0_100: boolean
    disgust_raw_0_100: boolean
    fear_raw_0_100: boolean
    happiness_raw_0_100: boolean
    sadness_raw_0_100: boolean
    surprise_raw_0_100: boolean
  }
  hand_embodiment: {
    ownership_raw_1_7: number
    agency_raw_1_7: number
  }
  page_complete: true
  complete: true
  recorded_at_utc: string
}

export type BlockStatus = "pending" | "stimulus" | "assessment" | "complete"

export interface BlockRuntime extends PlannedBlock {
  blockId: string
  attemptId: string
  status: BlockStatus
  questionnaire: QuestionnaireResult | null
}

export type MediaStatus = "idle" | "playing" | "paused" | "ended"

export interface MediaState {
  status: MediaStatus
  positionMs: number
  durationMs: number
  startedAtUtc: string | null
  endedAtUtc: string | null
}

export interface ExperimentState {
  schema: typeof WEB_SESSION_SCHEMA
  protocolVersion: typeof STUDY_PROTOCOL_VERSION
  questionnaireSchemaId: typeof STUDY_QUESTIONNAIRE_SCHEMA_ID
  route: "webxr_incubator"
  testRoute: true
  participantDataEligible: false
  eligibilityBlockers: string[]
  page: ExperimentPage
  revision: number
  configuration: StudyConfiguration | null
  sessionId: string | null
  participantId: string
  participantAllocatedAtUtc: string | null
  demographics: Demographics | null
  blocks: BlockRuntime[]
  currentBlockIndex: number
  assessmentDraft: AssessmentDraft
  media: MediaState
  technicalHoldReason: string | null
  finalizedAtUtc: string | null
}

export interface ContractViolation {
  field: string
  code: string
  detail: string
}

export type ReductionResult =
  | { accepted: true; state: ExperimentState }
  | {
      accepted: false
      state: ExperimentState
      code: string
      detail: string
    }

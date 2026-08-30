import {
  completeBlockPlan,
  normalizeParticipantId,
  participantIdViolation,
} from "./allocation"
import {
  createQuestionnaireResult,
  emptyAssessmentDraft,
  validateAssessmentPage,
  validateDemographics,
} from "./questionnaire"
import {
  ASSESSMENT_PAGES,
  CONDITION_IDS,
  STUDY_PROTOCOL_VERSION,
  STUDY_QUESTIONNAIRE_SCHEMA_ID,
  TIMING_DURATION_MS,
  WEB_SESSION_SCHEMA,
  type AssessmentDraft,
  type AssessmentPage,
  type Demographics,
  type ExperimentState,
  type LanguageCode,
  type ReductionResult,
  type StudyConfiguration,
} from "./types"

const BASE_ELIGIBILITY_BLOCKERS = [
  "no_live_hand_or_polar_evidence",
  "participant_release_not_accepted",
  "synthetic_placeholder_stimulus",
  "webxr_incubator_test_route",
] as const

export type StudyAction =
  | { type: "configure"; configuration: StudyConfiguration }
  | { type: "set_participant_id"; participantId: string }
  | { type: "set_demographics_language"; languageCode: LanguageCode }
  | {
      type: "start_participant"
      sessionId: string
      allocatedAtUtc: string
      usedParticipantIds: readonly string[]
    }
  | { type: "submit_demographics"; demographics: Demographics }
  | { type: "start_block"; startedAtUtc: string }
  | { type: "observe_media_position"; positionMs: number }
  | { type: "pause_media" }
  | { type: "resume_media" }
  | {
      type: "restart_incomplete_block"
      attemptId: string
      restartedAtUtc: string
      reason: string
    }
  | {
      type: "complete_stimulus"
      observedDurationMs: number
      endedAtUtc: string
    }
  | {
      type: "set_sam"
      dimension: "valence" | "arousal" | "dominance"
      value: number
    }
  | {
      type: "set_affect"
      dimension: "valence" | "arousal"
      value: number
    }
  | {
      type: "set_emotion"
      emotion: "anger" | "disgust" | "fear" | "happiness" | "sadness" | "surprise"
      value: number
    }
  | { type: "set_hand"; dimension: "ownership" | "agency"; value: number }
  | { type: "advance_assessment"; recordedAtUtc?: string }
  | { type: "back_assessment" }
  | { type: "enter_technical_hold"; reason: string }
  | { type: "abort_session"; reason: string; abortedAtUtc: string }

export function createInitialExperimentState(): ExperimentState {
  return {
    schema: WEB_SESSION_SCHEMA,
    protocolVersion: STUDY_PROTOCOL_VERSION,
    questionnaireSchemaId: STUDY_QUESTIONNAIRE_SCHEMA_ID,
    route: "webxr_incubator",
    testRoute: true,
    participantDataEligible: false,
    eligibilityBlockers: [...BASE_ELIGIBILITY_BLOCKERS, "session_incomplete"].sort(),
    page: "operator_setup",
    revision: 0,
    configuration: null,
    sessionId: null,
    participantId: "",
    participantAllocatedAtUtc: null,
    demographics: null,
    blocks: [],
    currentBlockIndex: 0,
    assessmentDraft: emptyAssessmentDraft(),
    media: {
      status: "idle",
      positionMs: 0,
      durationMs: 0,
      startedAtUtc: null,
      endedAtUtc: null,
    },
    technicalHoldReason: null,
    finalizedAtUtc: null,
  }
}

function accepted(state: ExperimentState): ReductionResult {
  return { accepted: true, state: { ...state, revision: state.revision + 1 } }
}

function rejected(
  state: ExperimentState,
  code: string,
  detail: string,
): ReductionResult {
  return { accepted: false, state, code, detail }
}

function validInstant(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  )
}

function currentBlock(state: ExperimentState) {
  return state.blocks[state.currentBlockIndex]
}

function replaceCurrentBlock(
  state: ExperimentState,
  replacement: ExperimentState["blocks"][number],
) {
  return state.blocks.map((block, index) =>
    index === state.currentBlockIndex ? replacement : block,
  )
}

function assessmentPage(state: ExperimentState): AssessmentPage | null {
  return (ASSESSMENT_PAGES as readonly string[]).includes(state.page)
    ? (state.page as AssessmentPage)
    : null
}

export function canAdvanceAssessment(state: ExperimentState): boolean {
  const page = assessmentPage(state)
  return page !== null && validateAssessmentPage(page, state.assessmentDraft).length === 0
}

export function canGoBackAssessment(state: ExperimentState): boolean {
  return ["affect_vas", "emotion_representation_vas", "hand_embodiment"].includes(
    state.page,
  )
}

export function reduceStudy(
  state: ExperimentState,
  action: StudyAction,
): ReductionResult {
  switch (action.type) {
    case "configure": {
      if (state.page !== "operator_setup") {
        return rejected(state, "wrong_page", "Configuration is fixed after setup.")
      }
      return accepted({
        ...state,
        configuration: action.configuration,
        page: "participant_id",
      })
    }
    case "set_participant_id": {
      if (state.page !== "participant_id" || state.sessionId !== null) {
        return rejected(
          state,
          "participant_id_locked",
          "Participant ID can only change before allocation.",
        )
      }
      return accepted({ ...state, participantId: action.participantId })
    }
    case "set_demographics_language": {
      if (
        state.page !== "demographics" ||
        !state.configuration ||
        !state.sessionId ||
        state.blocks.some((block) => block.status !== "pending")
      ) {
        return rejected(
          state,
          "demographics_language_locked",
          "Questionnaire language can only change before the first block.",
        )
      }
      const plans = completeBlockPlan(
        state.participantId,
        state.configuration.variantId,
        action.languageCode,
      )
      return accepted({
        ...state,
        configuration: { ...state.configuration, languageCode: action.languageCode },
        blocks: state.blocks.map((block, index) => ({ ...block, ...plans[index] })),
      })
    }
    case "start_participant": {
      if (state.page !== "participant_id" || state.sessionId !== null) {
        return rejected(state, "participant_already_started", "A session is already allocated.")
      }
      const configuration = state.configuration
      if (!configuration) {
        return rejected(state, "configuration_missing", "Operator setup is incomplete.")
      }
      const violation = participantIdViolation(
        state.participantId,
        configuration.variantId,
        action.usedParticipantIds,
      )
      if (violation) return rejected(state, violation, "Participant ID was rejected.")
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(action.sessionId)) {
        return rejected(state, "session_id_malformed", "Session ID is malformed.")
      }
      if (!validInstant(action.allocatedAtUtc)) {
        return rejected(state, "allocation_time_invalid", "Allocation time is not RFC 3339.")
      }
      const participantId = normalizeParticipantId(state.participantId)
      const blocks = completeBlockPlan(
        participantId,
        configuration.variantId,
        configuration.languageCode,
      ).map((plan) => ({
        ...plan,
        blockId: `${action.sessionId}_BLOCK_${plan.blockOrder}`,
        attemptId: `${action.sessionId}_ATTEMPT_${plan.blockOrder}`,
        status: "pending" as const,
        questionnaire: null,
      }))
      return accepted({
        ...state,
        page: "demographics",
        sessionId: action.sessionId,
        participantId,
        participantAllocatedAtUtc: action.allocatedAtUtc,
        blocks,
      })
    }
    case "submit_demographics": {
      if (state.page !== "demographics" || !state.sessionId) {
        return rejected(state, "wrong_page", "Demographics are not currently expected.")
      }
      const violations = validateDemographics(action.demographics)
      if (violations.length > 0) {
        return rejected(
          state,
          "demographics_invalid",
          violations.map((violation) => violation.field).join(","),
        )
      }
      return accepted({
        ...state,
        page: "block_ready",
        demographics: {
          ...action.demographics,
          firstName: action.demographics.firstName.trim(),
          lastName: action.demographics.lastName.trim(),
        },
      })
    }
    case "start_block": {
      if (state.page !== "block_ready") {
        return rejected(state, "wrong_page", "A block is not ready to start.")
      }
      const configuration = state.configuration
      const block = currentBlock(state)
      if (!configuration || !block || block.status !== "pending") {
        return rejected(state, "block_not_pending", "The current block cannot start.")
      }
      if (!validInstant(action.startedAtUtc)) {
        return rejected(state, "start_time_invalid", "Block start time is not RFC 3339.")
      }
      return accepted({
        ...state,
        page: "stimulus",
        blocks: replaceCurrentBlock(state, { ...block, status: "stimulus" }),
        media: {
          status: "playing",
          positionMs: 0,
          durationMs: TIMING_DURATION_MS[configuration.timingMode],
          startedAtUtc: action.startedAtUtc,
          endedAtUtc: null,
        },
      })
    }
    case "observe_media_position": {
      if (state.page !== "stimulus" || state.media.status === "idle") {
        return rejected(state, "media_not_active", "No stimulus media is active.")
      }
      if (
        !Number.isFinite(action.positionMs) ||
        action.positionMs < state.media.positionMs ||
        action.positionMs > state.media.durationMs
      ) {
        return rejected(
          state,
          "media_position_invalid",
          "Media position must be finite, monotonic, and within the block duration.",
        )
      }
      return accepted({
        ...state,
        media: { ...state.media, positionMs: action.positionMs },
      })
    }
    case "pause_media": {
      if (state.page !== "stimulus" || state.media.status !== "playing") {
        return rejected(state, "media_not_playing", "Only playing media can be paused.")
      }
      return accepted({ ...state, media: { ...state.media, status: "paused" } })
    }
    case "resume_media": {
      if (state.page !== "stimulus" || state.media.status !== "paused") {
        return rejected(state, "media_not_paused", "Only paused media can be resumed.")
      }
      return accepted({ ...state, media: { ...state.media, status: "playing" } })
    }
    case "restart_incomplete_block": {
      const block = currentBlock(state)
      const restartablePage =
        state.page === "stimulus" ||
        state.page === "technical_hold" ||
        assessmentPage(state) !== null
      if (!state.sessionId || !block || !restartablePage || block.questionnaire !== null) {
        return rejected(
          state,
          "block_restart_not_allowed",
          "Only a questionnaire-incomplete active block can be restarted.",
        )
      }
      if (!/^[A-Za-z0-9._-]{1,96}$/.test(action.attemptId)) {
        return rejected(state, "attempt_id_malformed", "Restart attempt ID is malformed.")
      }
      if (!validInstant(action.restartedAtUtc)) {
        return rejected(state, "restart_time_invalid", "Restart time is not RFC 3339.")
      }
      if (!/^[a-z0-9_-]{1,64}$/.test(action.reason)) {
        return rejected(state, "restart_reason_invalid", "Restart reason is malformed.")
      }
      return accepted({
        ...state,
        page: "block_ready",
        blocks: replaceCurrentBlock(state, {
          ...block,
          attemptId: action.attemptId,
          status: "pending",
          questionnaire: null,
        }),
        assessmentDraft: emptyAssessmentDraft(),
        media: {
          status: "idle",
          positionMs: 0,
          durationMs: 0,
          startedAtUtc: null,
          endedAtUtc: null,
        },
        technicalHoldReason: null,
      })
    }
    case "complete_stimulus": {
      const block = currentBlock(state)
      if (state.page !== "stimulus" || !block || block.status !== "stimulus") {
        return rejected(state, "stimulus_not_active", "The current stimulus is not active.")
      }
      if (!validInstant(action.endedAtUtc)) {
        return rejected(state, "end_time_invalid", "Block end time is not RFC 3339.")
      }
      if (
        !Number.isFinite(action.observedDurationMs) ||
        action.observedDurationMs < state.media.durationMs
      ) {
        return rejected(
          state,
          "minimum_duration_not_met",
          "The protected block duration has not completed.",
        )
      }
      return accepted({
        ...state,
        page: "self_assessment_manikin",
        blocks: replaceCurrentBlock(state, { ...block, status: "assessment" }),
        media: {
          ...state.media,
          status: "ended",
          positionMs: state.media.durationMs,
          endedAtUtc: action.endedAtUtc,
        },
      })
    }
    case "set_sam": {
      if (state.page !== "self_assessment_manikin") {
        return rejected(state, "wrong_page", "SAM input is not currently accepted.")
      }
      if (!Number.isInteger(action.value) || action.value < 1 || action.value > 9) {
        return rejected(state, "sam_out_of_range", "SAM values must be 1 through 9.")
      }
      const key =
        action.dimension === "valence"
          ? "samValence"
          : action.dimension === "arousal"
            ? "samArousal"
            : "samDominance"
      return accepted({
        ...state,
        assessmentDraft: { ...state.assessmentDraft, [key]: action.value },
      })
    }
    case "set_affect": {
      if (state.page !== "affect_vas") {
        return rejected(state, "wrong_page", "Affect input is not currently accepted.")
      }
      if (!Number.isInteger(action.value) || action.value < -100 || action.value > 100) {
        return rejected(
          state,
          "affect_out_of_range",
          "Affect values must be -100 through 100.",
        )
      }
      const valueKey = action.dimension === "valence" ? "affectValence" : "affectArousal"
      const touchedKey =
        action.dimension === "valence"
          ? "affectValenceTouched"
          : "affectArousalTouched"
      return accepted({
        ...state,
        assessmentDraft: {
          ...state.assessmentDraft,
          [valueKey]: action.value,
          [touchedKey]: true,
        },
      })
    }
    case "set_emotion": {
      if (state.page !== "emotion_representation_vas") {
        return rejected(state, "wrong_page", "Emotion input is not currently accepted.")
      }
      if (!Number.isInteger(action.value) || action.value < 0 || action.value > 100) {
        return rejected(
          state,
          "emotion_out_of_range",
          "Emotion values must be 0 through 100.",
        )
      }
      const touchedKey = `${action.emotion}Touched` as keyof AssessmentDraft
      return accepted({
        ...state,
        assessmentDraft: {
          ...state.assessmentDraft,
          [action.emotion]: action.value,
          [touchedKey]: true,
        },
      })
    }
    case "set_hand": {
      if (state.page !== "hand_embodiment") {
        return rejected(state, "wrong_page", "Hand input is not currently accepted.")
      }
      if (!Number.isInteger(action.value) || action.value < 1 || action.value > 7) {
        return rejected(
          state,
          "hand_out_of_range",
          "Hand embodiment values must be 1 through 7.",
        )
      }
      const key = action.dimension === "ownership" ? "handOwnership" : "handAgency"
      return accepted({
        ...state,
        assessmentDraft: { ...state.assessmentDraft, [key]: action.value },
      })
    }
    case "advance_assessment": {
      const page = assessmentPage(state)
      if (!page) {
        return rejected(state, "wrong_page", "No assessment page can advance.")
      }
      const violations = validateAssessmentPage(page, state.assessmentDraft)
      if (violations.length > 0) {
        return rejected(
          state,
          "assessment_page_incomplete",
          violations.map((violation) => violation.field).join(","),
        )
      }
      if (page === "self_assessment_manikin") {
        return accepted({ ...state, page: "affect_vas" })
      }
      if (page === "affect_vas") {
        return accepted({ ...state, page: "emotion_representation_vas" })
      }
      if (page === "emotion_representation_vas") {
        return accepted({ ...state, page: "hand_embodiment" })
      }
      if (!action.recordedAtUtc || !state.sessionId || !state.configuration) {
        return rejected(
          state,
          "questionnaire_receipt_missing",
          "Final questionnaire submission requires a local timestamp and session identity.",
        )
      }
      const block = currentBlock(state)
      if (!block || block.status !== "assessment" || block.questionnaire !== null) {
        return rejected(
          state,
          "questionnaire_owner_mismatch",
          "Questionnaire cannot overwrite an existing block result.",
        )
      }
      let questionnaire
      try {
        questionnaire = createQuestionnaireResult({
          sessionId: state.sessionId,
          participantId: state.participantId,
          variantId: state.configuration.variantId,
          block,
          draft: state.assessmentDraft,
          recordedAtUtc: action.recordedAtUtc,
        })
      } catch (error) {
        return rejected(
          state,
          "questionnaire_invalid",
          error instanceof Error ? error.message : "Questionnaire is invalid.",
        )
      }
      const completedBlock = { ...block, status: "complete" as const, questionnaire }
      const blocks = replaceCurrentBlock(state, completedBlock)
      const isLastBlock = state.currentBlockIndex === blocks.length - 1
      if (isLastBlock) {
        return accepted({
          ...state,
          blocks,
          page: "complete",
          finalizedAtUtc: action.recordedAtUtc,
          eligibilityBlockers: state.eligibilityBlockers.filter(
            (blocker) => blocker !== "session_incomplete",
          ),
        })
      }
      return accepted({
        ...state,
        blocks,
        page: "block_ready",
        currentBlockIndex: state.currentBlockIndex + 1,
        assessmentDraft: emptyAssessmentDraft(),
        media: {
          status: "idle",
          positionMs: 0,
          durationMs: 0,
          startedAtUtc: null,
          endedAtUtc: null,
        },
      })
    }
    case "back_assessment": {
      const backEdges = {
        affect_vas: "self_assessment_manikin",
        emotion_representation_vas: "affect_vas",
        hand_embodiment: "emotion_representation_vas",
      } as const
      const next = backEdges[state.page as keyof typeof backEdges]
      if (!next) {
        return rejected(state, "back_not_allowed", "This page has no assessment back edge.")
      }
      return accepted({ ...state, page: next })
    }
    case "enter_technical_hold": {
      if (!state.sessionId || !["block_ready", "stimulus"].includes(state.page)) {
        return rejected(
          state,
          "technical_hold_not_allowed",
          "Technical hold is only available for an allocated block.",
        )
      }
      const reason = action.reason.trim()
      if (!reason || reason.length > 96) {
        return rejected(
          state,
          "technical_hold_reason_invalid",
          "Technical hold requires a bounded reason.",
        )
      }
      return accepted({
        ...state,
        page: "technical_hold",
        technicalHoldReason: reason,
        eligibilityBlockers: Array.from(
          new Set([...state.eligibilityBlockers, "technical_hold"]),
        ).sort(),
        media:
          state.media.status === "playing"
            ? { ...state.media, status: "paused" }
            : state.media,
      })
    }
    case "abort_session": {
      if (!state.sessionId || state.page === "complete" || state.page === "aborted") {
        return rejected(state, "abort_not_allowed", "There is no active session to abort.")
      }
      const reason = action.reason.trim()
      if (!reason || reason.length > 96) {
        return rejected(state, "abort_reason_invalid", "Abort requires a bounded reason.")
      }
      if (!validInstant(action.abortedAtUtc)) {
        return rejected(state, "abort_time_invalid", "Abort time is not RFC 3339.")
      }
      return accepted({
        ...state,
        page: "aborted",
        technicalHoldReason: reason,
        finalizedAtUtc: action.abortedAtUtc,
        eligibilityBlockers: Array.from(
          new Set([
            ...state.eligibilityBlockers.filter((blocker) => blocker !== "session_incomplete"),
            "session_aborted",
          ]),
        ).sort(),
        media:
          state.media.status === "playing"
            ? { ...state.media, status: "paused" }
            : state.media,
      })
    }
  }
}

export function validateExperimentState(state: ExperimentState): string[] {
  const errors: string[] = []
  if (state.schema !== WEB_SESSION_SCHEMA) errors.push("unsupported_schema")
  if (state.protocolVersion !== STUDY_PROTOCOL_VERSION) errors.push("unsupported_protocol")
  if (state.questionnaireSchemaId !== STUDY_QUESTIONNAIRE_SCHEMA_ID) {
    errors.push("unsupported_questionnaire_schema")
  }
  if (!state.testRoute || state.participantDataEligible) {
    errors.push("eligibility_boundary_broken")
  }
  if (!Number.isInteger(state.revision) || state.revision < 0) errors.push("revision_invalid")
  if (state.sessionId === null) {
    if (state.blocks.length !== 0 || state.demographics !== null) {
      errors.push("unallocated_state_contains_session_data")
    }
  } else {
    if (!state.configuration) errors.push("allocated_state_missing_configuration")
    if (state.blocks.length !== 4) errors.push("block_count_invalid")
    if (
      new Set(state.blocks.map((block) => block.conditionId)).size !== CONDITION_IDS.length
    ) {
      errors.push("condition_plan_invalid")
    }
    if (
      state.currentBlockIndex < 0 ||
      state.currentBlockIndex >= state.blocks.length ||
      !Number.isInteger(state.currentBlockIndex)
    ) {
      errors.push("current_block_invalid")
    }
    state.blocks.forEach((block, index) => {
      if (block.blockOrder !== index + 1) errors.push(`block_${index + 1}_order_invalid`)
      if (block.questionnaire && block.questionnaire.block_id !== block.blockId) {
        errors.push(`block_${index + 1}_questionnaire_owner_mismatch`)
      }
      if (block.status === "complete" && !block.questionnaire) {
        errors.push(`block_${index + 1}_questionnaire_missing`)
      }
    })
  }
  if (state.page === "complete") {
    if (state.blocks.length !== 4 || state.blocks.some((block) => block.status !== "complete")) {
      errors.push("complete_state_has_incomplete_blocks")
    }
    if (!state.finalizedAtUtc) errors.push("complete_state_missing_finalization")
  }
  if (state.page === "aborted" && (!state.sessionId || !state.finalizedAtUtc)) {
    errors.push("aborted_state_missing_terminal_identity")
  }
  return errors
}

import { describe, expect, it } from "vitest"

import {
  createInitialExperimentState,
  reduceStudy,
  validateExperimentState,
  type StudyAction,
} from "./reducer"
import type { ExperimentState, ReductionResult } from "./types"

function apply(state: ExperimentState, action: StudyAction): ExperimentState {
  const result = reduceStudy(state, action)
  expect(result.accepted, result.accepted ? "" : result.detail).toBe(true)
  return result.state
}

function startedState(): ExperimentState {
  let state = createInitialExperimentState()
  state = apply(state, {
    type: "configure",
    configuration: { variantId: "DHS", languageCode: "de", timingMode: "clipped" },
  })
  state = apply(state, { type: "set_participant_id", participantId: "ph1" })
  state = apply(state, {
    type: "start_participant",
    sessionId: "WEB_TEST_SESSION",
    allocatedAtUtc: "2026-08-29T20:00:00Z",
    usedParticipantIds: [],
  })
  return apply(state, {
    type: "submit_demographics",
    demographics: {
      firstName: "Test",
      lastName: "Person",
      ageYears: 30,
      handedness: "right",
      gender: "prefer_not_to_say",
      consentConfirmed: true,
    },
  })
}

function answerCurrentAssessment(state: ExperimentState, blockIndex: number): ExperimentState {
  state = apply(state, { type: "set_sam", dimension: "valence", value: 5 })
  state = apply(state, { type: "set_sam", dimension: "arousal", value: 5 })
  state = apply(state, { type: "set_sam", dimension: "dominance", value: 5 })
  state = apply(state, { type: "advance_assessment" })
  state = apply(state, { type: "set_affect", dimension: "valence", value: 0 })
  state = apply(state, { type: "set_affect", dimension: "arousal", value: 0 })
  state = apply(state, { type: "advance_assessment" })
  for (const emotion of [
    "anger",
    "disgust",
    "fear",
    "happiness",
    "sadness",
    "surprise",
  ] as const) {
    state = apply(state, { type: "set_emotion", emotion, value: 0 })
  }
  state = apply(state, { type: "advance_assessment" })
  state = apply(state, { type: "set_hand", dimension: "ownership", value: 4 })
  state = apply(state, { type: "set_hand", dimension: "agency", value: 4 })
  return apply(state, {
    type: "advance_assessment",
    recordedAtUtc: `2026-08-29T20:0${blockIndex + 1}:00Z`,
  })
}

describe("Study 6 web reducer", () => {
  it("changes questionnaire language on demographics and rebinds only pending audio", () => {
    let state = createInitialExperimentState()
    state = apply(state, {
      type: "configure",
      configuration: { variantId: "DHS", languageCode: "de", timingMode: "clipped" },
    })
    state = apply(state, { type: "set_participant_id", participantId: "PH1" })
    state = apply(state, {
      type: "start_participant",
      sessionId: "LANGUAGE_TEST",
      allocatedAtUtc: "2026-08-29T20:00:00Z",
      usedParticipantIds: [],
    })
    const blockIds = state.blocks.map((block) => block.blockId)
    const conditions = state.blocks.map((block) => block.conditionId)
    expect(state.blocks.every((block) => block.audioFile.includes("_DE"))).toBe(true)

    state = apply(state, { type: "set_demographics_language", languageCode: "en" })

    expect(state.configuration?.languageCode).toBe("en")
    expect(state.blocks.map((block) => block.blockId)).toEqual(blockIds)
    expect(state.blocks.map((block) => block.conditionId)).toEqual(conditions)
    expect(state.blocks.every((block) => block.audioFile.includes("_EN"))).toBe(true)
  })

  it("runs four unique blocks through the complete questionnaire without eligibility promotion", () => {
    let state = startedState()
    expect(state.page).toBe("block_ready")
    expect(state.blocks.map((block) => block.conditionId)).toEqual([
      "HC_HE",
      "LC_HE",
      "HC_LE",
      "LC_LE",
    ])
    for (let blockIndex = 0; blockIndex < 4; blockIndex += 1) {
      state = apply(state, {
        type: "start_block",
        startedAtUtc: `2026-08-29T20:0${blockIndex}:00Z`,
      })
      expect(state.media.durationMs).toBe(10_000)
      state = apply(state, { type: "observe_media_position", positionMs: 10_000 })
      state = apply(state, {
        type: "complete_stimulus",
        observedDurationMs: 10_000,
        endedAtUtc: `2026-08-29T20:0${blockIndex}:10Z`,
      })
      state = answerCurrentAssessment(state, blockIndex)
    }

    expect(state.page).toBe("complete")
    expect(state.blocks.every((block) => block.status === "complete")).toBe(true)
    expect(state.blocks.every((block) => block.questionnaire !== null)).toBe(true)
    expect(state.eligibilityBlockers).not.toContain("session_incomplete")
    expect(state.participantDataEligible).toBe(false)
    expect(state.testRoute).toBe(true)
    expect(validateExperimentState(state)).toEqual([])
  })

  it("allocates only on Start participant and rejects used or wrong-pool IDs", () => {
    let state = createInitialExperimentState()
    state = apply(state, {
      type: "configure",
      configuration: { variantId: "DHS", languageCode: "en", timingMode: "full" },
    })
    state = apply(state, { type: "set_participant_id", participantId: "PI1" })
    let result: ReductionResult = reduceStudy(state, {
      type: "start_participant",
      sessionId: "SESSION",
      allocatedAtUtc: "2026-08-29T20:00:00Z",
      usedParticipantIds: [],
    })
    expect(result.accepted).toBe(false)
    if (!result.accepted) expect(result.code).toBe("participant_id_other_variant")
    expect(result.state.sessionId).toBeNull()

    state = apply(state, { type: "set_participant_id", participantId: "PH1" })
    result = reduceStudy(state, {
      type: "start_participant",
      sessionId: "SESSION",
      allocatedAtUtc: "2026-08-29T20:00:00Z",
      usedParticipantIds: ["ph1"],
    })
    expect(result.accepted).toBe(false)
    if (!result.accepted) expect(result.code).toBe("participant_id_already_used")
  })

  it("guards duration, touched scales, back edges, and immutable questionnaire ownership", () => {
    let state = startedState()
    state = apply(state, {
      type: "start_block",
      startedAtUtc: "2026-08-29T20:00:00Z",
    })
    const early = reduceStudy(state, {
      type: "complete_stimulus",
      observedDurationMs: 9_999,
      endedAtUtc: "2026-08-29T20:00:10Z",
    })
    expect(early.accepted).toBe(false)
    if (!early.accepted) expect(early.code).toBe("minimum_duration_not_met")

    state = apply(state, {
      type: "complete_stimulus",
      observedDurationMs: 10_000,
      endedAtUtc: "2026-08-29T20:00:10Z",
    })
    const incomplete = reduceStudy(state, { type: "advance_assessment" })
    expect(incomplete.accepted).toBe(false)
    if (!incomplete.accepted) expect(incomplete.code).toBe("assessment_page_incomplete")

    state = apply(state, { type: "set_sam", dimension: "valence", value: 5 })
    state = apply(state, { type: "set_sam", dimension: "arousal", value: 5 })
    state = apply(state, { type: "set_sam", dimension: "dominance", value: 5 })
    state = apply(state, { type: "advance_assessment" })
    state = apply(state, { type: "back_assessment" })
    expect(state.page).toBe("self_assessment_manikin")
  })

  it("round-trips a partial state for reload recovery", () => {
    let state = startedState()
    state = apply(state, {
      type: "start_block",
      startedAtUtc: "2026-08-29T20:00:00Z",
    })
    state = apply(state, { type: "observe_media_position", positionMs: 4_200 })
    state = apply(state, { type: "pause_media" })
    const recovered = JSON.parse(JSON.stringify(state)) as ExperimentState
    expect(validateExperimentState(recovered)).toEqual([])
    expect(recovered.page).toBe("stimulus")
    expect(recovered.media).toMatchObject({ status: "paused", positionMs: 4_200 })
  })

  it("makes an operator abort a durable WebXR terminal state", () => {
    let state = startedState()
    state = apply(state, {
      type: "start_block",
      startedAtUtc: "2026-08-29T20:00:00Z",
    })

    state = apply(state, {
      type: "abort_session",
      reason: "remote_operator_abort",
      abortedAtUtc: "2026-08-29T20:00:02Z",
    })

    expect(state).toMatchObject({
      page: "aborted",
      finalizedAtUtc: "2026-08-29T20:00:02Z",
      technicalHoldReason: "remote_operator_abort",
      media: { status: "paused" },
    })
    expect(state.eligibilityBlockers).toContain("session_aborted")
    expect(state.eligibilityBlockers).not.toContain("session_incomplete")
    expect(validateExperimentState(state)).toEqual([])
    expect(
      reduceStudy(state, {
        type: "abort_session",
        reason: "duplicate_abort",
        abortedAtUtc: "2026-08-29T20:00:03Z",
      }),
    ).toMatchObject({ accepted: false, code: "abort_not_allowed" })
  })
})

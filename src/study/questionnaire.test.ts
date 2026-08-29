import { describe, expect, it } from "vitest"

import { blockPlan } from "./allocation"
import {
  assessmentComplete,
  createQuestionnaireResult,
  emptyAssessmentDraft,
  questionnaireLongItems,
  validateAssessmentPage,
  validateDemographics,
} from "./questionnaire"
import type { AssessmentDraft, BlockRuntime, Demographics } from "./types"

function completeDraft(): AssessmentDraft {
  return {
    ...emptyAssessmentDraft(),
    samValence: 5,
    samArousal: 6,
    samDominance: 7,
    affectValence: 0,
    affectArousal: 0,
    affectValenceTouched: true,
    affectArousalTouched: true,
    angerTouched: true,
    disgustTouched: true,
    fearTouched: true,
    happinessTouched: true,
    sadnessTouched: true,
    surpriseTouched: true,
    handOwnership: 4,
    handAgency: 5,
  }
}

function firstBlock(): BlockRuntime {
  return {
    ...blockPlan("PH1", "DHS", "en", 1),
    blockId: "SESSION_BLOCK_1",
    attemptId: "SESSION_ATTEMPT_1",
    status: "assessment",
    questionnaire: null,
  }
}

describe("frozen Study 6 questionnaire", () => {
  it("preserves required demographics and the frozen 0..120 age range", () => {
    const value: Demographics = {
      firstName: "Test",
      lastName: "Person",
      ageYears: 0,
      handedness: "right",
      gender: "prefer_not_to_say",
      consentConfirmed: true,
    }
    expect(validateDemographics(value)).toEqual([])
    expect(validateDemographics({ ...value, ageYears: 121 })[0]?.field).toBe("age_years")
    expect(validateDemographics({ ...value, consentConfirmed: false })[0]?.field).toBe(
      "consent_confirmed",
    )
  })

  it("requires an explicit touch while allowing zero VAS answers", () => {
    const draft = completeDraft()
    expect(validateAssessmentPage("affect_vas", draft)).toEqual([])
    expect(validateAssessmentPage("emotion_representation_vas", draft)).toEqual([])
    expect(
      validateAssessmentPage("affect_vas", {
        ...draft,
        affectValenceTouched: false,
      })[0]?.code,
    ).toBe("untouched")
  })

  it("creates the exact v1 result field names and 13 frozen long rows", () => {
    const result = createQuestionnaireResult({
      sessionId: "SESSION",
      participantId: "PH1",
      variantId: "DHS",
      block: firstBlock(),
      draft: completeDraft(),
      recordedAtUtc: "2026-08-29T20:00:00Z",
    })
    expect(result.contract_version).toBe("spatial.study6.questionnaire_result.v1")
    expect(result.schema_id).toBe("study6-questionnaire-v8")
    expect(result.sam).toEqual({
      valence_raw_1_9: 5,
      arousal_raw_1_9: 6,
      dominance_raw_1_9: 7,
    })
    expect(questionnaireLongItems(result).map((row) => row.itemId)).toEqual([
      "SAM1",
      "SAM2",
      "SAM3",
      "valence",
      "arousal",
      "Anger",
      "Fear",
      "Sadness",
      "Disgust",
      "Happiness",
      "Surprise",
      "Ownership",
      "Agency",
    ])
  })

  it("rejects incomplete and invalid assessment values", () => {
    expect(assessmentComplete(emptyAssessmentDraft())).toBe(false)
    expect(() =>
      createQuestionnaireResult({
        sessionId: "SESSION",
        participantId: "PH1",
        variantId: "DHS",
        block: firstBlock(),
        draft: emptyAssessmentDraft(),
        recordedAtUtc: "2026-08-29T20:00:00Z",
      }),
    ).toThrow("assessment_incomplete")
  })
})

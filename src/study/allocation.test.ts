import { describe, expect, it } from "vitest"

import {
  AUDIO_PERMUTATIONS,
  CONDITION_PERMUTATIONS,
  availableParticipantIds,
  blockPlan,
  conditionOrder,
  javaStringHashCode,
  participantIdViolation,
  participantPool,
  permutationNumber,
} from "./allocation"

describe("frozen Study 6 allocation", () => {
  it("keeps the exact PH/PI pools", () => {
    expect(participantPool("DHS")).toEqual(
      Array.from({ length: 24 }, (_, index) => `PH${index + 1}`),
    )
    expect(participantPool("SHD")).toEqual(
      Array.from({ length: 24 }, (_, index) => `PI${index + 1}`),
    )
    expect(availableParticipantIds("DHS", ["ph1", "PH24"])).toEqual(
      participantPool("DHS"),
    )
  })

  it("generates the same recursive 24 permutations for conditions and audio", () => {
    expect(CONDITION_PERMUTATIONS).toHaveLength(24)
    expect(AUDIO_PERMUTATIONS).toHaveLength(24)
    expect(new Set(CONDITION_PERMUTATIONS.map((value) => value.join("|"))).size).toBe(24)
    expect(CONDITION_PERMUTATIONS[0]).toEqual(["HC_HE", "LC_HE", "HC_LE", "LC_LE"])
    expect(CONDITION_PERMUTATIONS[23]).toEqual(["LC_LE", "HC_LE", "LC_HE", "HC_HE"])
    expect(AUDIO_PERMUTATIONS[0]).toEqual(["V01", "V02", "V03", "V04"])
    expect(AUDIO_PERMUTATIONS[23]).toEqual(["V04", "V03", "V02", "V01"])
  })

  it("uses a positive trailing number and wraps after permutation 24", () => {
    expect(permutationNumber("PH1")).toBe(1)
    expect(permutationNumber("PI24")).toBe(24)
    expect(permutationNumber("TEST_25")).toBe(1)
    expect(conditionOrder("PH7")).toEqual(conditionOrder("PI7"))
  })

  it("matches Java String.hashCode for manual IDs", () => {
    expect(javaStringHashCode("ABC")).toBe(64_578)
    expect(javaStringHashCode("HELLO")).toBe(68_624_562)
    expect(permutationNumber("hello")).toBe(11)
  })

  it("maps the same permutation position to condition and audio", () => {
    expect(blockPlan("PH1", "DHS", "de", 1)).toEqual({
      permutationId: "perm_01",
      blockOrder: 1,
      conditionId: "HC_HE",
      audioVariantId: "V01",
      audioFile: "study6_neutral_hand_audio_V01_DE.mp3",
      mediaId: "Hand_HC_HE",
      videoFile: "Hand_HC_HE.mp4",
    })
    expect(blockPlan("PI1", "SHD", "en", 1).mediaId).toBe("Env_HC_HE")
  })

  it("keeps every valid participant ID selectable regardless of prior use or prefix", () => {
    expect(participantIdViolation("PI1", "DHS")).toBeNull()
    expect(participantIdViolation("PH1", "SHD")).toBeNull()
    expect(participantIdViolation("manual_01", "DHS", ["MANUAL_01"])).toBeNull()
    expect(participantIdViolation("TEST_WEB_01", "DHS")).toBeNull()
    expect(participantIdViolation("", "DHS")).toBe("participant_id_required")
    expect(participantIdViolation("bad id", "DHS")).toBe("participant_id_malformed")
  })
})

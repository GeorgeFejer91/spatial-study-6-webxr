import { describe, expect, it } from "vitest"

import { STUDY_COPY, formatStudyText, studyText } from "./copy"

describe("English and German questionnaire copy", () => {
  it("has an exact German entry for every English key", () => {
    expect(Object.keys(STUDY_COPY.de).sort()).toEqual(Object.keys(STUDY_COPY.en).sort())
    expect(Object.values(STUDY_COPY.de).every((value) => value.trim().length > 0)).toBe(true)
  })

  it("includes German copy for pages that were English-only in the native panel", () => {
    expect(studyText("de", "affect.valence.question")).toContain("angenehm")
    expect(studyText("de", "emotion.instruction")).toContain("Bewegen")
    expect(studyText("de", "hand.ownership")).toContain("virtuellen Hände")
  })

  it("formats bounded page placeholders", () => {
    expect(
      formatStudyText("de", "block.heading", { block: 2, condition: "LC_HE" }),
    ).toBe("Block 2 | LC_HE")
  })
})

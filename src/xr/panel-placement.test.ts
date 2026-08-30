import { describe, expect, it } from 'vitest'

import {
  advanceStudyPanelAnchorPoll,
  resolveStudyPanelInteractionMode,
  shouldReanchorStudyPanel,
  STUDY_PANEL_ANCHOR_POLL_INTERVAL_MILLISECONDS,
  STUDY_PANEL_REANCHOR_DISTANCE_METERS,
} from './panel-placement.ts'

describe('Study XR panel placement guard', () => {
  it('keeps direct mode behind an explicit QA capability', () => {
    expect(resolveStudyPanelInteractionMode('direct', false)).toBe('pointer')
    expect(resolveStudyPanelInteractionMode('direct', true)).toBe('direct')
    expect(resolveStudyPanelInteractionMode('pointer', true)).toBe('pointer')
  })

  it('reanchors only after drift is strictly greater than the native threshold', () => {
    const thresholdSquared = STUDY_PANEL_REANCHOR_DISTANCE_METERS ** 2
    expect(shouldReanchorStudyPanel(thresholdSquared)).toBe(false)
    expect(shouldReanchorStudyPanel(thresholdSquared + Number.EPSILON)).toBe(true)
    expect(shouldReanchorStudyPanel(Number.NaN)).toBe(false)
  })

  it('polls once after 250 ms and rebaselines instead of running catch-up bursts', () => {
    const before = advanceStudyPanelAnchorPoll(
      200,
      STUDY_PANEL_ANCHOR_POLL_INTERVAL_MILLISECONDS - 201,
      true,
    )
    expect(before).toEqual({ elapsedMilliseconds: 249, shouldPoll: false })

    const atThreshold = advanceStudyPanelAnchorPoll(before.elapsedMilliseconds, 1, true)
    expect(atThreshold).toEqual({ elapsedMilliseconds: 0, shouldPoll: true })

    const delayedFrame = advanceStudyPanelAnchorPoll(0, 800, true)
    expect(delayedFrame).toEqual({ elapsedMilliseconds: 0, shouldPoll: true })
  })

  it('does not accumulate or poll while XR or the questionnaire is inactive', () => {
    expect(advanceStudyPanelAnchorPoll(249, 16, false)).toEqual({
      elapsedMilliseconds: 0,
      shouldPoll: false,
    })
  })
})

import type { StudyPanelInteractionMode } from '../ui/constants.ts'

export const STUDY_PANEL_ANCHOR_POLL_INTERVAL_MILLISECONDS = 250
export const STUDY_PANEL_REANCHOR_DISTANCE_METERS = 0.75

export interface StudyPanelAnchorPoll {
  elapsedMilliseconds: number
  shouldPoll: boolean
}

/**
 * Advances a low-rate anchor check without attempting catch-up bursts after a
 * delayed frame. Hidden/non-presenting panels discard accumulated time so a
 * stimulus cannot trigger a stale questionnaire re-anchor.
 */
export function advanceStudyPanelAnchorPoll(
  elapsedMilliseconds: number,
  deltaMilliseconds: number,
  active: boolean,
): StudyPanelAnchorPoll {
  if (!active) return { elapsedMilliseconds: 0, shouldPoll: false }

  const safeElapsed = Number.isFinite(elapsedMilliseconds)
    ? Math.max(0, elapsedMilliseconds)
    : 0
  const safeDelta = Number.isFinite(deltaMilliseconds)
    ? Math.max(0, deltaMilliseconds)
    : 0
  const nextElapsed = safeElapsed + safeDelta
  if (nextElapsed < STUDY_PANEL_ANCHOR_POLL_INTERVAL_MILLISECONDS) {
    return { elapsedMilliseconds: nextElapsed, shouldPoll: false }
  }
  return { elapsedMilliseconds: 0, shouldPoll: true }
}

export function shouldReanchorStudyPanel(squaredDriftMeters: number): boolean {
  return (
    Number.isFinite(squaredDriftMeters) &&
    squaredDriftMeters > STUDY_PANEL_REANCHOR_DISTANCE_METERS ** 2
  )
}

export function resolveStudyPanelInteractionMode(
  requested: StudyPanelInteractionMode,
  allowDirectMode: boolean,
): StudyPanelInteractionMode {
  return requested === 'direct' && allowDirectMode ? 'direct' : 'pointer'
}

export const PLACEHOLDER_STIMULUS_PROVIDER_ID = 'placeholder.v1' as const

export interface StimulusAssignment {
  videoFile: string
  audioFile: string
  durationMs: number
}

export type StimulusPhase = 'idle' | 'preparing' | 'ready' | 'playing' | 'paused' | 'ended' | 'error'

export type TimingUncertainty =
  | {
      kind: 'estimated'
      milliseconds: number
      basis: string
      scope: 'browser-clock-correlation-only'
    }
  | {
      kind: 'unknown'
      reason: string
      scope: 'physical-output-not-observed'
    }

export type AudioClockEvidence =
  | {
      method: 'getOutputTimestamp'
      capturedAtPerformanceMs: number
      contextTimeSeconds: number
      performanceTimeMs: number
      captureSpanMs: number
      uncertainty: TimingUncertainty
      physicalOutputUncertainty: TimingUncertainty
    }
  | {
      method: 'currentTime-fallback'
      capturedAtPerformanceMs: number
      contextTimeSeconds: number
      performanceTimeMs: number
      reason: 'unsupported' | 'invalid-result' | 'api-error'
      uncertainty: TimingUncertainty
      physicalOutputUncertainty: TimingUncertainty
    }

export type StimulusFailureCode =
  | 'no_assignment'
  | 'invalid_assignment'
  | 'audio_context_unavailable'
  | 'audio_fetch_failed'
  | 'audio_decode_failed'
  | 'decoded_audio_too_short'
  | 'preparation_superseded'
  | 'local_gesture_required'
  | 'invalid_schedule'
  | 'schedule_cancelled'
  | 'schedule_missed'
  | 'playback_failed'
  | 'disposed'

export interface StimulusFailure {
  stage: 'prepare' | 'schedule' | 'playback'
  code: StimulusFailureCode
  message: string
  retryable: boolean
  uncertainty: TimingUncertainty | null
}

export interface StimulusSnapshot {
  phase: StimulusPhase
  positionMs: number
  durationMs: number
  assignment: StimulusAssignment | null
  error: string | null
  failure?: StimulusFailure | null
}

export interface StimulusPreparationReceipt {
  providerId: typeof PLACEHOLDER_STIMULUS_PROVIDER_ID
  assignment: StimulusAssignment
  preparedAtPerformanceMs: number
  decodedAudioDurationMs: number
  requestedDurationMs: number
}

export interface StimulusStartRequest {
  /** Browser `performance.now()` time corresponding to the shared start barrier. */
  startAtPerformanceMs?: number
  positionMs?: number
  barrierId?: string
  maxLatenessMs?: number
  /** Clock-fit uncertainty supplied by the barrier coordinator, when applicable. */
  clockUncertainty?: TimingUncertainty
}

export interface StimulusStartReceipt {
  providerId: typeof PLACEHOLDER_STIMULUS_PROVIDER_ID
  barrierId: string | null
  requestedStartAtPerformanceMs: number
  scheduledStartAtPerformanceMs: number
  scheduledStartAtContextSeconds: number
  positionMs: number
  audioClock: AudioClockEvidence
  startUncertainty: TimingUncertainty
  physicalOutputUncertainty: TimingUncertainty
  /** This proves browser scheduling only. It is not a physical speaker-onset observation. */
  evidenceScope: 'browser-audio-scheduled'
}

export type StimulusEffectReceipt =
  | {
      providerId: typeof PLACEHOLDER_STIMULUS_PROVIDER_ID
      effect: 'audio_scheduled'
      barrierId: string | null
      observedAtPerformanceMs: number
      start: StimulusStartReceipt
    }
  | {
      providerId: typeof PLACEHOLDER_STIMULUS_PROVIDER_ID
      effect: 'video_first_frame'
      barrierId: string | null
      observedAtPerformanceMs: number
      mediaTimeMs: number
      expectedDisplayTimeMs: number | null
      evidenceScope: 'browser-video-frame-callback'
    }
  | {
      providerId: typeof PLACEHOLDER_STIMULUS_PROVIDER_ID
      effect: 'playback_ended'
      barrierId: string | null
      observedAtPerformanceMs: number
      evidenceScope: 'browser-playback-state'
    }

export interface StimulusProvider {
  readonly providerId: typeof PLACEHOLDER_STIMULUS_PROVIDER_ID
  prepare(assignment: StimulusAssignment, positionMs?: number): Promise<StimulusPreparationReceipt>
  scheduleStart(request?: StimulusStartRequest): Promise<StimulusStartReceipt>
  pause(): StimulusSnapshot
  resume(request?: Omit<StimulusStartRequest, 'positionMs'>): Promise<StimulusStartReceipt>
  stop(): StimulusSnapshot
  snapshot(): StimulusSnapshot
  dispose(): void
}

export class StimulusProviderError extends Error {
  readonly failure: StimulusFailure

  constructor(failure: StimulusFailure, cause?: unknown) {
    super(failure.message, cause === undefined ? undefined : { cause })
    this.name = 'StimulusProviderError'
    this.failure = failure
  }
}

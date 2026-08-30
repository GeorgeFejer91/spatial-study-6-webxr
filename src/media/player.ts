import { Container, Video } from '@pmndrs/uikit'

import {
  PLACEHOLDER_STIMULUS_PROVIDER_ID,
  StimulusProviderError,
  type AudioClockEvidence,
  type StimulusAssignment,
  type StimulusEffectReceipt,
  type StimulusFailure,
  type StimulusPreparationReceipt,
  type StimulusProvider,
  type StimulusSnapshot,
  type StimulusStartReceipt,
  type StimulusStartRequest,
  type TimingUncertainty,
} from './stimulus-provider.ts'
import {
  STUDY_PANEL_HEIGHT_PX,
  STUDY_PANEL_PIXEL_SIZE_METERS,
  STUDY_PANEL_WIDTH_PX,
} from '../ui/constants.ts'

export type StudyMediaAssignment = StimulusAssignment
export type StudyMediaSnapshot = StimulusSnapshot

export interface StudyMediaPlayerOptions {
  onProgress?: (snapshot: StudyMediaSnapshot) => void
  onEnded?: (snapshot: StudyMediaSnapshot) => void
  onError?: (snapshot: StudyMediaSnapshot) => void
  onToggleRequest?: (snapshot: StudyMediaSnapshot) => void
  onEffect?: (receipt: StimulusEffectReceipt) => void
  createAudioContext?: () => AudioContext
  fetchAudio?: typeof fetch
  performanceNow?: () => number
  minimumScheduleLeadMs?: number
  defaultMaxLatenessMs?: number
}

interface PreparedAudio {
  buffer: AudioBuffer
  receipt: StimulusPreparationReceipt
}

type PreparationOutcome =
  | { ok: true; prepared: PreparedAudio }
  | { ok: false; error: StimulusProviderError }

interface ActivePlayback {
  source: AudioBufferSourceNode
  token: number
  startContextSeconds: number
  startPerformanceMs: number
  offsetSeconds: number
  durationSeconds: number
  videoTimer: ReturnType<typeof setTimeout> | null
  barrierId: string | null
}

interface VideoFrameMetadataSubset {
  mediaTime: number
  expectedDisplayTime?: number
}

interface OptionalVideoFrameCallback {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: VideoFrameMetadataSubset) => void,
  ) => number
}

export function mediaAssetUrls(assignment: StudyMediaAssignment): {
  video: string
  audio: string
} {
  const base = import.meta.env.BASE_URL
  return {
    video: `${base}assets/video/${encodeURIComponent(assignment.videoFile)}`,
    audio: `${base}assets/audio/${encodeURIComponent(assignment.audioFile)}`,
  }
}

function estimatedUncertainty(milliseconds: number, basis: string): TimingUncertainty {
  return {
    kind: 'estimated',
    milliseconds: Math.max(0, milliseconds),
    basis,
    scope: 'browser-clock-correlation-only',
  }
}

function unknownOutputUncertainty(reason: string): TimingUncertainty {
  return {
    kind: 'unknown',
    reason,
    scope: 'physical-output-not-observed',
  }
}

/**
 * Captures the browser's audio-context/performance-clock correlation. This is
 * scheduling evidence only: neither branch observes pressure-wave onset at the
 * headset speaker.
 */
export function captureAudioClockEvidence(
  context: Pick<AudioContext, 'currentTime'> & Partial<Pick<AudioContext, 'getOutputTimestamp'>>,
  performanceNow: () => number = () => performance.now(),
): AudioClockEvidence {
  const before = performanceNow()
  if (typeof context.getOutputTimestamp === 'function') {
    try {
      const timestamp = context.getOutputTimestamp()
      const after = performanceNow()
      const contextTime = timestamp.contextTime
      const performanceTime = timestamp.performanceTime
      const captureMidpoint = before + Math.max(0, after - before) / 2
      if (
        typeof contextTime === 'number' &&
        Number.isFinite(contextTime) &&
        contextTime >= 0 &&
        contextTime <= context.currentTime + 1 &&
        typeof performanceTime === 'number' &&
        Number.isFinite(performanceTime) &&
        performanceTime >= 0 &&
        Math.abs(captureMidpoint - performanceTime) <= 10_000
      ) {
        const captureSpanMs = Math.max(0, after - before)
        return {
          method: 'getOutputTimestamp',
          capturedAtPerformanceMs: before + captureSpanMs / 2,
          contextTimeSeconds: contextTime,
          performanceTimeMs: performanceTime,
          captureSpanMs,
          uncertainty: estimatedUncertainty(
            Math.max(0.25, captureSpanMs / 2),
            'getOutputTimestamp correlation capture; excludes the physical output path',
          ),
          physicalOutputUncertainty: unknownOutputUncertainty(
            'The browser correlation does not observe physical speaker onset',
          ),
        }
      }
      return {
        method: 'currentTime-fallback',
        capturedAtPerformanceMs: after,
        contextTimeSeconds: context.currentTime,
        performanceTimeMs: after,
        reason: 'invalid-result',
        uncertainty: unknownOutputUncertainty(
          'getOutputTimestamp returned an invalid correlation; physical output latency is unknown',
        ),
        physicalOutputUncertainty: unknownOutputUncertainty(
          'No physical speaker-onset observation is available',
        ),
      }
    } catch {
      const after = performanceNow()
      return {
        method: 'currentTime-fallback',
        capturedAtPerformanceMs: after,
        contextTimeSeconds: context.currentTime,
        performanceTimeMs: after,
        reason: 'api-error',
        uncertainty: unknownOutputUncertainty(
          'getOutputTimestamp failed; physical output latency is unknown',
        ),
        physicalOutputUncertainty: unknownOutputUncertainty(
          'No physical speaker-onset observation is available',
        ),
      }
    }
  }
  const after = performanceNow()
  return {
    method: 'currentTime-fallback',
    capturedAtPerformanceMs: after,
    contextTimeSeconds: context.currentTime,
    performanceTimeMs: after,
    reason: 'unsupported',
    uncertainty: unknownOutputUncertainty(
      'getOutputTimestamp is unavailable; physical output latency is unknown',
    ),
    physicalOutputUncertainty: unknownOutputUncertainty(
      'No physical speaker-onset observation is available',
    ),
  }
}

function createDefaultAudioContext(): AudioContext {
  if (typeof AudioContext === 'undefined') {
    throw new Error('Web Audio is unavailable in this browser.')
  }
  return new AudioContext({ latencyHint: 'interactive' })
}

function cloneFailure(failure: StimulusFailure | null): StimulusFailure | null {
  if (!failure) return null
  return {
    ...failure,
    uncertainty: failure.uncertainty ? { ...failure.uncertainty } : null,
  }
}

function combineUncertainty(
  audioClock: TimingUncertainty,
  clockFit: TimingUncertainty | undefined,
  scheduleAdjustmentMs: number,
): TimingUncertainty {
  const values = [audioClock, clockFit].filter((value): value is TimingUncertainty => value !== undefined)
  const unknown = values.find((value) => value.kind === 'unknown')
  if (unknown?.kind === 'unknown') {
    return unknownOutputUncertainty(
      `${unknown.reason}; browser scheduling adjustment was ${scheduleAdjustmentMs.toFixed(3)} ms`,
    )
  }
  const total = values.reduce(
    (sum, value) => sum + (value.kind === 'estimated' ? value.milliseconds : 0),
    Math.abs(scheduleAdjustmentMs),
  )
  return estimatedUncertainty(
    total,
    'clock-fit estimate plus browser audio-clock capture and scheduler adjustment; excludes physical output',
  )
}

function validAssignment(assignment: StimulusAssignment): boolean {
  return (
    assignment.videoFile.trim().length > 0 &&
    assignment.audioFile.trim().length > 0 &&
    Number.isFinite(assignment.durationMs) &&
    assignment.durationMs > 0
  )
}

export class StudyMediaPlayer implements StimulusProvider {
  readonly providerId = PLACEHOLDER_STIMULUS_PROVIDER_ID
  readonly root: Container
  readonly video: HTMLVideoElement
  /** Retained for API compatibility. Decoded Web Audio, not this element, owns audio playback. */
  readonly audio: HTMLAudioElement

  private readonly videoView: Video
  private readonly options: StudyMediaPlayerOptions
  private readonly createAudioContext: () => AudioContext
  private readonly fetchAudio: typeof fetch
  private readonly performanceNow: () => number
  private readonly minimumScheduleLeadMs: number
  private readonly defaultMaxLatenessMs: number
  private assignment: StudyMediaAssignment | null = null
  private phase: StudyMediaSnapshot['phase'] = 'idle'
  private error: string | null = null
  private failure: StimulusFailure | null = null
  private lastProgressAt = -Infinity
  private pendingPositionSeconds = 0
  private audioContext: AudioContext | null = null
  private preparation: Promise<PreparationOutcome> | null = null
  private preparedAudio: PreparedAudio | null = null
  private preparationGeneration = 0
  private playbackGeneration = 0
  private scheduleGeneration = 0
  private preparationAbort: AbortController | null = null
  private activePlayback: ActivePlayback | null = null
  private lastStart: StimulusStartReceipt | null = null
  private disposed = false

  constructor(options: StudyMediaPlayerOptions = {}) {
    this.options = options
    this.createAudioContext = options.createAudioContext ?? createDefaultAudioContext
    this.fetchAudio = options.fetchAudio ?? fetch
    this.performanceNow = options.performanceNow ?? (() => performance.now())
    this.minimumScheduleLeadMs = Math.max(5, options.minimumScheduleLeadMs ?? 25)
    this.defaultMaxLatenessMs = Math.max(0, options.defaultMaxLatenessMs ?? 50)

    this.video = document.createElement('video')
    this.video.muted = true
    this.video.playsInline = true
    this.video.preload = 'auto'
    this.video.disablePictureInPicture = true
    this.video.setAttribute('aria-hidden', 'true')

    this.audio = document.createElement('audio')
    this.audio.preload = 'none'
    this.audio.setAttribute('aria-hidden', 'true')

    this.videoView = new Video({
      width: '100%',
      height: '100%',
      src: this.video,
      objectFit: 'fill',
      muted: true,
      autoplay: false,
      pointerEvents: 'none',
    })
    this.root = new Container({
      width: STUDY_PANEL_WIDTH_PX,
      height: STUDY_PANEL_HEIGHT_PX,
      pixelSize: STUDY_PANEL_PIXEL_SIZE_METERS,
      overflow: 'hidden',
      backgroundColor: '#000000',
      borderRadius: 28,
      pointerEvents: 'auto',
      cursor: 'pointer',
      onClick: () => this.options.onToggleRequest?.(this.snapshot()),
    })
    this.root.name = 'study6-media-surface'
    this.root.visible = false
    this.root.add(this.videoView)

    this.video.addEventListener('loadedmetadata', () => this.applyPendingPosition())
    this.audio.addEventListener('loadedmetadata', () => this.applyPendingPosition())
    this.video.addEventListener('error', () => {
      this.fail(
        this.makeFailure(
          'playback',
          'playback_failed',
          'The placeholder video could not be loaded.',
          true,
        ),
      )
    })
  }

  load(assignment: StudyMediaAssignment, positionMs = 0): StudyMediaSnapshot {
    if (this.disposed) {
      throw this.makeError(
        this.makeFailure('prepare', 'disposed', 'The stimulus provider has been disposed.', false),
      )
    }
    if (!validAssignment(assignment)) {
      throw this.makeError(
        this.makeFailure('prepare', 'invalid_assignment', 'The media assignment is incomplete.', false),
      )
    }

    this.scheduleGeneration += 1
    this.cancelActivePlayback()
    this.preparationAbort?.abort()
    this.preparationAbort = new AbortController()
    const generation = ++this.preparationGeneration
    this.assignment = { ...assignment }
    this.pendingPositionSeconds = Math.max(0, Math.min(assignment.durationMs, positionMs)) / 1_000
    this.preparedAudio = null
    this.lastStart = null
    this.error = null
    this.failure = null
    this.lastProgressAt = -Infinity
    this.phase = positionMs >= assignment.durationMs ? 'ended' : 'preparing'
    this.root.visible = true

    const urls = mediaAssetUrls(assignment)
    this.video.src = urls.video
    this.audio.src = urls.audio
    this.video.load()
    this.applyPendingPosition()

    this.preparation = this.decodeAudio(
      generation,
      { ...assignment },
      urls.audio,
      this.preparationAbort.signal,
    )
    void this.preparation.then((outcome) => {
      if (generation !== this.preparationGeneration || this.disposed) return
      if (outcome.ok) {
        this.preparedAudio = outcome.prepared
        if (this.phase === 'preparing') this.phase = positionMs > 0 ? 'paused' : 'ready'
      } else if (outcome.error.failure.code !== 'preparation_superseded') {
        this.fail(outcome.error.failure)
      }
    })
    return this.snapshot()
  }

  async prepare(
    assignment: StudyMediaAssignment,
    positionMs = 0,
  ): Promise<StimulusPreparationReceipt> {
    this.load(assignment, positionMs)
    const prepared = await this.requirePreparedAudio()
    return { ...prepared.receipt, assignment: { ...prepared.receipt.assignment } }
  }

  async play(): Promise<StudyMediaSnapshot> {
    if (!this.assignment) {
      throw this.makeError(
        this.makeFailure('schedule', 'no_assignment', 'No Study 6 media assignment is loaded.', false),
      )
    }
    if (this.phase === 'ended') return this.snapshot()
    await this.scheduleStart()
    return this.snapshot()
  }

  async scheduleStart(request: StimulusStartRequest = {}): Promise<StimulusStartReceipt> {
    if (this.disposed) {
      throw this.makeError(
        this.makeFailure('schedule', 'disposed', 'The stimulus provider has been disposed.', false),
      )
    }
    if (!this.assignment) {
      throw this.makeError(
        this.makeFailure('schedule', 'no_assignment', 'No Study 6 media assignment is loaded.', false),
      )
    }
    if (this.activePlayback && this.lastStart) return this.cloneStartReceipt(this.lastStart)
    const scheduleToken = ++this.scheduleGeneration

    const context = this.requireAudioContext()
    try {
      if (context.state !== 'running') await context.resume()
    } catch (cause) {
      const failure = this.makeFailure(
        'schedule',
        'local_gesture_required',
        'Browser media playback requires a local user gesture.',
        true,
      )
      this.pauseAfterScheduleFailure(failure)
      throw this.makeError(failure, cause)
    }
    if (context.state !== 'running') {
      const failure = this.makeFailure(
        'schedule',
        'local_gesture_required',
        'Browser media playback requires a local user gesture.',
        true,
      )
      this.pauseAfterScheduleFailure(failure)
      throw this.makeError(failure)
    }
    const prepared = await this.requirePreparedAudio()
    if (scheduleToken !== this.scheduleGeneration || this.disposed) {
      throw this.makeError(
        this.makeFailure(
          'schedule',
          'schedule_cancelled',
          'The pending stimulus schedule was cancelled.',
          true,
        ),
      )
    }

    const now = this.performanceNow()
    const requestedStartAtPerformanceMs =
      request.startAtPerformanceMs ?? now + this.minimumScheduleLeadMs
    const maxLatenessMs = request.maxLatenessMs ?? this.defaultMaxLatenessMs
    const requestedPositionMs = request.positionMs ?? this.pendingPositionSeconds * 1_000
    if (
      !Number.isFinite(requestedStartAtPerformanceMs) ||
      !Number.isFinite(maxLatenessMs) ||
      maxLatenessMs < 0 ||
      !Number.isFinite(requestedPositionMs) ||
      requestedPositionMs < 0 ||
      requestedPositionMs >= this.assignment.durationMs
    ) {
      const failure = this.makeFailure(
        'schedule',
        'invalid_schedule',
        'The requested stimulus start time or position is invalid.',
        false,
      )
      this.pauseAfterScheduleFailure(failure)
      throw this.makeError(failure)
    }
    const latenessMs = now - requestedStartAtPerformanceMs
    if (latenessMs > maxLatenessMs) {
      const failure = this.makeFailure(
        'schedule',
        'schedule_missed',
        `The stimulus start deadline was missed by ${latenessMs.toFixed(1)} ms.`,
        true,
        request.clockUncertainty ?? null,
      )
      this.pauseAfterScheduleFailure(failure)
      throw this.makeError(failure)
    }

    const audioClock = captureAudioClockEvidence(context, this.performanceNow)
    const mappedContextSeconds =
      audioClock.contextTimeSeconds +
      (requestedStartAtPerformanceMs - audioClock.performanceTimeMs) / 1_000
    const earliestContextSeconds = context.currentTime + 0.005
    const scheduledStartAtContextSeconds = Math.max(mappedContextSeconds, earliestContextSeconds)
    const scheduleAdjustmentMs = Math.max(
      0,
      (scheduledStartAtContextSeconds - mappedContextSeconds) * 1_000,
    )
    const scheduledStartAtPerformanceMs =
      audioClock.performanceTimeMs +
      (scheduledStartAtContextSeconds - audioClock.contextTimeSeconds) * 1_000
    const startUncertainty = combineUncertainty(
      audioClock.uncertainty,
      request.clockUncertainty,
      scheduleAdjustmentMs,
    )

    const offsetSeconds = requestedPositionMs / 1_000
    const remainingAssignmentSeconds = this.assignment.durationMs / 1_000 - offsetSeconds
    const remainingDecodedSeconds = prepared.buffer.duration - offsetSeconds
    const durationSeconds = Math.min(remainingAssignmentSeconds, remainingDecodedSeconds)
    if (!(durationSeconds > 0)) {
      const failure = this.makeFailure(
        'schedule',
        'invalid_schedule',
        'The decoded audio has no samples at the requested media position.',
        false,
      )
      this.pauseAfterScheduleFailure(failure)
      throw this.makeError(failure)
    }

    this.cancelActivePlayback()
    const source = context.createBufferSource()
    source.buffer = prepared.buffer
    source.connect(context.destination)
    const token = ++this.playbackGeneration
    const barrierId = request.barrierId?.trim() || null
    const delayMs = Math.max(0, scheduledStartAtPerformanceMs - this.performanceNow())
    const videoTimer = setTimeout(() => this.startVideo(token, barrierId), delayMs)
    this.activePlayback = {
      source,
      token,
      startContextSeconds: scheduledStartAtContextSeconds,
      startPerformanceMs: scheduledStartAtPerformanceMs,
      offsetSeconds,
      durationSeconds,
      videoTimer,
      barrierId,
    }
    source.onended = () => this.finishPlayback(token, barrierId)
    source.start(scheduledStartAtContextSeconds, offsetSeconds, durationSeconds)
    this.pendingPositionSeconds = offsetSeconds
    this.phase = 'playing'
    this.error = null
    this.failure = null

    const receipt: StimulusStartReceipt = {
      providerId: this.providerId,
      barrierId,
      requestedStartAtPerformanceMs,
      scheduledStartAtPerformanceMs,
      scheduledStartAtContextSeconds,
      positionMs: requestedPositionMs,
      audioClock,
      startUncertainty,
      physicalOutputUncertainty: { ...audioClock.physicalOutputUncertainty },
      evidenceScope: 'browser-audio-scheduled',
    }
    this.lastStart = receipt
    this.options.onEffect?.({
      providerId: this.providerId,
      effect: 'audio_scheduled',
      barrierId,
      observedAtPerformanceMs: this.performanceNow(),
      start: this.cloneStartReceipt(receipt),
    })
    return this.cloneStartReceipt(receipt)
  }

  async resume(request: Omit<StimulusStartRequest, 'positionMs'> = {}): Promise<StimulusStartReceipt> {
    return this.scheduleStart({ ...request, positionMs: this.pendingPositionSeconds * 1_000 })
  }

  pause(): StudyMediaSnapshot {
    this.scheduleGeneration += 1
    this.capturePlaybackPosition()
    this.cancelActivePlayback()
    this.pauseElements()
    if (this.phase !== 'idle' && this.phase !== 'ended' && this.phase !== 'error') {
      this.phase = 'paused'
    }
    return this.snapshot()
  }

  stop(): StudyMediaSnapshot {
    this.scheduleGeneration += 1
    this.cancelActivePlayback()
    this.pauseElements()
    this.pendingPositionSeconds = 0
    this.applyPendingPosition()
    if (this.assignment) this.phase = 'ready'
    return this.snapshot()
  }

  hide(): void {
    this.root.visible = false
  }

  show(): void {
    if (this.assignment) this.root.visible = true
  }

  update(timeMilliseconds: number): StudyMediaSnapshot {
    if (!this.assignment) return this.snapshot()
    this.capturePlaybackPosition()
    const durationSeconds = this.assignment.durationMs / 1_000
    const canonicalSeconds = Math.max(0, Math.min(durationSeconds, this.pendingPositionSeconds))

    if (
      this.phase === 'playing' &&
      this.activePlayback &&
      this.audioContext &&
      this.audioContext.currentTime >= this.activePlayback.startContextSeconds &&
      Number.isFinite(this.video.currentTime) &&
      Math.abs(this.video.currentTime - canonicalSeconds) > 0.25
    ) {
      this.video.currentTime = canonicalSeconds
    }

    if (this.phase === 'playing' && canonicalSeconds * 1_000 >= this.assignment.durationMs - 20) {
      this.finishPlayback(this.activePlayback?.token ?? this.playbackGeneration, this.activePlayback?.barrierId ?? null)
      return this.snapshot()
    }

    if (timeMilliseconds - this.lastProgressAt >= 500) {
      this.lastProgressAt = timeMilliseconds
      this.options.onProgress?.(this.snapshot())
    }
    return this.snapshot()
  }

  snapshot(): StudyMediaSnapshot {
    return {
      phase: this.phase,
      positionMs: Math.round(this.pendingPositionSeconds * 1_000),
      durationMs: this.assignment?.durationMs ?? 0,
      assignment: this.assignment ? { ...this.assignment } : null,
      error: this.error,
      failure: cloneFailure(this.failure),
    }
  }

  lastStartReceipt(): StimulusStartReceipt | null {
    return this.lastStart ? this.cloneStartReceipt(this.lastStart) : null
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.scheduleGeneration += 1
    this.preparationAbort?.abort()
    this.cancelActivePlayback()
    this.pauseElements()
    this.video.removeAttribute('src')
    this.audio.removeAttribute('src')
    this.video.load()
    this.audio.load()
    if (this.audioContext && this.audioContext.state !== 'closed') void this.audioContext.close()
    this.audioContext = null
    this.videoView.dispose()
    this.root.dispose()
  }

  private async decodeAudio(
    generation: number,
    assignment: StimulusAssignment,
    url: string,
    signal: AbortSignal,
  ): Promise<PreparationOutcome> {
    let context: AudioContext
    try {
      context = this.requireAudioContext()
    } catch (cause) {
      return {
        ok: false,
        error: this.makeError(
          this.makeFailure(
            'prepare',
            'audio_context_unavailable',
            'Web Audio is unavailable in this browser.',
            false,
          ),
          cause,
        ),
      }
    }

    let bytes: ArrayBuffer
    try {
      const response = await this.fetchAudio(url, { signal })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      bytes = await response.arrayBuffer()
    } catch (cause) {
      if (generation !== this.preparationGeneration || signal.aborted) {
        return {
          ok: false,
          error: this.makeError(
            this.makeFailure(
              'prepare',
              'preparation_superseded',
              'Media preparation was superseded by a newer assignment.',
              true,
            ),
            cause,
          ),
        }
      }
      return {
        ok: false,
        error: this.makeError(
          this.makeFailure(
            'prepare',
            'audio_fetch_failed',
            'The guided audio could not be fetched.',
            true,
          ),
          cause,
        ),
      }
    }

    let buffer: AudioBuffer
    try {
      buffer = await context.decodeAudioData(bytes.slice(0))
    } catch (cause) {
      return {
        ok: false,
        error: this.makeError(
          this.makeFailure(
            'prepare',
            'audio_decode_failed',
            'The guided audio could not be decoded by Web Audio.',
            false,
          ),
          cause,
        ),
      }
    }
    if (generation !== this.preparationGeneration || signal.aborted) {
      return {
        ok: false,
        error: this.makeError(
          this.makeFailure(
            'prepare',
            'preparation_superseded',
            'Media preparation was superseded by a newer assignment.',
            true,
          ),
        ),
      }
    }
    const decodedAudioDurationMs = buffer.duration * 1_000
    if (!Number.isFinite(decodedAudioDurationMs) || decodedAudioDurationMs + 50 < assignment.durationMs) {
      return {
        ok: false,
        error: this.makeError(
          this.makeFailure(
            'prepare',
            'decoded_audio_too_short',
            'The decoded audio is shorter than the assigned stimulus duration.',
            false,
          ),
        ),
      }
    }

    return {
      ok: true,
      prepared: {
        buffer,
        receipt: {
          providerId: this.providerId,
          assignment: { ...assignment },
          preparedAtPerformanceMs: this.performanceNow(),
          decodedAudioDurationMs,
          requestedDurationMs: assignment.durationMs,
        },
      },
    }
  }

  private async requirePreparedAudio(): Promise<PreparedAudio> {
    if (this.preparedAudio) return this.preparedAudio
    if (!this.preparation) {
      throw this.makeError(
        this.makeFailure('prepare', 'no_assignment', 'No Study 6 media assignment is loaded.', false),
      )
    }
    const outcome = await this.preparation
    if (!outcome.ok) throw outcome.error
    this.preparedAudio = outcome.prepared
    return outcome.prepared
  }

  private requireAudioContext(): AudioContext {
    if (!this.audioContext) this.audioContext = this.createAudioContext()
    return this.audioContext
  }

  private startVideo(token: number, barrierId: string | null): void {
    const active = this.activePlayback
    if (!active || active.token !== token || this.phase !== 'playing') return
    active.videoTimer = null
    this.capturePlaybackPosition()
    this.applyPendingPosition()
    const videoFrameCallback = (this.video as unknown as OptionalVideoFrameCallback)
      .requestVideoFrameCallback
    videoFrameCallback?.call(this.video, (now, metadata) => {
      if (this.playbackGeneration !== token) return
      this.options.onEffect?.({
        providerId: this.providerId,
        effect: 'video_first_frame',
        barrierId,
        observedAtPerformanceMs: now,
        mediaTimeMs: metadata.mediaTime * 1_000,
        expectedDisplayTimeMs:
          metadata.expectedDisplayTime === undefined ? null : metadata.expectedDisplayTime,
        evidenceScope: 'browser-video-frame-callback',
      })
    })
    void this.video.play().catch((cause) => {
      if (this.playbackGeneration !== token) return
      this.fail(
        this.makeFailure(
          'playback',
          'playback_failed',
          'The placeholder video could not start.',
          true,
        ),
        cause,
      )
    })
  }

  private capturePlaybackPosition(): void {
    const active = this.activePlayback
    const context = this.audioContext
    if (!active || !context) return
    const elapsedSeconds = Math.max(0, context.currentTime - active.startContextSeconds)
    this.pendingPositionSeconds = Math.min(
      active.offsetSeconds + active.durationSeconds,
      active.offsetSeconds + elapsedSeconds,
    )
  }

  private finishPlayback(token: number, barrierId: string | null): void {
    const active = this.activePlayback
    if (!active || active.token !== token || this.phase !== 'playing') return
    this.pendingPositionSeconds = Math.min(
      this.assignment?.durationMs ? this.assignment.durationMs / 1_000 : Infinity,
      active.offsetSeconds + active.durationSeconds,
    )
    this.cancelActivePlayback()
    this.pauseElements()
    this.phase = 'ended'
    const snapshot = this.snapshot()
    this.options.onProgress?.(snapshot)
    this.options.onEnded?.(snapshot)
    this.options.onEffect?.({
      providerId: this.providerId,
      effect: 'playback_ended',
      barrierId,
      observedAtPerformanceMs: this.performanceNow(),
      evidenceScope: 'browser-playback-state',
    })
  }

  private cancelActivePlayback(): void {
    const active = this.activePlayback
    this.activePlayback = null
    this.playbackGeneration += 1
    if (!active) return
    if (active.videoTimer !== null) clearTimeout(active.videoTimer)
    active.source.onended = null
    try {
      active.source.stop()
    } catch {
      // A source that has already ended is already in the required stopped state.
    }
    active.source.disconnect()
  }

  private pauseAfterScheduleFailure(failure: StimulusFailure): void {
    this.cancelActivePlayback()
    this.pauseElements()
    this.phase = 'paused'
    this.error = failure.message
    this.failure = failure
  }

  private pauseElements(): void {
    this.video.pause()
    this.audio.pause()
  }

  private applyPendingPosition(): void {
    if (!this.assignment) return
    const upper = this.assignment.durationMs / 1_000
    const position = Math.max(0, Math.min(upper, this.pendingPositionSeconds))
    try {
      this.video.currentTime = position
    } catch {
      // Metadata has not loaded; loadedmetadata will apply the retained position.
    }
    try {
      this.audio.currentTime = position
    } catch {
      // Compatibility-only element; decoded Web Audio remains authoritative.
    }
  }

  private fail(failure: StimulusFailure, _cause?: unknown): void {
    if (!this.assignment) return
    this.cancelActivePlayback()
    this.pauseElements()
    this.phase = 'error'
    this.error = failure.message
    this.failure = failure
    this.options.onError?.(this.snapshot())
  }

  private makeFailure(
    stage: StimulusFailure['stage'],
    code: StimulusFailure['code'],
    message: string,
    retryable: boolean,
    uncertainty: TimingUncertainty | null = null,
  ): StimulusFailure {
    return { stage, code, message, retryable, uncertainty }
  }

  private makeError(failure: StimulusFailure, cause?: unknown): StimulusProviderError {
    return new StimulusProviderError(failure, cause)
  }

  private cloneStartReceipt(receipt: StimulusStartReceipt): StimulusStartReceipt {
    return {
      ...receipt,
      audioClock: {
        ...receipt.audioClock,
        uncertainty: { ...receipt.audioClock.uncertainty },
        physicalOutputUncertainty: { ...receipt.audioClock.physicalOutputUncertainty },
      },
      startUncertainty: { ...receipt.startUncertainty },
      physicalOutputUncertainty: { ...receipt.physicalOutputUncertainty },
    }
  }
}

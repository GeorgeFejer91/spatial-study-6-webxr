import { Container, Video } from '@pmndrs/uikit'

import {
  STUDY_PANEL_HEIGHT_PX,
  STUDY_PANEL_PIXEL_SIZE_METERS,
  STUDY_PANEL_WIDTH_PX,
} from '../ui/constants.ts'

export interface StudyMediaAssignment {
  videoFile: string
  audioFile: string
  durationMs: number
}

export interface StudyMediaSnapshot {
  phase: 'idle' | 'ready' | 'playing' | 'paused' | 'ended' | 'error'
  positionMs: number
  durationMs: number
  assignment: StudyMediaAssignment | null
  error: string | null
}

export interface StudyMediaPlayerOptions {
  onProgress?: (snapshot: StudyMediaSnapshot) => void
  onEnded?: (snapshot: StudyMediaSnapshot) => void
  onError?: (snapshot: StudyMediaSnapshot) => void
  onToggleRequest?: (snapshot: StudyMediaSnapshot) => void
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

export class StudyMediaPlayer {
  readonly root: Container
  readonly video: HTMLVideoElement
  readonly audio: HTMLAudioElement

  private readonly videoView: Video
  private readonly options: StudyMediaPlayerOptions
  private assignment: StudyMediaAssignment | null = null
  private phase: StudyMediaSnapshot['phase'] = 'idle'
  private error: string | null = null
  private lastProgressAt = -Infinity
  private pendingPositionSeconds = 0

  constructor(options: StudyMediaPlayerOptions = {}) {
    this.options = options
    this.video = document.createElement('video')
    this.video.muted = true
    this.video.playsInline = true
    this.video.preload = 'auto'
    this.video.disablePictureInPicture = true
    this.video.setAttribute('aria-hidden', 'true')

    this.audio = document.createElement('audio')
    this.audio.preload = 'auto'
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

    const applyPendingPosition = () => {
      if (!this.assignment) return
      const upper = this.assignment.durationMs / 1_000
      const position = Math.max(0, Math.min(upper, this.pendingPositionSeconds))
      this.video.currentTime = position
      this.audio.currentTime = position
    }
    this.video.addEventListener('loadedmetadata', applyPendingPosition)
    this.audio.addEventListener('loadedmetadata', applyPendingPosition)
    this.video.addEventListener('error', () => this.fail('The placeholder video could not be loaded.'))
    this.audio.addEventListener('error', () => this.fail('The guided audio could not be loaded.'))
  }

  load(assignment: StudyMediaAssignment, positionMs = 0): StudyMediaSnapshot {
    this.pauseElements()
    this.assignment = { ...assignment }
    this.pendingPositionSeconds = Math.max(0, Math.min(assignment.durationMs, positionMs)) / 1_000
    const urls = mediaAssetUrls(assignment)
    this.video.src = urls.video
    this.audio.src = urls.audio
    this.video.load()
    this.audio.load()
    this.phase = positionMs >= assignment.durationMs ? 'ended' : positionMs > 0 ? 'paused' : 'ready'
    this.error = null
    this.lastProgressAt = -Infinity
    this.root.visible = true
    return this.snapshot()
  }

  async play(): Promise<StudyMediaSnapshot> {
    if (!this.assignment) throw new Error('No Study 6 media assignment is loaded.')
    if (this.phase === 'ended') return this.snapshot()
    try {
      await Promise.all([this.video.play(), this.audio.play()])
      this.phase = 'playing'
      this.error = null
      return this.snapshot()
    } catch (error) {
      this.pauseElements()
      this.phase = 'paused'
      this.error = error instanceof Error ? error.message : String(error)
      throw new Error('Browser media playback requires a local user gesture.', { cause: error })
    }
  }

  pause(): StudyMediaSnapshot {
    this.pauseElements()
    if (this.phase !== 'idle' && this.phase !== 'ended') this.phase = 'paused'
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
    const durationSeconds = this.assignment.durationMs / 1_000
    const canonicalSeconds = Math.max(
      0,
      Math.min(durationSeconds, Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0),
    )
    this.pendingPositionSeconds = canonicalSeconds

    if (
      this.phase === 'playing' &&
      Number.isFinite(this.video.currentTime) &&
      Math.abs(this.video.currentTime - canonicalSeconds) > 0.25
    ) {
      this.video.currentTime = canonicalSeconds
    }

    if (this.phase === 'playing' && canonicalSeconds * 1_000 >= this.assignment.durationMs - 20) {
      this.pauseElements()
      this.phase = 'ended'
      this.pendingPositionSeconds = durationSeconds
      const snapshot = this.snapshot()
      this.options.onProgress?.(snapshot)
      this.options.onEnded?.(snapshot)
      return snapshot
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
    }
  }

  dispose(): void {
    this.pauseElements()
    this.video.removeAttribute('src')
    this.audio.removeAttribute('src')
    this.video.load()
    this.audio.load()
    this.videoView.dispose()
    this.root.dispose()
  }

  private pauseElements(): void {
    this.video.pause()
    this.audio.pause()
  }

  private fail(message: string): void {
    if (!this.assignment) return
    this.pauseElements()
    this.phase = 'error'
    this.error = message
    this.options.onError?.(this.snapshot())
  }
}

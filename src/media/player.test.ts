import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { captureAudioClockEvidence, StudyMediaPlayer } from './player.ts'
import { StimulusProviderError } from './stimulus-provider.ts'

class FakeBufferSource {
  buffer: AudioBuffer | null = null
  onended: (() => void) | null = null
  readonly start = vi.fn()
  readonly stop = vi.fn()
  readonly connect = vi.fn()
  readonly disconnect = vi.fn()
}

class FakeAudioContext {
  state: AudioContextState = 'suspended'
  currentTime = 10
  readonly destination = {}
  readonly sources: FakeBufferSource[] = []
  readonly resume = vi.fn(async () => {
    this.state = 'running'
  })
  readonly close = vi.fn(async () => {
    this.state = 'closed'
  })
  readonly decodeAudioData = vi.fn(async () => ({ duration: 20 }) as AudioBuffer)

  getOutputTimestamp(): AudioTimestamp {
    return { contextTime: 10, performanceTime: 1_000 }
  }

  createBufferSource(): AudioBufferSourceNode {
    const source = new FakeBufferSource()
    this.sources.push(source)
    return source as unknown as AudioBufferSourceNode
  }
}

function audioResponse(): Promise<Response> {
  return Promise.resolve({
    ok: true,
    status: 200,
    arrayBuffer: async () => new ArrayBuffer(8),
  } as Response)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('captureAudioClockEvidence', () => {
  it('retains getOutputTimestamp correlation while limiting its evidence scope', () => {
    const readings = [1_000, 1_000.4]
    const evidence = captureAudioClockEvidence(
      {
        currentTime: 10.1,
        getOutputTimestamp: () => ({ contextTime: 10, performanceTime: 995 }),
      },
      () => readings.shift() ?? 1_000.4,
    )

    expect(evidence).toMatchObject({
      method: 'getOutputTimestamp',
      contextTimeSeconds: 10,
      performanceTimeMs: 995,
      uncertainty: {
        kind: 'estimated',
        scope: 'browser-clock-correlation-only',
      },
      physicalOutputUncertainty: {
        kind: 'unknown',
        scope: 'physical-output-not-observed',
      },
    })
    expect(evidence.method === 'getOutputTimestamp' ? evidence.captureSpanMs : Number.NaN).toBeCloseTo(
      0.4,
      6,
    )
  })

  it('makes missing output-timestamp uncertainty explicit', () => {
    const evidence = captureAudioClockEvidence({ currentTime: 4 }, () => 500)

    expect(evidence).toMatchObject({
      method: 'currentTime-fallback',
      reason: 'unsupported',
      uncertainty: { kind: 'unknown', scope: 'physical-output-not-observed' },
    })
  })

  it('rejects the zero timestamp some browsers expose before the output clock is live', () => {
    const evidence = captureAudioClockEvidence(
      { currentTime: 0, getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }) },
      () => 100_000,
    )

    expect(evidence).toMatchObject({
      method: 'currentTime-fallback',
      reason: 'invalid-result',
      uncertainty: { kind: 'unknown' },
    })
  })
})

describe('StudyMediaPlayer Web Audio provider', () => {
  it('decodes audio and schedules its source against a future performance-clock T0', async () => {
    const context = new FakeAudioContext()
    const effects = vi.fn()
    const player = new StudyMediaPlayer({
      createAudioContext: () => context as unknown as AudioContext,
      fetchAudio: vi.fn(audioResponse),
      performanceNow: () => 1_000,
      onEffect: effects,
    })

    const preparation = await player.prepare(
      { videoFile: 'placeholder.mp4', audioFile: 'guidance.mp3', durationMs: 10_000 },
      0,
    )
    const start = await player.scheduleStart({
      barrierId: 'barrier-1',
      startAtPerformanceMs: 1_200,
      maxLatenessMs: 20,
      clockUncertainty: {
        kind: 'estimated',
        milliseconds: 5,
        basis: 'test clock fit',
        scope: 'browser-clock-correlation-only',
      },
    })

    expect(preparation).toMatchObject({
      providerId: 'placeholder.v1',
      decodedAudioDurationMs: 20_000,
    })
    expect(context.resume).toHaveBeenCalledOnce()
    expect(context.sources).toHaveLength(1)
    expect(context.sources[0]!.start).toHaveBeenCalledWith(10.2, 0, 10)
    expect(start).toMatchObject({
      barrierId: 'barrier-1',
      requestedStartAtPerformanceMs: 1_200,
      scheduledStartAtContextSeconds: 10.2,
      audioClock: { method: 'getOutputTimestamp' },
      evidenceScope: 'browser-audio-scheduled',
    })
    expect(start.startUncertainty).toMatchObject({
      kind: 'estimated',
      scope: 'browser-clock-correlation-only',
    })
    expect(player.snapshot()).toMatchObject({ phase: 'playing', positionMs: 0 })
    expect(effects).toHaveBeenCalledWith(
      expect.objectContaining({ effect: 'audio_scheduled', barrierId: 'barrier-1' }),
    )

    player.dispose()
  })

  it('returns an explicit schedule_missed failure instead of starting late', async () => {
    const context = new FakeAudioContext()
    const player = new StudyMediaPlayer({
      createAudioContext: () => context as unknown as AudioContext,
      fetchAudio: vi.fn(audioResponse),
      performanceNow: () => 2_000,
    })
    await player.prepare(
      { videoFile: 'placeholder.mp4', audioFile: 'guidance.mp3', durationMs: 10_000 },
      0,
    )

    const failure = await player
      .scheduleStart({ startAtPerformanceMs: 1_900, maxLatenessMs: 50 })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(StimulusProviderError)
    expect((failure as StimulusProviderError).failure).toMatchObject({
      stage: 'schedule',
      code: 'schedule_missed',
      retryable: true,
    })
    expect(context.sources).toHaveLength(0)
    expect(player.snapshot()).toMatchObject({
      phase: 'paused',
      failure: { code: 'schedule_missed' },
    })

    player.dispose()
  })
})

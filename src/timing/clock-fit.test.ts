import { describe, expect, it } from 'vitest'

import {
  fitClockModel,
  localToRemoteTime,
  remoteToLocalTime,
  type ClockProbeSample,
} from './clock-fit.ts'

function probe(localMidpointMs: number, rate = 1.00005, offsetMs = 500): ClockProbeSample {
  const remoteMidpointMs = offsetMs + rate * localMidpointMs
  return {
    localSendMs: localMidpointMs - 5,
    remoteReceiveMs: remoteMidpointMs - 1,
    remoteSendMs: remoteMidpointMs + 1,
    localReceiveMs: localMidpointMs + 5,
  }
}

describe('fitClockModel', () => {
  it('recovers offset and drift from stable four-timestamp probes', () => {
    const result = fitClockModel([probe(0), probe(1_000), probe(2_000), probe(3_000), probe(4_000)])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.driftPpm).toBeCloseTo(50, 6)
    expect(result.model.estimatedUncertaintyMs).toBeCloseTo(4, 6)
    expect(localToRemoteTime(result.model, 2_500)).toBeCloseTo(3_000.125, 6)
    expect(remoteToLocalTime(result.model, 3_000.125)).toBeCloseTo(2_500, 6)
  })

  it('fails closed on an impossible timestamp order', () => {
    const samples = [probe(0), probe(1_000), probe(2_000), probe(3_000)]
    samples[2] = {
      localSendMs: 2_000,
      remoteReceiveMs: 2_500,
      remoteSendMs: 2_520,
      localReceiveMs: 2_010,
    }

    const result = fitClockModel(samples)

    expect(result).toMatchObject({
      ok: false,
      failure: { code: 'invalid_sample', sampleIndex: 2 },
    })
  })

  it('reports excessive uncertainty instead of claiming synchronization', () => {
    const samples = [0, 1_000, 2_000, 3_000].map((localMidpointMs) => {
      const remoteMidpointMs = 500 + localMidpointMs
      return {
        localSendMs: localMidpointMs - 100,
        remoteReceiveMs: remoteMidpointMs,
        remoteSendMs: remoteMidpointMs,
        localReceiveMs: localMidpointMs + 100,
      }
    })

    const result = fitClockModel(samples, { maxEstimatedUncertaintyMs: 50 })

    expect(result).toMatchObject({
      ok: false,
      failure: { code: 'excessive_uncertainty', observed: 100, limit: 50 },
    })
  })
})

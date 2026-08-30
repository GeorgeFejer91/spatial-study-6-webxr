import { describe, expect, it } from 'vitest'

import type { ClockFitResult, ClockModel } from './clock-fit.ts'
import { createStartBarrier, transitionStartBarrier } from './start-barrier.ts'

function clockFit(uncertaintyMs = 5): ClockFitResult {
  const model: ClockModel = {
    kind: 'affine-clock-model.v1',
    localReferenceMs: 0,
    remoteReferenceMs: 500,
    rate: 1,
    driftPpm: 0,
    sampleCount: 8,
    usedSampleCount: 6,
    localSpanMs: 4_000,
    medianRoundTripMs: 8,
    p95RoundTripMs: 10,
    rmsResidualMs: 0,
    maxResidualMs: 0,
    estimatedUncertaintyMs: uncertaintyMs,
    uncertaintyBasis: 'half-p95-round-trip-plus-max-fit-residual',
  }
  return { ok: true, model }
}

function plannedBarrier() {
  const result = createStartBarrier({
    barrierId: 'barrier-1',
    requiredOwners: ['stimulus', 'ecg'],
    clockFit: clockFit(),
    nowLocalPerformanceMs: 0,
    targetRemoteMs: 2_000,
    minimumLeadMs: 1_000,
    commitSafetyMs: 200,
    observationTimeoutMs: 500,
  })
  if (!result.ok) throw new Error(result.failure.message)
  return result.state
}

describe('start barrier reducer', () => {
  it('requires both prepared owners, commit, and both observed effects', () => {
    let state = plannedBarrier()
    let result = transitionStartBarrier(state, {
      type: 'owner_prepared',
      barrierId: 'barrier-1',
      owner: 'stimulus',
      receipt: { receiptId: 'prepare-media', ownerEpoch: 'web-1', preparedAtRemoteMs: 1_000 },
    })
    expect(result.ok).toBe(true)
    state = result.state
    expect(state.phase).toBe('preparing')

    result = transitionStartBarrier(state, {
      type: 'owner_prepared',
      barrierId: 'barrier-1',
      owner: 'ecg',
      receipt: { receiptId: 'prepare-ecg', ownerEpoch: 'apk-1', preparedAtRemoteMs: 1_100 },
    })
    state = result.state
    expect(state.phase).toBe('prepared')

    result = transitionStartBarrier(state, {
      type: 'commit',
      barrierId: 'barrier-1',
      committedAtRemoteMs: 1_200,
    })
    state = result.state
    expect(state.phase).toBe('committed')

    result = transitionStartBarrier(state, {
      type: 'effect_observed',
      barrierId: 'barrier-1',
      owner: 'stimulus',
      receipt: {
        receiptId: 'effect-media',
        ownerEpoch: 'web-1',
        observedAtRemoteMs: 2_010,
        effectAtRemoteMs: 2_000,
        estimatedUncertaintyMs: 6,
        evidenceScope: 'browser-audio-scheduled',
      },
    })
    state = result.state
    expect(state.phase).toBe('committed')

    result = transitionStartBarrier(state, {
      type: 'effect_observed',
      barrierId: 'barrier-1',
      owner: 'ecg',
      receipt: {
        receiptId: 'effect-ecg',
        ownerEpoch: 'apk-1',
        observedAtRemoteMs: 2_020,
        effectAtRemoteMs: 2_001,
        estimatedUncertaintyMs: 4,
        evidenceScope: 'sensor-samples-bracketing-t0',
      },
    })

    expect(result.ok).toBe(true)
    expect(result.state.phase).toBe('observed')
    expect(result.state.owners.ecg?.effect?.effectAtRemoteMs).toBe(2_001)
  })

  it('rejects commit before every owner is prepared without mutating state', () => {
    const initial = plannedBarrier()
    const result = transitionStartBarrier(initial, {
      type: 'commit',
      barrierId: 'barrier-1',
      committedAtRemoteMs: 1_200,
    })

    expect(result).toMatchObject({
      ok: false,
      failure: { code: 'commit_before_ready' },
      state: { phase: 'preparing' },
    })
    expect(initial.phase).toBe('preparing')
  })

  it('marks a committed barrier outcome unknown when an effect receipt never arrives', () => {
    let state = plannedBarrier()
    for (const [owner, receiptId, ownerEpoch] of [
      ['stimulus', 'prepare-media', 'web-1'],
      ['ecg', 'prepare-ecg', 'apk-1'],
    ] as const) {
      const result = transitionStartBarrier(state, {
        type: 'owner_prepared',
        barrierId: 'barrier-1',
        owner,
        receipt: { receiptId, ownerEpoch, preparedAtRemoteMs: 1_000 },
      })
      state = result.state
    }
    state = transitionStartBarrier(state, {
      type: 'commit',
      barrierId: 'barrier-1',
      committedAtRemoteMs: 1_200,
    }).state

    const result = transitionStartBarrier(state, {
      type: 'tick',
      barrierId: 'barrier-1',
      nowRemoteMs: 2_501,
    })

    expect(result).toMatchObject({
      ok: true,
      state: { phase: 'failed', failure: { code: 'effect_outcome_unknown' } },
    })
  })

  it('refuses to plan with clock uncertainty above the barrier limit', () => {
    const result = createStartBarrier({
      barrierId: 'barrier-uncertain',
      requiredOwners: ['stimulus', 'ecg'],
      clockFit: clockFit(25),
      nowLocalPerformanceMs: 0,
      targetRemoteMs: 2_000,
      maxClockUncertaintyMs: 20,
    })

    expect(result).toMatchObject({
      ok: false,
      failure: { code: 'clock_uncertain', observed: 25, limit: 20 },
    })
  })
})

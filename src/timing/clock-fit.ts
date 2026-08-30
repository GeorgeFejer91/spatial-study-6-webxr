/** Four monotonic timestamps from one NTP-style browser/bridge clock probe. */
export interface ClockProbeSample {
  localSendMs: number
  remoteReceiveMs: number
  remoteSendMs: number
  localReceiveMs: number
}

export interface ClockFitOptions {
  minSamples?: number
  minLocalSpanMs?: number
  maxRoundTripMs?: number
  lowLatencySlackMs?: number
  maxAbsoluteDriftPpm?: number
  maxEstimatedUncertaintyMs?: number
}

export interface ClockModel {
  kind: 'affine-clock-model.v1'
  localReferenceMs: number
  remoteReferenceMs: number
  rate: number
  driftPpm: number
  sampleCount: number
  usedSampleCount: number
  localSpanMs: number
  medianRoundTripMs: number
  p95RoundTripMs: number
  rmsResidualMs: number
  maxResidualMs: number
  estimatedUncertaintyMs: number
  uncertaintyBasis: 'half-p95-round-trip-plus-max-fit-residual'
}

export type ClockFitFailureCode =
  | 'invalid_options'
  | 'insufficient_samples'
  | 'invalid_sample'
  | 'insufficient_span'
  | 'round_trip_too_large'
  | 'singular_fit'
  | 'excessive_drift'
  | 'excessive_uncertainty'

export interface ClockFitFailure {
  code: ClockFitFailureCode
  message: string
  sampleIndex: number | null
  observed: number | null
  limit: number | null
}

export type ClockFitResult =
  | { ok: true; model: ClockModel }
  | { ok: false; failure: ClockFitFailure }

interface DerivedProbe {
  index: number
  localMidpointMs: number
  remoteMidpointMs: number
  roundTripMs: number
}

const DEFAULTS: Required<ClockFitOptions> = {
  minSamples: 4,
  minLocalSpanMs: 250,
  maxRoundTripMs: 250,
  lowLatencySlackMs: 20,
  maxAbsoluteDriftPpm: 2_000,
  maxEstimatedUncertaintyMs: 100,
}

function failure(
  code: ClockFitFailureCode,
  message: string,
  sampleIndex: number | null = null,
  observed: number | null = null,
  limit: number | null = null,
): ClockFitResult {
  return { ok: false, failure: { code, message, sampleIndex, observed, limit } }
}

function finite(values: readonly number[]): boolean {
  return values.every((value) => Number.isFinite(value))
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return Number.NaN
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))
  return sorted[index]!
}

/**
 * Fits `remote = reference + rate * (local - localReference)` from NTP-style
 * probes. The uncertainty is a network/fit estimate, not a hardware timing
 * guarantee and not an audio- or sensor-onset observation.
 */
export function fitClockModel(
  samples: readonly ClockProbeSample[],
  options: ClockFitOptions = {},
): ClockFitResult {
  const config = { ...DEFAULTS, ...options }
  if (
    !Number.isInteger(config.minSamples) ||
    config.minSamples < 2 ||
    !finite([
      config.minLocalSpanMs,
      config.maxRoundTripMs,
      config.lowLatencySlackMs,
      config.maxAbsoluteDriftPpm,
      config.maxEstimatedUncertaintyMs,
    ]) ||
    config.minLocalSpanMs < 0 ||
    config.maxRoundTripMs <= 0 ||
    config.lowLatencySlackMs < 0 ||
    config.maxAbsoluteDriftPpm < 0 ||
    config.maxEstimatedUncertaintyMs < 0
  ) {
    return failure('invalid_options', 'Clock-fit limits are invalid.')
  }
  if (samples.length < config.minSamples) {
    return failure(
      'insufficient_samples',
      `At least ${config.minSamples} clock probes are required.`,
      null,
      samples.length,
      config.minSamples,
    )
  }

  const derived: DerivedProbe[] = []
  for (const [index, sample] of samples.entries()) {
    const values = [
      sample.localSendMs,
      sample.remoteReceiveMs,
      sample.remoteSendMs,
      sample.localReceiveMs,
    ]
    if (!finite(values)) {
      return failure('invalid_sample', 'Clock probe timestamps must be finite.', index)
    }
    const localDurationMs = sample.localReceiveMs - sample.localSendMs
    const remoteProcessingMs = sample.remoteSendMs - sample.remoteReceiveMs
    const roundTripMs = localDurationMs - remoteProcessingMs
    if (localDurationMs < 0 || remoteProcessingMs < 0 || roundTripMs < 0) {
      return failure('invalid_sample', 'Clock probe timestamp order or round-trip time is invalid.', index)
    }
    if (roundTripMs > config.maxRoundTripMs) {
      continue
    }
    derived.push({
      index,
      localMidpointMs: (sample.localSendMs + sample.localReceiveMs) / 2,
      remoteMidpointMs: (sample.remoteReceiveMs + sample.remoteSendMs) / 2,
      roundTripMs,
    })
  }

  if (derived.length < config.minSamples) {
    return failure(
      'round_trip_too_large',
      `Fewer than ${config.minSamples} probes remained below the round-trip limit.`,
      null,
      derived.length,
      config.minSamples,
    )
  }

  const byLatency = [...derived].sort(
    (left, right) => left.roundTripMs - right.roundTripMs || left.index - right.index,
  )
  const latencyFloor = byLatency[0]!.roundTripMs
  const lowLatencyLimit = Math.min(config.maxRoundTripMs, latencyFloor + config.lowLatencySlackMs)
  let selected = byLatency.filter((probe) => probe.roundTripMs <= lowLatencyLimit)
  if (selected.length < config.minSamples) selected = byLatency.slice(0, config.minSamples)
  selected.sort((left, right) => left.localMidpointMs - right.localMidpointMs)

  const firstLocal = selected[0]!.localMidpointMs
  const lastLocal = selected[selected.length - 1]!.localMidpointMs
  const localSpanMs = lastLocal - firstLocal
  if (localSpanMs < config.minLocalSpanMs) {
    return failure(
      'insufficient_span',
      'Clock probes do not cover enough local monotonic time to estimate drift.',
      null,
      localSpanMs,
      config.minLocalSpanMs,
    )
  }

  const localReferenceMs =
    selected.reduce((sum, probe) => sum + probe.localMidpointMs, 0) / selected.length
  const remoteMeanMs =
    selected.reduce((sum, probe) => sum + probe.remoteMidpointMs, 0) / selected.length
  let covariance = 0
  let localVariance = 0
  for (const probe of selected) {
    const localDelta = probe.localMidpointMs - localReferenceMs
    covariance += localDelta * (probe.remoteMidpointMs - remoteMeanMs)
    localVariance += localDelta * localDelta
  }
  if (!(localVariance > 0)) {
    return failure('singular_fit', 'Clock probes cannot produce a non-singular affine fit.')
  }
  const rate = covariance / localVariance
  if (!Number.isFinite(rate) || rate <= 0) {
    return failure('singular_fit', 'The fitted clock rate is invalid.')
  }
  const driftPpm = (rate - 1) * 1_000_000
  if (Math.abs(driftPpm) > config.maxAbsoluteDriftPpm) {
    return failure(
      'excessive_drift',
      'The fitted clocks drift too quickly for a start barrier.',
      null,
      Math.abs(driftPpm),
      config.maxAbsoluteDriftPpm,
    )
  }

  const residuals = selected.map((probe) => {
    const predicted = remoteMeanMs + rate * (probe.localMidpointMs - localReferenceMs)
    return Math.abs(probe.remoteMidpointMs - predicted)
  })
  const rmsResidualMs = Math.sqrt(
    residuals.reduce((sum, residual) => sum + residual * residual, 0) / residuals.length,
  )
  const maxResidualMs = Math.max(...residuals)
  const roundTrips = selected.map((probe) => probe.roundTripMs).sort((left, right) => left - right)
  const medianRoundTripMs = percentile(roundTrips, 0.5)
  const p95RoundTripMs = percentile(roundTrips, 0.95)
  const estimatedUncertaintyMs = p95RoundTripMs / 2 + maxResidualMs
  if (estimatedUncertaintyMs > config.maxEstimatedUncertaintyMs) {
    return failure(
      'excessive_uncertainty',
      'The clock correlation uncertainty exceeds the configured start-barrier limit.',
      null,
      estimatedUncertaintyMs,
      config.maxEstimatedUncertaintyMs,
    )
  }

  return {
    ok: true,
    model: {
      kind: 'affine-clock-model.v1',
      localReferenceMs,
      remoteReferenceMs: remoteMeanMs,
      rate,
      driftPpm,
      sampleCount: samples.length,
      usedSampleCount: selected.length,
      localSpanMs,
      medianRoundTripMs,
      p95RoundTripMs,
      rmsResidualMs,
      maxResidualMs,
      estimatedUncertaintyMs,
      uncertaintyBasis: 'half-p95-round-trip-plus-max-fit-residual',
    },
  }
}

export function localToRemoteTime(model: ClockModel, localTimeMs: number): number {
  return model.remoteReferenceMs + model.rate * (localTimeMs - model.localReferenceMs)
}

export function remoteToLocalTime(model: ClockModel, remoteTimeMs: number): number {
  return model.localReferenceMs + (remoteTimeMs - model.remoteReferenceMs) / model.rate
}

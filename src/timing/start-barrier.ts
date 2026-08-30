import {
  localToRemoteTime,
  remoteToLocalTime,
  type ClockFitResult,
  type ClockModel,
} from './clock-fit.ts'

export type StartBarrierPhase =
  | 'preparing'
  | 'prepared'
  | 'committed'
  | 'observed'
  | 'cancelled'
  | 'failed'

export type StartBarrierFailureCode =
  | 'invalid_plan'
  | 'clock_fit_unavailable'
  | 'clock_uncertain'
  | 'lead_time_too_short'
  | 'stale_barrier'
  | 'terminal_state'
  | 'unknown_owner'
  | 'invalid_receipt'
  | 'conflicting_receipt'
  | 'commit_before_ready'
  | 'commit_deadline_elapsed'
  | 'effect_before_commit'
  | 'effect_outcome_unknown'
  | 'owner_failed'

export interface StartBarrierFailure {
  code: StartBarrierFailureCode
  message: string
  owner: string | null
  observed: number | null
  limit: number | null
}

export interface StartBarrierPlanInput {
  barrierId: string
  requiredOwners: readonly string[]
  clockFit: ClockFitResult
  nowLocalPerformanceMs: number
  targetRemoteMs: number
  minimumLeadMs?: number
  commitSafetyMs?: number
  observationTimeoutMs?: number
  maxClockUncertaintyMs?: number
}

export interface StartBarrierPreparedReceipt {
  receiptId: string
  ownerEpoch: string
  preparedAtRemoteMs: number
}

export interface StartBarrierEffectReceipt {
  receiptId: string
  ownerEpoch: string
  observedAtRemoteMs: number
  effectAtRemoteMs: number
  estimatedUncertaintyMs: number
  evidenceScope: string
}

export interface StartBarrierOwnerState {
  prepared: StartBarrierPreparedReceipt | null
  effect: StartBarrierEffectReceipt | null
}

export interface StartBarrierState {
  kind: 'start-barrier.v1'
  barrierId: string
  phase: StartBarrierPhase
  requiredOwners: readonly string[]
  owners: Readonly<Record<string, StartBarrierOwnerState>>
  targetRemoteMs: number
  targetLocalPerformanceMs: number
  commitDeadlineRemoteMs: number
  observationDeadlineRemoteMs: number
  clockModel: ClockModel
  clockUncertaintyMs: number
  committedAtRemoteMs: number | null
  cancelledAtRemoteMs: number | null
  cancellationReason: string | null
  failure: StartBarrierFailure | null
}

export type StartBarrierPlanResult =
  | { ok: true; state: StartBarrierState }
  | { ok: false; failure: StartBarrierFailure }

export type StartBarrierEvent =
  | {
      type: 'owner_prepared'
      barrierId: string
      owner: string
      receipt: StartBarrierPreparedReceipt
    }
  | { type: 'commit'; barrierId: string; committedAtRemoteMs: number }
  | {
      type: 'effect_observed'
      barrierId: string
      owner: string
      receipt: StartBarrierEffectReceipt
    }
  | {
      type: 'owner_failed'
      barrierId: string
      owner: string
      observedAtRemoteMs: number
      message: string
    }
  | {
      type: 'cancel'
      barrierId: string
      cancelledAtRemoteMs: number
      reason: string
    }
  | { type: 'tick'; barrierId: string; nowRemoteMs: number }

export type StartBarrierTransitionResult =
  | { ok: true; state: StartBarrierState }
  | { ok: false; state: StartBarrierState; failure: StartBarrierFailure }

const DEFAULT_MINIMUM_LEAD_MS = 1_000
const DEFAULT_COMMIT_SAFETY_MS = 200
const DEFAULT_OBSERVATION_TIMEOUT_MS = 2_000
const DEFAULT_MAX_CLOCK_UNCERTAINTY_MS = 20

function barrierFailure(
  code: StartBarrierFailureCode,
  message: string,
  owner: string | null = null,
  observed: number | null = null,
  limit: number | null = null,
): StartBarrierFailure {
  return { code, message, owner, observed, limit }
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

function validIdentity(value: string): boolean {
  const length = value.trim().length
  return length > 0 && length <= 128
}

function clonePrepared(
  receipt: StartBarrierPreparedReceipt | null,
): StartBarrierPreparedReceipt | null {
  return receipt ? { ...receipt } : null
}

function cloneEffect(receipt: StartBarrierEffectReceipt | null): StartBarrierEffectReceipt | null {
  return receipt ? { ...receipt } : null
}

function cloneState(state: StartBarrierState): StartBarrierState {
  const owners: Record<string, StartBarrierOwnerState> = {}
  for (const owner of state.requiredOwners) {
    const ownerState = state.owners[owner]!
    owners[owner] = {
      prepared: clonePrepared(ownerState.prepared),
      effect: cloneEffect(ownerState.effect),
    }
  }
  return {
    ...state,
    requiredOwners: [...state.requiredOwners],
    owners,
    clockModel: { ...state.clockModel },
    failure: state.failure ? { ...state.failure } : null,
  }
}

function rejected(
  state: StartBarrierState,
  failure: StartBarrierFailure,
): StartBarrierTransitionResult {
  return { ok: false, state: cloneState(state), failure }
}

function failedState(
  state: StartBarrierState,
  failure: StartBarrierFailure,
): StartBarrierTransitionResult {
  return {
    ok: true,
    state: { ...cloneState(state), phase: 'failed', failure },
  }
}

function allPrepared(state: StartBarrierState): boolean {
  return state.requiredOwners.every((owner) => state.owners[owner]?.prepared != null)
}

function allObserved(state: StartBarrierState): boolean {
  return state.requiredOwners.every((owner) => state.owners[owner]?.effect != null)
}

function samePreparedReceipt(
  left: StartBarrierPreparedReceipt,
  right: StartBarrierPreparedReceipt,
): boolean {
  return (
    left.receiptId === right.receiptId &&
    left.ownerEpoch === right.ownerEpoch &&
    left.preparedAtRemoteMs === right.preparedAtRemoteMs
  )
}

function sameEffectReceipt(left: StartBarrierEffectReceipt, right: StartBarrierEffectReceipt): boolean {
  return (
    left.receiptId === right.receiptId &&
    left.ownerEpoch === right.ownerEpoch &&
    left.observedAtRemoteMs === right.observedAtRemoteMs &&
    left.effectAtRemoteMs === right.effectAtRemoteMs &&
    left.estimatedUncertaintyMs === right.estimatedUncertaintyMs &&
    left.evidenceScope === right.evidenceScope
  )
}

/**
 * Creates a future start barrier using a browser-local to bridge-remote clock
 * fit. Its uncertainty describes only the sampled software clocks and network;
 * it is not evidence that either ECG sampling or acoustic output occurred.
 */
export function createStartBarrier(input: StartBarrierPlanInput): StartBarrierPlanResult {
  const barrierId = input.barrierId.trim()
  if (!validIdentity(barrierId)) {
    return {
      ok: false,
      failure: barrierFailure('invalid_plan', 'The barrier ID is empty or too long.'),
    }
  }
  const requiredOwners = input.requiredOwners.map((owner) => owner.trim())
  if (
    requiredOwners.length < 2 ||
    requiredOwners.some((owner) => !validIdentity(owner)) ||
    new Set(requiredOwners).size !== requiredOwners.length
  ) {
    return {
      ok: false,
      failure: barrierFailure(
        'invalid_plan',
        'A start barrier requires at least two unique, non-empty owners.',
      ),
    }
  }
  if (!input.clockFit.ok) {
    return {
      ok: false,
      failure: barrierFailure(
        'clock_fit_unavailable',
        `A usable clock fit is required: ${input.clockFit.failure.code}.`,
      ),
    }
  }

  const minimumLeadMs = input.minimumLeadMs ?? DEFAULT_MINIMUM_LEAD_MS
  const commitSafetyMs = input.commitSafetyMs ?? DEFAULT_COMMIT_SAFETY_MS
  const observationTimeoutMs = input.observationTimeoutMs ?? DEFAULT_OBSERVATION_TIMEOUT_MS
  const maxClockUncertaintyMs =
    input.maxClockUncertaintyMs ?? DEFAULT_MAX_CLOCK_UNCERTAINTY_MS
  if (
    !finiteNonNegative(input.nowLocalPerformanceMs) ||
    !finiteNonNegative(input.targetRemoteMs) ||
    !finiteNonNegative(minimumLeadMs) ||
    !finiteNonNegative(commitSafetyMs) ||
    !finiteNonNegative(observationTimeoutMs) ||
    !finiteNonNegative(maxClockUncertaintyMs) ||
    commitSafetyMs >= minimumLeadMs
  ) {
    return {
      ok: false,
      failure: barrierFailure(
        'invalid_plan',
        'Barrier times must be finite and the commit safety margin must be smaller than lead time.',
      ),
    }
  }

  const model = input.clockFit.model
  if (model.estimatedUncertaintyMs > maxClockUncertaintyMs) {
    return {
      ok: false,
      failure: barrierFailure(
        'clock_uncertain',
        'Clock-fit uncertainty exceeds the start-barrier limit.',
        null,
        model.estimatedUncertaintyMs,
        maxClockUncertaintyMs,
      ),
    }
  }
  const remoteNowMs = localToRemoteTime(model, input.nowLocalPerformanceMs)
  const leadMs = input.targetRemoteMs - remoteNowMs
  if (leadMs < minimumLeadMs) {
    return {
      ok: false,
      failure: barrierFailure(
        'lead_time_too_short',
        'The proposed T0 is not far enough in the future.',
        null,
        leadMs,
        minimumLeadMs,
      ),
    }
  }

  const owners: Record<string, StartBarrierOwnerState> = {}
  for (const owner of requiredOwners) owners[owner] = { prepared: null, effect: null }
  return {
    ok: true,
    state: {
      kind: 'start-barrier.v1',
      barrierId,
      phase: 'preparing',
      requiredOwners,
      owners,
      targetRemoteMs: input.targetRemoteMs,
      targetLocalPerformanceMs: remoteToLocalTime(model, input.targetRemoteMs),
      commitDeadlineRemoteMs: input.targetRemoteMs - commitSafetyMs,
      observationDeadlineRemoteMs: input.targetRemoteMs + observationTimeoutMs,
      clockModel: { ...model },
      clockUncertaintyMs: model.estimatedUncertaintyMs,
      committedAtRemoteMs: null,
      cancelledAtRemoteMs: null,
      cancellationReason: null,
      failure: null,
    },
  }
}

export function transitionStartBarrier(
  state: StartBarrierState,
  event: StartBarrierEvent,
): StartBarrierTransitionResult {
  if (event.barrierId !== state.barrierId) {
    return rejected(
      state,
      barrierFailure('stale_barrier', 'The event belongs to a different start barrier.'),
    )
  }
  if (state.phase === 'observed' || state.phase === 'cancelled' || state.phase === 'failed') {
    if (
      state.phase === 'observed' &&
      event.type === 'effect_observed' &&
      state.owners[event.owner]?.effect &&
      sameEffectReceipt(state.owners[event.owner]!.effect!, event.receipt)
    ) {
      return { ok: true, state: cloneState(state) }
    }
    if (
      state.phase === 'cancelled' &&
      event.type === 'cancel' &&
      state.cancelledAtRemoteMs === event.cancelledAtRemoteMs &&
      state.cancellationReason === event.reason
    ) {
      return { ok: true, state: cloneState(state) }
    }
    return rejected(
      state,
      barrierFailure('terminal_state', `The ${state.phase} barrier is terminal.`),
    )
  }

  switch (event.type) {
    case 'owner_prepared': {
      const currentOwner = state.owners[event.owner]
      if (!currentOwner) {
        return rejected(
          state,
          barrierFailure('unknown_owner', 'The preparation receipt has an unknown owner.', event.owner),
        )
      }
      const receipt = event.receipt
      if (currentOwner.prepared && samePreparedReceipt(currentOwner.prepared, receipt)) {
        return { ok: true, state: cloneState(state) }
      }
      if (state.phase !== 'preparing' && state.phase !== 'prepared') {
        return rejected(
          state,
          barrierFailure('terminal_state', 'Preparation receipts cannot follow commit.', event.owner),
        )
      }
      if (
        !validIdentity(receipt.receiptId) ||
        !validIdentity(receipt.ownerEpoch) ||
        !finiteNonNegative(receipt.preparedAtRemoteMs)
      ) {
        return rejected(
          state,
          barrierFailure('invalid_receipt', 'The preparation receipt is malformed.', event.owner),
        )
      }
      if (receipt.preparedAtRemoteMs > state.commitDeadlineRemoteMs) {
        return failedState(
          state,
          barrierFailure(
            'commit_deadline_elapsed',
            'An owner became ready after the commit deadline.',
            event.owner,
            receipt.preparedAtRemoteMs,
            state.commitDeadlineRemoteMs,
          ),
        )
      }
      if (currentOwner.prepared) {
        return rejected(
          state,
          barrierFailure(
            'conflicting_receipt',
            'The owner already supplied a different preparation receipt.',
            event.owner,
          ),
        )
      }
      const next = cloneState(state)
      next.owners = {
        ...next.owners,
        [event.owner]: { ...next.owners[event.owner]!, prepared: { ...receipt } },
      }
      if (allPrepared(next)) next.phase = 'prepared'
      return { ok: true, state: next }
    }

    case 'commit': {
      if (!finiteNonNegative(event.committedAtRemoteMs)) {
        return rejected(
          state,
          barrierFailure('invalid_receipt', 'The commit timestamp is invalid.'),
        )
      }
      if (state.phase === 'committed') {
        if (state.committedAtRemoteMs === event.committedAtRemoteMs) {
          return { ok: true, state: cloneState(state) }
        }
        return rejected(
          state,
          barrierFailure('conflicting_receipt', 'The barrier already has a different commit receipt.'),
        )
      }
      if (state.phase !== 'prepared' || !allPrepared(state)) {
        return rejected(
          state,
          barrierFailure('commit_before_ready', 'Every required owner must prepare before commit.'),
        )
      }
      if (event.committedAtRemoteMs > state.commitDeadlineRemoteMs) {
        return failedState(
          state,
          barrierFailure(
            'commit_deadline_elapsed',
            'The commit arrived after the cancellation deadline.',
            null,
            event.committedAtRemoteMs,
            state.commitDeadlineRemoteMs,
          ),
        )
      }
      return {
        ok: true,
        state: {
          ...cloneState(state),
          phase: 'committed',
          committedAtRemoteMs: event.committedAtRemoteMs,
        },
      }
    }

    case 'effect_observed': {
      if (state.phase !== 'committed') {
        return rejected(
          state,
          barrierFailure(
            'effect_before_commit',
            'An effect receipt cannot complete an uncommitted barrier.',
            event.owner,
          ),
        )
      }
      const currentOwner = state.owners[event.owner]
      if (!currentOwner) {
        return rejected(
          state,
          barrierFailure('unknown_owner', 'The effect receipt has an unknown owner.', event.owner),
        )
      }
      const receipt = event.receipt
      if (
        !validIdentity(receipt.receiptId) ||
        !validIdentity(receipt.ownerEpoch) ||
        receipt.evidenceScope.trim().length === 0 ||
        !finiteNonNegative(receipt.observedAtRemoteMs) ||
        !finiteNonNegative(receipt.effectAtRemoteMs) ||
        !finiteNonNegative(receipt.estimatedUncertaintyMs)
      ) {
        return rejected(
          state,
          barrierFailure('invalid_receipt', 'The effect receipt is malformed.', event.owner),
        )
      }
      if (currentOwner.prepared?.ownerEpoch !== receipt.ownerEpoch) {
        return rejected(
          state,
          barrierFailure(
            'conflicting_receipt',
            'The effect receipt does not match the prepared owner epoch.',
            event.owner,
          ),
        )
      }
      if (currentOwner.effect) {
        if (sameEffectReceipt(currentOwner.effect, receipt)) {
          return { ok: true, state: cloneState(state) }
        }
        return rejected(
          state,
          barrierFailure(
            'conflicting_receipt',
            'The owner already supplied a different effect receipt.',
            event.owner,
          ),
        )
      }
      const next = cloneState(state)
      next.owners = {
        ...next.owners,
        [event.owner]: { ...next.owners[event.owner]!, effect: { ...receipt } },
      }
      if (receipt.observedAtRemoteMs > state.observationDeadlineRemoteMs) {
        return failedState(
          next,
          barrierFailure(
            'effect_outcome_unknown',
            'An effect was observed only after the observation deadline.',
            event.owner,
            receipt.observedAtRemoteMs,
            state.observationDeadlineRemoteMs,
          ),
        )
      }
      if (allObserved(next)) next.phase = 'observed'
      return { ok: true, state: next }
    }

    case 'owner_failed': {
      if (!state.owners[event.owner]) {
        return rejected(
          state,
          barrierFailure('unknown_owner', 'The failure has an unknown owner.', event.owner),
        )
      }
      if (!finiteNonNegative(event.observedAtRemoteMs) || event.message.trim().length === 0) {
        return rejected(
          state,
          barrierFailure('invalid_receipt', 'The owner failure is malformed.', event.owner),
        )
      }
      const afterPossibleOnset = event.observedAtRemoteMs >= state.targetRemoteMs
      return failedState(
        state,
        barrierFailure(
          afterPossibleOnset ? 'effect_outcome_unknown' : 'owner_failed',
          afterPossibleOnset
            ? `${event.message} The failure was observed at or after T0, so the effect outcome is unknown.`
            : event.message,
          event.owner,
          event.observedAtRemoteMs,
          afterPossibleOnset ? state.targetRemoteMs : null,
        ),
      )
    }

    case 'cancel': {
      if (!finiteNonNegative(event.cancelledAtRemoteMs) || event.reason.trim().length === 0) {
        return rejected(
          state,
          barrierFailure('invalid_receipt', 'The cancellation is malformed.'),
        )
      }
      if (event.cancelledAtRemoteMs >= state.targetRemoteMs) {
        return failedState(
          state,
          barrierFailure(
            'effect_outcome_unknown',
            'Cancellation occurred at or after T0; owner effects must be reconciled.',
            null,
            event.cancelledAtRemoteMs,
            state.targetRemoteMs,
          ),
        )
      }
      return {
        ok: true,
        state: {
          ...cloneState(state),
          phase: 'cancelled',
          cancelledAtRemoteMs: event.cancelledAtRemoteMs,
          cancellationReason: event.reason,
        },
      }
    }

    case 'tick': {
      if (!finiteNonNegative(event.nowRemoteMs)) {
        return rejected(
          state,
          barrierFailure('invalid_receipt', 'The barrier tick timestamp is invalid.'),
        )
      }
      if (
        (state.phase === 'preparing' || state.phase === 'prepared') &&
        event.nowRemoteMs > state.commitDeadlineRemoteMs
      ) {
        return failedState(
          state,
          barrierFailure(
            'commit_deadline_elapsed',
            'The barrier reached its commit deadline before commit.',
            null,
            event.nowRemoteMs,
            state.commitDeadlineRemoteMs,
          ),
        )
      }
      if (state.phase === 'committed' && event.nowRemoteMs > state.observationDeadlineRemoteMs) {
        const missing = state.requiredOwners.filter((owner) => !state.owners[owner]?.effect)
        return failedState(
          state,
          barrierFailure(
            'effect_outcome_unknown',
            `Effect outcome is unknown for: ${missing.join(', ')}.`,
            missing[0] ?? null,
            event.nowRemoteMs,
            state.observationDeadlineRemoteMs,
          ),
        )
      }
      return { ok: true, state: cloneState(state) }
    }
  }
}

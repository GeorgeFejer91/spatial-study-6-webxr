import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./companion-controls.ts', () => ({
  CompanionControls: class {
    destroy(): void {}
  },
}))

import type { StudyMediaPlayer, StudyMediaSnapshot } from '../media/player.ts'
import {
  FakeStudyBridgeTransport,
  polarProjectionFromSnapshot,
  StudyBridgeClient,
  STUDY_BRIDGE_PROTOCOL,
} from '../bridge/index.ts'
import { acquisitionSnapshotPayload, apkHelloPayload } from '../test/bridge-fixtures.ts'
import { StudyDatabase, type SessionRevision } from '../persistence/database.ts'
import {
  createInitialExperimentState,
  reduceStudy,
  type ExperimentState,
  type StudyAction,
} from '../study/index.ts'
import type { BrowserStudyShell } from '../ui/browser-shell.ts'
import type { StudyXRRuntime } from '../xr/study-xr-runtime.ts'
import { StudyController } from './controller.ts'
import type { StudyPanelRenderer } from './panel-renderer.ts'

interface ControllerInternals {
  state: ExperimentState
  database: StudyDatabase | null
  durableRevision: number
  storageHealthy: boolean
  recoveryBlocked: boolean
  sessionFinalized: boolean
  controlEnabled: boolean
  localMessage: string
  participantProgress: unknown[]
  applyAction(action: StudyAction): Promise<boolean>
  startParticipant(participantId: string): Promise<void>
  companionStatus(): {
    authority: string
    bridgeConnected: boolean
    polarReady: boolean
    lastReceiptStage: string | null
    startPreflightReady: boolean
    remoteStartAllowed: boolean
  }
  handleRemoteCommand(
    name: 'start_block' | 'reconnect_sensor' | 'abort_session',
    expectedRevision: number,
  ): Promise<{ accepted: boolean; code: string; message: string }>
}

function acceptedState(state: ExperimentState, action: StudyAction): ExperimentState {
  const result = reduceStudy(state, action)
  if (!result.accepted) throw new Error(`${result.code}: ${result.detail}`)
  return result.state
}

function blockReadyState(): ExperimentState {
  let state = createInitialExperimentState()
  state = acceptedState(state, {
    type: 'configure',
    configuration: { variantId: 'DHS', languageCode: 'en', timingMode: 'clipped' },
  })
  state = acceptedState(state, { type: 'set_participant_id', participantId: 'PH1' })
  state = acceptedState(state, {
    type: 'start_participant',
    sessionId: 'session-1',
    allocatedAtUtc: '2026-08-29T10:00:00.000Z',
    usedParticipantIds: [],
  })
  return acceptedState(state, {
    type: 'submit_demographics',
    demographics: {
      firstName: 'Test',
      lastName: 'Participant',
      ageYears: 30,
      handedness: 'right',
      gender: 'prefer_not_to_say',
      consentConfirmed: true,
    },
  })
}

function mediaFake() {
  let snapshot: StudyMediaSnapshot = {
    phase: 'idle',
    positionMs: 0,
    durationMs: 0,
    assignment: null,
    error: null,
  }
  return {
    load: vi.fn((assignment) => {
      snapshot = { ...snapshot, phase: 'ready', durationMs: assignment.durationMs, assignment }
      return snapshot
    }),
    play: vi.fn(async () => {
      snapshot = { ...snapshot, phase: 'playing' }
      return snapshot
    }),
    pause: vi.fn(() => {
      snapshot = { ...snapshot, phase: 'paused' }
      return snapshot
    }),
    hide: vi.fn(),
    show: vi.fn(),
    update: vi.fn(() => snapshot),
    snapshot: vi.fn(() => snapshot),
  }
}

function controllerFixture(bridge?: StudyBridgeClient) {
  const shell = {
    canvas: document.createElement('canvas'),
    companionSlot: document.createElement('div'),
    setStatus: vi.fn(),
    setXRPresenting: vi.fn(),
    setXRAvailability: vi.fn(),
    setMediaControl: vi.fn(),
  }
  const runtime = {
    recenterPanel: vi.fn(),
    enterXR: vi.fn(),
    exitXR: vi.fn(),
    isImmersiveSupported: vi.fn(async () => false),
  }
  const media = mediaFake()
  const panelRenderer = {
    render: vi.fn(),
    resetTransientState: vi.fn(),
  }
  const controller = new StudyController({
    shell: shell as unknown as BrowserStudyShell,
    runtime: runtime as unknown as StudyXRRuntime,
    media: media as unknown as StudyMediaPlayer,
    panelRenderer: panelRenderer as unknown as StudyPanelRenderer,
    bridge,
  })
  return { controller, internals: controller as unknown as ControllerInternals, shell, runtime, media, panelRenderer }
}

function databaseFake(overrides: Record<string, unknown> = {}) {
  return {
    appendRevision: vi.fn(async (_sessionId, expectedRevision) => ({
      revision: expectedRevision + 1,
    })),
    appendRevisionWithResponse: vi.fn(),
    appendEvent: vi.fn(async () => undefined),
    beginSession: vi.fn(),
    finalizeSession: vi.fn(async () => undefined),
    listParticipantProgress: vi.fn(async () => []),
    recoverActiveSession: vi.fn(async () => null),
    recoverParticipantSession: vi.fn(async () => null),
    close: vi.fn(),
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('StudyController runtime durability', () => {
  it('keeps WebXR authoritative while the APK provides only recording effects', async () => {
    const transport = new FakeStudyBridgeTransport()
    let nextId = 0
    const bridge = new StudyBridgeClient({
      transport,
      browserPageEpoch: 'browser-page-1',
      browserInstanceId: 'browser-1',
      createId: () => `id-${++nextId}`,
    })
    const fixture = controllerFixture(bridge)
    await fixture.controller.initialize()
    expect(fixture.internals.database).not.toBeNull()

    const bridgeProjection = bridge.snapshot()
    const common = {
      protocol: STUDY_BRIDGE_PROTOCOL,
      bridgeProcessEpoch: 'apk-process-1',
      browserPageEpoch: bridgeProjection.browserPageEpoch,
      transportEpoch: bridgeProjection.transportEpoch,
      revision: 0,
      sender: { role: 'apk' as const, instanceId: 'apk-1' },
      target: 'webxr' as const,
    }
    transport.receive({
      ...common,
      messageId: 'hello-1',
      type: 'hello',
      payload: apkHelloPayload(),
    })
    const sensorPayload = acquisitionSnapshotPayload()
    const polar = polarProjectionFromSnapshot(sensorPayload)
    transport.receive({
      ...common,
      messageId: 'snapshot-0',
      type: 'snapshot',
      payload: sensorPayload,
    })

    const action: StudyAction = {
      type: 'configure',
      configuration: { variantId: 'DHS', languageCode: 'en', timingMode: 'clipped' },
    }
    await expect(fixture.internals.applyAction(action)).resolves.toBe(true)
    const reduced = reduceStudy(createInitialExperimentState(), action)
    if (!reduced.accepted) throw new Error(reduced.detail)
    expect(fixture.internals.state).toEqual(reduced.state)
    expect(transport.sent.filter((message) => message.type === 'command')).toHaveLength(0)

    // A newer recorder snapshot updates sensor health, never questionnaire/condition state.
    transport.receive({
      ...common,
      revision: 2,
      messageId: 'snapshot-2',
      type: 'snapshot',
      payload: acquisitionSnapshotPayload(2),
    })
    expect(fixture.internals.state).toEqual(reduced.state)
    expect(fixture.panelRenderer.render).toHaveBeenLastCalledWith(
      reduced.state,
      expect.objectContaining({ polar }),
    )

    fixture.internals.controlEnabled = true
    const forwarded = fixture.internals.handleRemoteCommand('reconnect_sensor', 1)
    await vi.waitFor(() =>
      expect(transport.sent.some((message) => message.type === 'command')).toBe(true),
    )
    const reconnectCommand = transport.sent.at(-1)!
    expect(reconnectCommand).toMatchObject({
      expectedRevision: 2,
      payload: { action: 'reconnect_sensor' },
    })
    transport.receive({
      ...common,
      revision: 2,
      messageId: 'receipt-reconnect-applied',
      correlationId: reconnectCommand.messageId,
      type: 'receipt',
      payload: {
        commandMessageId: reconnectCommand.messageId,
        stage: 'applied',
        outcome: 'sensor_reconnect_started',
        detail: 'Polar reconnect requested.',
        effectiveRevision: 2,
      },
    })
    await expect(forwarded).resolves.toMatchObject({
      accepted: true,
      stage: 'applied',
      sensorRevision: 2,
    })
    expect(fixture.internals.companionStatus()).toMatchObject({
      authority: 'webxr_experiment_owner',
      bridgeConnected: true,
      polarReady: false,
      lastReceiptStage: 'applied',
      startPreflightReady: false,
    })

    fixture.internals.state = blockReadyState()
    expect(fixture.internals.companionStatus()).toMatchObject({
      startPreflightReady: false,
      remoteStartAllowed: true,
    })
  })

  it('waits for the durable start-block revision before acknowledging a remote start', async () => {
    const fixture = controllerFixture()
    const state = blockReadyState()
    let resolveRevision!: (revision: Pick<SessionRevision, 'revision'>) => void
    const revisionPromise = new Promise<Pick<SessionRevision, 'revision'>>((resolve) => {
      resolveRevision = resolve
    })
    const database = databaseFake({
      appendRevision: vi.fn(() => revisionPromise),
    })
    fixture.internals.state = state
    fixture.internals.database = database as unknown as StudyDatabase
    fixture.internals.durableRevision = 0
    fixture.internals.controlEnabled = true

    let settled = false
    const command = fixture.internals
      .handleRemoteCommand('start_block', state.revision)
      .finally(() => {
        settled = true
      })

    await vi.waitFor(() => expect(database.appendRevision).toHaveBeenCalledOnce())
    expect(settled).toBe(false)
    resolveRevision({ revision: 1 })

    await expect(command).resolves.toMatchObject({ accepted: true, code: 'started' })
    expect(fixture.internals.state.page).toBe('stimulus')
    expect(fixture.internals.durableRevision).toBe(1)
  })

  it('rejects a remote start when media playback fails and does not persist the transition', async () => {
    const fixture = controllerFixture()
    const state = blockReadyState()
    const database = databaseFake()
    fixture.media.play.mockRejectedValueOnce(new Error('autoplay blocked'))
    fixture.internals.state = state
    fixture.internals.database = database as unknown as StudyDatabase
    fixture.internals.durableRevision = 0
    fixture.internals.controlEnabled = true

    await expect(
      fixture.internals.handleRemoteCommand('start_block', state.revision),
    ).resolves.toMatchObject({ accepted: false, code: 'start_failed' })
    expect(database.appendRevision).not.toHaveBeenCalled()
    expect(fixture.internals.state.page).toBe('block_ready')
    expect(fixture.media.pause).toHaveBeenCalled()
  })

  it('accepts a durably committed transition even when best-effort audit logging fails', async () => {
    const fixture = controllerFixture()
    const database = databaseFake({
      appendEvent: vi.fn(async () => {
        throw new Error('event store unavailable')
      }),
    })
    fixture.internals.state = blockReadyState()
    fixture.internals.database = database as unknown as StudyDatabase
    fixture.internals.durableRevision = 0

    await expect(
      fixture.internals.applyAction({
        type: 'start_block',
        startedAtUtc: '2026-08-29T10:05:00.000Z',
      }),
    ).resolves.toBe(true)
    expect(fixture.internals.state.page).toBe('stimulus')
    expect(fixture.internals.durableRevision).toBe(1)
    expect(fixture.internals.storageHealthy).toBe(false)
    expect(fixture.internals.localMessage).toContain('State saved')
  })

  it('stops recovery on a session-owner mismatch and blocks a replacement allocation', async () => {
    const fixture = controllerFixture()
    const recoveredState = blockReadyState()
    const database = databaseFake({
      listParticipantProgress: vi.fn(async () => []),
      recoverActiveSession: vi.fn(async () => ({
        header: {
          sessionId: 'session-1',
          participantId: 'PH2',
          createdAt: '2026-08-29T10:00:00.000Z',
          updatedAt: '2026-08-29T10:01:00.000Z',
          latestRevision: 1,
          nextEventSequence: 0,
          finalized: false,
        },
        revision: { state: recoveredState },
      })),
    })
    vi.spyOn(StudyDatabase, 'open').mockResolvedValue(database as unknown as StudyDatabase)

    await fixture.controller.initialize()

    expect(fixture.panelRenderer.resetTransientState).toHaveBeenCalledOnce()
    expect(fixture.internals.state.page).toBe('operator_setup')
    expect(fixture.internals.recoveryBlocked).toBe(true)
    expect(fixture.internals.localMessage).toContain('recovery_participant_owner_mismatch')

    await fixture.internals.startParticipant('PH2')
    expect(database.beginSession).not.toHaveBeenCalled()
    expect(fixture.internals.localMessage).toContain('allocation is blocked')
  })

  it('repeats a recovered block when any questionnaire data is still missing', async () => {
    const fixture = controllerFixture()
    let recoveredState = blockReadyState()
    const archivedAttemptId = recoveredState.blocks[0].attemptId
    recoveredState = acceptedState(recoveredState, {
      type: 'start_block',
      startedAtUtc: '2026-08-29T10:05:00.000Z',
    })
    recoveredState = acceptedState(recoveredState, {
      type: 'complete_stimulus',
      observedDurationMs: 10_000,
      endedAtUtc: '2026-08-29T10:05:10.000Z',
    })
    recoveredState = acceptedState(recoveredState, {
      type: 'set_sam',
      dimension: 'valence',
      value: 7,
    })
    const database = databaseFake({
      recoverActiveSession: vi.fn(async () => ({
        header: {
          sessionId: 'session-1',
          participantId: 'PH1',
          createdAt: '2026-08-29T10:00:00.000Z',
          updatedAt: '2026-08-29T10:05:10.000Z',
          latestRevision: 8,
          nextEventSequence: 0,
          finalized: false,
        },
        revision: { state: recoveredState },
      })),
    })
    vi.spyOn(StudyDatabase, 'open').mockResolvedValue(database as unknown as StudyDatabase)

    await fixture.controller.initialize()

    expect(fixture.internals.state.page).toBe('block_ready')
    expect(fixture.internals.state.blocks[0]).toMatchObject({
      status: 'pending',
      questionnaire: null,
    })
    expect(fixture.internals.state.blocks[0].attemptId).not.toBe(archivedAttemptId)
    expect(fixture.internals.state.assessmentDraft.samValence).toBeNull()
    expect(fixture.internals.localMessage).toContain('whole block 1 will repeat')
    expect(database.appendRevision).toHaveBeenCalledOnce()
    expect(database.appendEvent).toHaveBeenCalledWith(
      'session-1',
      'block_attempt_archived_for_repeat',
      expect.objectContaining({ archivedAttemptId, reason: 'process_restart' }),
    )
  })

  it('requires a terminal receipt and clears every transient draft before a new session', () => {
    const fixture = controllerFixture()
    fixture.internals.state = { ...blockReadyState(), page: 'complete' }

    fixture.controller.createPanelActions().startNewSession()
    expect(fixture.internals.state.page).toBe('complete')
    expect(fixture.panelRenderer.resetTransientState).not.toHaveBeenCalled()
    expect(fixture.internals.localMessage).toContain('terminal receipt')

    fixture.internals.sessionFinalized = true
    fixture.controller.createPanelActions().startNewSession()
    expect(fixture.internals.state).toEqual(createInitialExperimentState())
    expect(fixture.panelRenderer.resetTransientState).toHaveBeenCalledOnce()
    expect(fixture.media.hide).toHaveBeenCalled()
  })

  it('persists a remote abort in WebXR and finalizes browser storage without an APK', async () => {
    const fixture = controllerFixture()
    const database = databaseFake()
    fixture.internals.state = blockReadyState()
    fixture.internals.database = database as unknown as StudyDatabase
    fixture.internals.durableRevision = 0
    fixture.internals.controlEnabled = true

    await expect(
      fixture.internals.handleRemoteCommand(
        'abort_session',
        fixture.internals.state.revision,
      ),
    ).resolves.toMatchObject({
      accepted: true,
      code: 'aborted',
      stage: 'persisted',
    })

    expect(fixture.internals.state.page).toBe('aborted')
    expect(database.appendRevision).toHaveBeenCalledOnce()
    expect(database.finalizeSession).toHaveBeenCalledWith('session-1', 'abandoned')
    expect(fixture.internals.sessionFinalized).toBe(true)
    expect(fixture.media.pause).toHaveBeenCalled()
  })
})

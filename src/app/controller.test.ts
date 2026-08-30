import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  CompanionStatus,
  RemoteMutationCommandRequest,
} from '../companion/protocol.ts'

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
  type BridgeCommandResult,
  type BridgeExperimentMarker,
  type PolarStatusProjection,
  type StudyBridgeProjection,
} from '../bridge/index.ts'
import {
  acquisitionSnapshotPayload,
  apkHelloPayload,
  readyPolarProjection,
} from '../test/bridge-fixtures.ts'
import { StudyDatabase, type SessionRevision } from '../persistence/database.ts'
import {
  createInitialExperimentState,
  reduceStudy,
  type Demographics,
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
  sensorMessage: string
  participantProgress: unknown[]
  polar: PolarStatusProjection
  bridgeProjection: StudyBridgeProjection | null
  applyAction(action: StudyAction): Promise<boolean>
  startParticipant(participantId: string): Promise<boolean>
  submitDemographics(demographics: Demographics): Promise<void>
  startBlock(): Promise<boolean>
  advanceAssessment(): Promise<boolean>
  ensureSessionRecording(sessionId: string): Promise<boolean>
  companionStatus(): CompanionStatus
  handleRemoteCommand(
    request: RemoteMutationCommandRequest,
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

function participantEntryState(): ExperimentState {
  return acceptedState(createInitialExperimentState(), {
    type: 'configure',
    configuration: { variantId: 'DHS', languageCode: 'en', timingMode: 'clipped' },
  })
}

const TEST_DEMOGRAPHICS = {
  firstName: 'Test',
  lastName: 'Participant',
  ageYears: 30,
  handedness: 'right',
  gender: 'prefer_not_to_say',
  consentConfirmed: true,
} as const

function assessmentReadyState(input: ExperimentState): ExperimentState {
  let state = acceptedState(input, {
    type: 'start_block',
    startedAtUtc: '2026-08-29T10:05:00.000Z',
  })
  state = acceptedState(state, {
    type: 'complete_stimulus',
    observedDurationMs: 10_000,
    endedAtUtc: '2026-08-29T10:05:10.000Z',
  })
  for (const dimension of ['valence', 'arousal', 'dominance'] as const) {
    state = acceptedState(state, { type: 'set_sam', dimension, value: 5 })
  }
  state = acceptedState(state, { type: 'advance_assessment' })
  for (const dimension of ['valence', 'arousal'] as const) {
    state = acceptedState(state, { type: 'set_affect', dimension, value: 0 })
  }
  state = acceptedState(state, { type: 'advance_assessment' })
  for (const emotion of [
    'anger',
    'disgust',
    'fear',
    'happiness',
    'sadness',
    'surprise',
  ] as const) {
    state = acceptedState(state, { type: 'set_emotion', emotion, value: 0 })
  }
  state = acceptedState(state, { type: 'advance_assessment' })
  state = acceptedState(state, { type: 'set_hand', dimension: 'ownership', value: 4 })
  return acceptedState(state, { type: 'set_hand', dimension: 'agency', value: 4 })
}

function markerResult(accepted = true): BridgeCommandResult {
  return {
    commandId: 'sensor-command-1',
    accepted,
    stage: 'persisted',
    code: accepted ? 'marker_persisted' : 'marker_rejected',
    detail: accepted ? '' : 'Marker was not persisted.',
    resultingRevision: 1,
  }
}

function bridgeFake(
  record: (marker: BridgeExperimentMarker) => Promise<BridgeCommandResult> = async () =>
    markerResult(),
) {
  const recordExperimentMarker = vi.fn(record)
  const applySensorAction = vi.fn(async () => markerResult())
  const beginRecording = vi.fn(async () => markerResult())
  return {
    bridge: {
      recordExperimentMarker,
      applySensorAction,
      beginRecording,
    } as unknown as StudyBridgeClient,
    recordExperimentMarker,
    applySensorAction,
    beginRecording,
  }
}

function setReadyBridgeProjection(internals: ControllerInternals): void {
  const polar = readyPolarProjection()
  const sessionId = internals.state.sessionId
  const snapshot = acquisitionSnapshotPayload(0, polar)
  internals.polar = polar
  internals.bridgeProjection = {
    sensorConnected: true,
    sessionId,
    snapshot: {
      ...snapshot,
      recording: { ...snapshot.recording, ownerSessionId: sessionId },
    },
  } as StudyBridgeProjection
}

function setUnownedBridgeProjection(internals: ControllerInternals): void {
  const polar = readyPolarProjection()
  const snapshot = acquisitionSnapshotPayload(0, polar)
  internals.polar = polar
  internals.bridgeProjection = {
    sensorConnected: true,
    sessionId: null,
    snapshot: {
      ...snapshot,
      recording: { ...snapshot.recording, ownerSessionId: null },
    },
  } as StudyBridgeProjection
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
    appendRevisionWithResponse: vi.fn(async (_sessionId, expectedRevision) => ({
      revision: expectedRevision + 1,
    })),
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
  it('applies bounded remote setup and participant allocation through WebXR authority', async () => {
    const fixture = controllerFixture()
    const database = databaseFake()
    fixture.internals.database = database as unknown as StudyDatabase
    fixture.internals.controlEnabled = true

    expect(fixture.internals.companionStatus()).toMatchObject({
      phase: 'operator_setup',
      variant: null,
      timingMode: null,
      remoteConfigureAllowed: true,
      remoteParticipantStartAllowed: false,
    })
    await expect(fixture.internals.handleRemoteCommand({
      name: 'configure_study',
      args: { variantId: 'SHD', languageCode: 'de', timingMode: 'clipped' },
    }, 0)).resolves.toMatchObject({
      accepted: true,
      code: 'study_configured',
      stage: 'applied',
    })
    expect(fixture.internals.companionStatus()).toMatchObject({
      revision: 1,
      phase: 'participant_id',
      variant: 'SHD',
      language: 'de',
      timingMode: 'clipped',
      participantPrefix: 'PI',
      remoteConfigureAllowed: false,
      remoteParticipantStartAllowed: true,
    })

    await expect(fixture.internals.handleRemoteCommand({
      name: 'start_participant',
      args: { participantId: 'PI7' },
    }, 1)).resolves.toMatchObject({
      accepted: true,
      code: 'participant_started',
      stage: 'persisted',
    })
    expect(database.beginSession).toHaveBeenCalledOnce()
    expect(fixture.internals.state).toMatchObject({
      page: 'demographics',
      participantId: 'PI7',
      configuration: { variantId: 'SHD', languageCode: 'de', timingMode: 'clipped' },
    })
    const status = fixture.internals.companionStatus()
    expect(status).toMatchObject({
      phase: 'demographics',
      participantActive: true,
      remoteParticipantStartAllowed: false,
    })
    expect(JSON.stringify(status)).not.toContain('PI7')
  })

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
    const forwarded = fixture.internals.handleRemoteCommand(
      { name: 'reconnect_sensor', args: {} },
      1,
    )
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
      remoteStartAllowed: false,
    })
  })

  it('rejects start before media loading when live ECG and its durable writer are not ready', async () => {
    const fixture = controllerFixture()
    const state = blockReadyState()
    const database = databaseFake()
    fixture.internals.state = state
    fixture.internals.database = database as unknown as StudyDatabase
    fixture.internals.durableRevision = 0
    fixture.internals.controlEnabled = true

    await expect(
      fixture.internals.handleRemoteCommand({ name: 'start_block', args: {} }, state.revision),
    ).resolves.toMatchObject({
      accepted: false,
      code: 'start_failed',
      message: 'No media or study transition was started.',
    })
    expect(fixture.internals.state).toBe(state)
    expect(database.appendRevision).not.toHaveBeenCalled()
    expect(fixture.media.load).not.toHaveBeenCalled()
    expect(fixture.media.play).not.toHaveBeenCalled()
  })

  it('waits for durability before reporting a live-ECG-qualified remote start', async () => {
    const sensor = bridgeFake()
    const fixture = controllerFixture(sensor.bridge)
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
    setReadyBridgeProjection(fixture.internals)
    expect(fixture.internals.companionStatus()).toMatchObject({
      startPreflightReady: true,
      remoteStartAllowed: true,
    })

    let settled = false
    const command = fixture.internals
      .handleRemoteCommand({ name: 'start_block', args: {} }, state.revision)
      .finally(() => {
        settled = true
      })

    await vi.waitFor(() => expect(database.appendRevision).toHaveBeenCalledOnce())
    expect(settled).toBe(false)
    resolveRevision({ revision: 1 })

    await expect(command).resolves.toMatchObject({
      accepted: true,
      code: 'started',
      message: expect.stringContaining('live ECG preflight ready'),
    })
    expect(fixture.internals.state.page).toBe('stimulus')
    expect(fixture.internals.durableRevision).toBe(1)
  })

  it('rejects a remote start when media playback fails and does not persist the transition', async () => {
    const sensor = bridgeFake()
    const fixture = controllerFixture(sensor.bridge)
    const state = blockReadyState()
    const database = databaseFake()
    fixture.media.play.mockRejectedValueOnce(new Error('autoplay blocked'))
    fixture.internals.state = state
    fixture.internals.database = database as unknown as StudyDatabase
    fixture.internals.durableRevision = 0
    fixture.internals.controlEnabled = true
    setReadyBridgeProjection(fixture.internals)

    await expect(
      fixture.internals.handleRemoteCommand({ name: 'start_block', args: {} }, state.revision),
    ).resolves.toMatchObject({ accepted: false, code: 'start_failed' })
    expect(database.appendRevision).not.toHaveBeenCalled()
    expect(fixture.internals.state.page).toBe('block_ready')
    expect(fixture.media.pause).toHaveBeenCalled()
  })

  it('retries one stable begin-recording request and blocks demographics until ownership is observed', async () => {
    const sensor = bridgeFake()
    sensor.beginRecording.mockResolvedValue(markerResult(false))
    const fixture = controllerFixture(sensor.bridge)
    const database = databaseFake()
    fixture.internals.state = participantEntryState()
    fixture.internals.database = database as unknown as StudyDatabase
    fixture.internals.durableRevision = -1
    setUnownedBridgeProjection(fixture.internals)

    await fixture.internals.startParticipant('PH1')

    const sessionId = fixture.internals.state.sessionId!
    const allocatedRevision = fixture.internals.state.revision
    expect(fixture.internals.state.page).toBe('demographics')
    expect(database.beginSession).toHaveBeenCalledOnce()
    expect(sensor.beginRecording).toHaveBeenNthCalledWith(
      1,
      sessionId,
      allocatedRevision,
      `begin-${sessionId}`,
      'observed',
    )
    expect(database.beginSession.mock.invocationCallOrder[0]).toBeLessThan(
      sensor.beginRecording.mock.invocationCallOrder[0],
    )

    await expect(
      fixture.internals.applyAction({ type: 'set_demographics_language', languageCode: 'de' }),
    ).resolves.toBe(true)
    expect(fixture.internals.state.revision).toBeGreaterThan(allocatedRevision)

    await fixture.internals.submitDemographics(TEST_DEMOGRAPHICS)
    expect(fixture.internals.state.page).toBe('demographics')
    expect(database.appendRevision).toHaveBeenCalledOnce()
    expect(sensor.recordExperimentMarker).not.toHaveBeenCalled()
    expect(sensor.beginRecording).toHaveBeenNthCalledWith(
      2,
      sessionId,
      allocatedRevision,
      `begin-${sessionId}`,
      'observed',
    )

    setReadyBridgeProjection(fixture.internals)
    await fixture.internals.submitDemographics(TEST_DEMOGRAPHICS)
    expect(fixture.internals.state.page).toBe('block_ready')
    expect(database.appendRevision).toHaveBeenCalledTimes(2)
    expect(sensor.recordExperimentMarker).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'experiment_ready', sessionId }),
      'persisted',
    )
  })

  it('fails closed before playback and reduction when the durable start-intent marker is rejected', async () => {
    const sensor = bridgeFake(async (marker) =>
      markerResult(marker.eventType !== 'block_start_intent'),
    )
    const fixture = controllerFixture(sensor.bridge)
    const state = blockReadyState()
    const database = databaseFake()
    fixture.internals.state = state
    fixture.internals.database = database as unknown as StudyDatabase
    fixture.internals.durableRevision = 0
    setReadyBridgeProjection(fixture.internals)

    await expect(fixture.internals.startBlock()).resolves.toBe(false)

    expect(sensor.recordExperimentMarker).toHaveBeenCalledOnce()
    expect(sensor.recordExperimentMarker).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'block_start_intent',
        webxrRevision: state.revision,
        sessionId: state.sessionId,
        blockOrder: state.blocks[0].blockOrder,
        conditionId: state.blocks[0].conditionId,
        mediaId: state.blocks[0].mediaId,
      }),
      'persisted',
    )
    expect(fixture.media.play).not.toHaveBeenCalled()
    expect(database.appendRevision).not.toHaveBeenCalled()
    expect(fixture.internals.state).toBe(state)
    expect(fixture.internals.localMessage).toContain('start-intent marker was not confirmed')
  })

  it('stops media and durably enters technical hold when the media-started marker fails', async () => {
    const sensor = bridgeFake(async (marker) =>
      markerResult(marker.eventType !== 'media_started'),
    )
    const fixture = controllerFixture(sensor.bridge)
    const state = blockReadyState()
    const database = databaseFake()
    fixture.internals.state = state
    fixture.internals.database = database as unknown as StudyDatabase
    fixture.internals.durableRevision = 0
    setReadyBridgeProjection(fixture.internals)

    await expect(fixture.internals.startBlock()).resolves.toBe(false)

    expect(
      sensor.recordExperimentMarker.mock.calls.map(([marker]) => marker.eventType),
    ).toEqual(['block_start_intent', 'media_started', 'technical_hold'])
    expect(fixture.media.pause).toHaveBeenCalled()
    expect(database.appendRevision).toHaveBeenCalledTimes(2)
    expect(fixture.internals.state).toMatchObject({
      page: 'technical_hold',
      technicalHoldReason: 'media_started_marker_failed',
      media: { status: 'paused' },
    })
    expect(fixture.internals.localMessage).toContain('entered technical hold')
  })

  it('labels all completed-block markers from the pre-transition block after its new revision is durable', async () => {
    const sensor = bridgeFake()
    const fixture = controllerFixture(sensor.bridge)
    const database = databaseFake()
    fixture.internals.state = blockReadyState()
    fixture.internals.database = database as unknown as StudyDatabase
    fixture.internals.durableRevision = 0
    setReadyBridgeProjection(fixture.internals)

    for (let blockIndex = 0; blockIndex < 4; blockIndex += 1) {
      const ready = assessmentReadyState(fixture.internals.state)
      fixture.internals.state = ready
      const completedBlock = ready.blocks[ready.currentBlockIndex]
      const expectedWebXrRevision = ready.revision + 1
      const markerCallsBefore = sensor.recordExperimentMarker.mock.calls.length

      await expect(fixture.internals.advanceAssessment()).resolves.toBe(true)

      const blockCompletedCallIndex = sensor.recordExperimentMarker.mock.calls.findIndex(
        ([marker], index) =>
          index >= markerCallsBefore && marker.eventType === 'block_completed',
      )
      expect(blockCompletedCallIndex).toBeGreaterThanOrEqual(markerCallsBefore)
      const marker = sensor.recordExperimentMarker.mock.calls[blockCompletedCallIndex][0]
      expect(marker).toMatchObject({
        eventType: 'block_completed',
        webxrRevision: expectedWebXrRevision,
        sessionId: ready.sessionId,
        blockOrder: completedBlock.blockOrder,
        conditionId: completedBlock.conditionId,
        mediaId: completedBlock.mediaId,
      })
      expect(
        database.appendRevisionWithResponse.mock.invocationCallOrder.at(-1),
      ).toBeLessThan(sensor.recordExperimentMarker.mock.invocationCallOrder[blockCompletedCallIndex])
    }

    expect(
      sensor.recordExperimentMarker.mock.calls
        .map(([marker]) => marker)
        .filter((marker) => marker.eventType === 'block_completed')
        .map(({ blockOrder, conditionId, mediaId }) => ({ blockOrder, conditionId, mediaId })),
    ).toEqual(
      fixture.internals.state.blocks.map(({ blockOrder, conditionId, mediaId }) => ({
        blockOrder,
        conditionId,
        mediaId,
      })),
    )
    expect(fixture.internals.state.page).toBe('complete')
    expect(sensor.applySensorAction).toHaveBeenCalledWith('finalize_recording', 'persisted')
  })

  it('does not emit a completed-block marker when the authoritative transition is not durable', async () => {
    const sensor = bridgeFake()
    const fixture = controllerFixture(sensor.bridge)
    const ready = assessmentReadyState(blockReadyState())
    const database = databaseFake({
      appendRevisionWithResponse: vi.fn(async () => {
        throw new Error('response transaction failed')
      }),
    })
    fixture.internals.state = ready
    fixture.internals.database = database as unknown as StudyDatabase
    fixture.internals.durableRevision = 0
    setReadyBridgeProjection(fixture.internals)

    await expect(fixture.internals.advanceAssessment()).resolves.toBe(false)

    expect(fixture.internals.state).toBe(ready)
    expect(fixture.internals.state.page).toBe('hand_embodiment')
    expect(sensor.recordExperimentMarker).not.toHaveBeenCalled()
    expect(fixture.internals.localMessage).toContain('response transaction failed')
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

  it('reconciles a recovered WebXR session to an observed session-owned recording', async () => {
    const recoveredState = blockReadyState()
    const polar = readyPolarProjection()
    const unownedSnapshot = acquisitionSnapshotPayload(0, polar)
    let projection = {
      sensorConnected: true,
      connectionDetail: 'APK sensor recorder connected.',
      sessionId: null,
      polar,
      snapshot: {
        ...unownedSnapshot,
        recording: { ...unownedSnapshot.recording, ownerSessionId: null },
      },
      lastError: null,
    } as StudyBridgeProjection
    let listener: ((value: StudyBridgeProjection) => void) | null = null
    const beginRecording = vi.fn(
      async (sessionId: string): Promise<BridgeCommandResult> => {
        projection = {
          ...projection,
          sessionId,
          snapshot: {
            ...projection.snapshot!,
            recording: {
              ...projection.snapshot!.recording,
              ownerSessionId: sessionId,
              state: 'recording',
              artifactOpen: true,
              durable: true,
            },
          },
        }
        listener?.(projection)
        return markerResult()
      },
    )
    const bridge = {
      subscribe: vi.fn((next: (value: StudyBridgeProjection) => void) => {
        listener = next
        next(projection)
        return () => {
          listener = null
        }
      }),
      connect: vi.fn(async () => undefined),
      beginRecording,
    } as unknown as StudyBridgeClient
    const fixture = controllerFixture(bridge)
    const database = databaseFake({
      recoverActiveSession: vi.fn(async () => ({
        header: {
          sessionId: 'session-1',
          participantId: 'PH1',
          createdAt: '2026-08-29T10:00:00.000Z',
          updatedAt: '2026-08-29T10:01:00.000Z',
          latestRevision: 0,
          nextEventSequence: 0,
          finalized: false,
        },
        revision: { state: recoveredState },
      })),
    })
    vi.spyOn(StudyDatabase, 'open').mockResolvedValue(database as unknown as StudyDatabase)

    await fixture.controller.initialize()

    expect(beginRecording).toHaveBeenCalledWith(
      'session-1',
      recoveredState.revision,
      'begin-session-1',
      'observed',
    )
    expect(fixture.internals.companionStatus()).toMatchObject({
      bridgeConnected: true,
      startPreflightReady: true,
      remoteStartAllowed: true,
    })
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

  it('blocks a new session after failed APK finalization until a finalized recorder snapshot arrives', async () => {
    const sensor = bridgeFake()
    sensor.applySensorAction.mockResolvedValueOnce(markerResult(false))
    const fixture = controllerFixture(sensor.bridge)
    let state = blockReadyState()
    for (let blockIndex = 0; blockIndex < 3; blockIndex += 1) {
      state = assessmentReadyState(state)
      state = acceptedState(state, {
        type: 'advance_assessment',
        recordedAtUtc: `2026-08-29T10:1${blockIndex}:00.000Z`,
      })
    }
    state = assessmentReadyState(state)
    const database = databaseFake()
    fixture.internals.state = state
    fixture.internals.database = database as unknown as StudyDatabase
    fixture.internals.durableRevision = 0
    setReadyBridgeProjection(fixture.internals)

    await expect(fixture.internals.advanceAssessment()).resolves.toBe(false)
    expect(fixture.internals.state.page).toBe('complete')
    expect(fixture.internals.sessionFinalized).toBe(true)
    expect(sensor.applySensorAction).toHaveBeenCalledWith('finalize_recording', 'persisted')

    fixture.controller.createPanelActions().startNewSession()
    expect(fixture.internals.state.page).toBe('complete')
    expect(fixture.internals.localMessage).toContain('finalize_recording')

    const recordingProjection = fixture.internals.bridgeProjection!
    fixture.internals.bridgeProjection = {
      ...recordingProjection,
      snapshot: {
        ...recordingProjection.snapshot!,
        recording: {
          ...recordingProjection.snapshot!.recording,
          state: 'finalized',
          artifactOpen: false,
        },
      },
    }
    fixture.controller.createPanelActions().startNewSession()
    expect(fixture.internals.state).toEqual(createInitialExperimentState())
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
        { name: 'abort_session', args: {} },
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

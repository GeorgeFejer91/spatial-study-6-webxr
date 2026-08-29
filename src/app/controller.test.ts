import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./companion-controls.ts', () => ({
  CompanionControls: class {
    destroy(): void {}
  },
}))

import type { StudyMediaPlayer, StudyMediaSnapshot } from '../media/player.ts'
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
  applyAction(action: StudyAction): Promise<boolean>
  startParticipant(participantId: string): Promise<void>
  handleRemoteCommand(
    name: 'start_block',
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

function controllerFixture() {
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
    listParticipants: vi.fn(async () => []),
    recoverActiveSession: vi.fn(async () => null),
    close: vi.fn(),
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('StudyController runtime durability', () => {
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
      listParticipants: vi.fn(async () => [
        {
          participantId: 'PH1',
          pool: 'PH',
          permutation: 1,
          sessionId: 'session-1',
          reservedAt: '2026-08-29T10:00:00.000Z',
        },
      ]),
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
})

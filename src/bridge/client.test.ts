import { describe, expect, it, vi } from 'vitest'

import {
  acquisitionSnapshotPayload,
  apkHelloPayload,
  readyPolarProjection,
} from '../test/bridge-fixtures.ts'
import { createDefaultStudyBridgeClient, StudyBridgeClient } from './client.ts'
import {
  STUDY_BRIDGE_PROTOCOL,
  type ApkBridgeHelloPayload,
  type BridgeEnvelope,
  type BridgeErrorPayload,
  type BridgeExperimentMarker,
  type BridgeInboundEnvelope,
  type BridgeOutboundEnvelope,
  type BridgeReceiptPayload,
  type BridgeSnapshotPayload,
} from './contract.ts'
import { FakeStudyBridgeTransport } from './fake.ts'
import type {
  BridgeTransportEvent,
  BridgeTransportState,
  StudyBridgeTransport,
} from './transport.ts'

class RecoverableStudyBridgeTransport implements StudyBridgeTransport {
  private readonly listeners = new Set<(event: BridgeTransportEvent) => void>()
  private currentState: BridgeTransportState = 'idle'
  private readonly outcomes: Array<'open' | 'fault'>
  readonly sent: BridgeOutboundEnvelope[] = []
  connectCalls = 0
  closeCalls = 0

  constructor(outcomes: Array<'open' | 'fault'> = []) {
    this.outcomes = [...outcomes]
  }

  get state(): BridgeTransportState {
    return this.currentState
  }

  async connect(): Promise<void> {
    this.connectCalls += 1
    this.setState('connecting', 'Recoverable bridge connecting.')
    if ((this.outcomes.shift() ?? 'open') === 'fault') {
      this.setState('fault', 'Recoverable bridge unavailable.')
      throw new Error('Recoverable bridge unavailable.')
    }
    this.setState('open', 'Recoverable bridge connected.')
  }

  send(message: BridgeOutboundEnvelope): void {
    if (this.currentState !== 'open') throw new Error('Recoverable bridge is not open.')
    this.sent.push(structuredClone(message))
  }

  subscribe(listener: (event: BridgeTransportEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close(): void {
    this.closeCalls += 1
    this.setState('closed', 'Recoverable bridge stopped.')
  }

  receive(value: unknown): void {
    this.listeners.forEach((listener) => listener({ type: 'message', value }))
  }

  drop(detail = 'Sensor bridge closed (1006).'): void {
    this.setState('closed', detail)
  }

  private setState(state: BridgeTransportState, detail: string): void {
    this.currentState = state
    this.listeners.forEach((listener) => listener({ type: 'state', state, detail }))
  }
}

function fixture() {
  const transport = new FakeStudyBridgeTransport()
  let id = 0
  const client = new StudyBridgeClient({
    transport,
    bridgeLaunch: 'bridgeLaunchExample12345',
    browserPageEpoch: 'browser-page-1',
    browserInstanceId: 'browser-1',
    commandTimeoutMs: 1_000,
    createId: () => `generated-${++id}`,
  })
  const common = {
    protocol: STUDY_BRIDGE_PROTOCOL,
    bridgeProcessEpoch: 'apk-process-1',
    browserPageEpoch: 'browser-page-1',
    transportEpoch: client.snapshot().transportEpoch,
    revision: 0,
    sender: { role: 'apk' as const, instanceId: 'apk-1' },
    target: 'webxr' as const,
  }
  return { transport, client, common }
}

function hello(
  common: ReturnType<typeof fixture>['common'],
): BridgeEnvelope<'hello', ApkBridgeHelloPayload> {
  return {
    ...common,
    messageId: 'hello-1',
    type: 'hello',
    payload: apkHelloPayload(),
  }
}

function receipt(
  common: ReturnType<typeof fixture>['common'],
  commandId: string,
  payload: Partial<BridgeReceiptPayload>,
): BridgeEnvelope<'receipt', BridgeReceiptPayload> {
  return {
    ...common,
    revision: payload.effectiveRevision ?? 0,
    messageId: `receipt-${payload.stage ?? 'received'}`,
    correlationId: commandId,
    type: 'receipt',
    payload: {
      commandMessageId: commandId,
      stage: 'received',
      outcome: 'ok',
      detail: '',
      effectiveRevision: 0,
      ...payload,
    },
  }
}

function snapshot(
  common: ReturnType<typeof fixture>['common'],
  payload: BridgeSnapshotPayload,
): BridgeInboundEnvelope {
  return {
    ...common,
    revision: payload.recording.revision,
    messageId: `snapshot-${payload.recording.revision}`,
    type: 'snapshot',
    payload,
  }
}

function marker(id = 'marker-1'): BridgeExperimentMarker {
  return {
    markerId: id,
    eventType: 'media_started',
    webxrRevision: 7,
    sessionId: 'session-1',
    blockOrder: 1,
    conditionId: 'HC_HE',
    mediaId: 'media-1',
    mediaPositionMs: 0,
    browserMonotonicMs: 1234,
    browserUtc: '2026-08-30T10:00:00Z',
  }
}

describe('StudyBridgeClient sensor-recorder semantics', () => {
  it('scrubs secret bridge launch material while retaining the nonsecret launch query', () => {
    const original = `${window.location.pathname}${window.location.search}${window.location.hash}`
    const token = 'A'.repeat(43)
    window.history.replaceState(
      null,
      '',
      `/?bridgeLaunch=bridgeLaunchExample12345#bridgeWs=${encodeURIComponent('ws://127.0.0.1:8766/bridge')}&bridgeToken=${token}&view=researcher`,
    )
    const client = createDefaultStudyBridgeClient()
    try {
      expect(window.location.search).toBe('?bridgeLaunch=bridgeLaunchExample12345')
      expect(window.location.hash).toBe('#view=researcher')
      expect(window.location.href).not.toContain(token)
      expect(window.location.href).not.toContain('bridgeWs')
      expect(window.location.href).not.toContain('bridgeToken')
    } finally {
      client.close()
      window.history.replaceState(null, '', original)
    }
  })

  it('scrubs fragment launch material even when the descriptor is rejected', () => {
    const original = `${window.location.pathname}${window.location.search}${window.location.hash}`
    window.history.replaceState(
      null,
      '',
      '/?bridgeLaunch=bridgeLaunchExample12345#bridgeWs=ws%3A%2F%2F127.0.0.1%2Fbridge&bridgeToken=short&view=researcher',
    )
    try {
      expect(() => createDefaultStudyBridgeClient()).toThrow(/256-bit base64url/u)
      expect(window.location.hash).toBe('#view=researcher')
      expect(window.location.href).not.toContain('bridgeWs')
      expect(window.location.href).not.toContain('bridgeToken')
    } finally {
      window.history.replaceState(null, '', original)
    }
  })

  it('requires the sensor-provider hello before accepting recording status', async () => {
    const { client, transport, common } = fixture()
    await client.connect()
    const payload = acquisitionSnapshotPayload()
    transport.receive(snapshot(common, payload))
    expect(client.snapshot().sensorConnected).toBe(false)
    expect(client.snapshot().snapshot).toBeNull()

    transport.receive(hello(common))
    transport.receive(snapshot(common, payload))
    expect(client.snapshot()).toMatchObject({ sensorConnected: true, revision: 0 })
    transport.receive({
      ...common,
      messageId: 'polar-1',
      type: 'polar_status',
      payload: payload.polar,
    })
    expect(client.snapshot().snapshot?.recording.recordingEpoch).toBe('recording-epoch-1')
  })

  it('requires the complete v2 APK capability profile before reporting sensorConnected', async () => {
    const { client, transport, common } = fixture()
    await client.connect()
    const incomplete = apkHelloPayload()
    transport.receive({
      ...hello(common),
      payload: {
        ...incomplete,
        capabilities: incomplete.capabilities.filter(
          (capability) => capability !== 'session_owned_recording',
        ),
      },
    })
    expect(client.snapshot()).toMatchObject({
      sensorConnected: false,
      bridgeProcessEpoch: null,
    })
    expect(client.snapshot().connectionDetail).toContain('session_owned_recording')
  })

  it('identifies WebXR as experiment owner and waits for a durable marker snapshot', async () => {
    const { client, transport, common } = fixture()
    await client.connect()
    expect(transport.sent[0]).toMatchObject({
      type: 'hello',
      protocol: STUDY_BRIDGE_PROTOCOL,
      payload: {
        authority: 'webxr_experiment_owner',
        bridgeLaunch: 'bridgeLaunchExample12345',
      },
    })
    transport.receive(hello(common))
    transport.receive(snapshot(common, acquisitionSnapshotPayload()))

    const result = client.recordExperimentMarker(marker())
    await vi.waitFor(() =>
      expect(transport.sent.some((message) => message.type === 'command')).toBe(true),
    )
    const command = transport.sent.at(-1)
    expect(command).toMatchObject({
      sessionId: 'session-1',
      expectedRevision: 0,
      type: 'command',
      payload: {
        action: 'record_experiment_marker',
        marker: { markerId: 'marker-1', webxrRevision: 7 },
      },
    })
    const commandId = command!.messageId
    let settled = false
    void result.finally(() => {
      settled = true
    })

    transport.receive(receipt(common, commandId, { stage: 'accepted' }))
    await Promise.resolve()
    expect(settled).toBe(false)

    transport.receive(receipt(common, commandId, { stage: 'persisted', effectiveRevision: 1 }))
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(client.snapshot()).toMatchObject({ revision: 0, awaitingSnapshotRevision: 1 })
    const queuedReconnect = client.applySensorAction('reconnect_sensor', 'applied')
    expect(transport.sent.filter((message) => message.type === 'command')).toHaveLength(1)

    transport.receive(snapshot(common, acquisitionSnapshotPayload(1)))
    await expect(result).resolves.toMatchObject({
      accepted: true,
      stage: 'persisted',
      resultingRevision: 1,
    })
    expect(client.snapshot()).toMatchObject({ revision: 1, awaitingSnapshotRevision: null })
    await vi.waitFor(() =>
      expect(transport.sent.filter((message) => message.type === 'command')).toHaveLength(2),
    )
    const reconnectCommand = transport.sent.at(-1)!
    expect(reconnectCommand).toMatchObject({
      expectedRevision: 1,
      payload: { action: 'reconnect_sensor' },
    })
    transport.receive(
      receipt(common, reconnectCommand.messageId, {
        stage: 'applied',
        effectiveRevision: 1,
        outcome: 'reconnect_requested',
      }),
    )
    await expect(queuedReconnect).resolves.toMatchObject({
      stage: 'applied',
      resultingRevision: 1,
    })
  })

  it('begins a session-owned recording with matching envelope and payload identity', async () => {
    const { client, transport, common } = fixture()
    await client.connect()
    transport.receive(hello(common))
    transport.receive(snapshot(common, acquisitionSnapshotPayload()))

    const result = client.beginRecording('session-1', 7, 'recording-request-1')
    await vi.waitFor(() =>
      expect(transport.sent.filter((message) => message.type === 'command')).toHaveLength(1),
    )
    const command = transport.sent.at(-1)!
    expect(command).toMatchObject({
      sessionId: 'session-1',
      expectedRevision: 0,
      type: 'command',
      payload: {
        action: 'begin_recording',
        sessionId: 'session-1',
        webxrRevision: 7,
        recordingRequestId: 'recording-request-1',
      },
    })

    transport.receive(
      receipt(common, command.messageId, {
        stage: 'observed',
        effectiveRevision: 1,
        outcome: 'recording_session_started',
      }),
    )
    const owned = acquisitionSnapshotPayload(1)
    owned.recording.ownerSessionId = 'session-1'
    transport.receive({ ...snapshot(common, owned), sessionId: 'session-1' })

    await expect(result).resolves.toMatchObject({
      stage: 'observed',
      resultingRevision: 1,
    })
    expect(client.snapshot()).toMatchObject({
      sessionId: 'session-1',
      snapshot: { recording: { ownerSessionId: 'session-1' } },
    })
  })

  it('projects only monotonic recording snapshots from current page and transport epochs', async () => {
    const { client, transport, common } = fixture()
    await client.connect()
    transport.receive(hello(common))
    transport.receive(snapshot(common, acquisitionSnapshotPayload(2)))
    expect(client.snapshot().revision).toBe(2)

    transport.receive(snapshot(common, acquisitionSnapshotPayload(1)))
    expect(client.snapshot().revision).toBe(2)

    transport.receive({
      ...snapshot(common, acquisitionSnapshotPayload(3)),
      browserPageEpoch: 'old-page',
    })
    expect(client.snapshot().connectionDetail).toContain('stale browser page')
    expect(client.snapshot().revision).toBe(2)
    client.close()
  })

  it('rejects an in-flight sensor command on an APK process restart', async () => {
    const { client, transport, common } = fixture()
    await client.connect()
    transport.receive(hello(common))
    transport.receive(snapshot(common, acquisitionSnapshotPayload()))
    const command = client.applySensorAction('request_status', 'observed')
    await vi.waitFor(() =>
      expect(transport.sent.some((message) => message.type === 'command')).toBe(true),
    )
    transport.receive({ ...hello(common), bridgeProcessEpoch: 'apk-process-2', messageId: 'hello-2' })
    await expect(command).rejects.toThrow(/process restarted/u)
  })

  it('downgrades readiness when the APK stops providing fresh Polar observations', async () => {
    vi.useFakeTimers()
    const { client, transport, common } = fixture()
    await client.connect()
    transport.receive(hello(common))
    transport.receive(snapshot(common, acquisitionSnapshotPayload()))
    transport.receive({
      ...common,
      messageId: 'polar-ready-1',
      type: 'polar_status',
      payload: readyPolarProjection(),
    })
    expect(client.snapshot().polar.ready).toBe(true)
    await vi.advanceTimersByTimeAsync(2_001)
    expect(client.snapshot().polar).toMatchObject({
      ready: false,
      lastSampleAgeMs: 2_001,
    })
    expect(client.snapshot().polar.readinessReason).toContain('stale')
    client.close()
    vi.useRealTimers()
  })

  it('surfaces a correlated recorder revision mismatch without rebasing a marker', async () => {
    const { client, transport, common } = fixture()
    await client.connect()
    transport.receive(hello(common))
    transport.receive(snapshot(common, acquisitionSnapshotPayload()))
    const command = client.recordExperimentMarker(marker('marker-stale'))
    await vi.waitFor(() =>
      expect(transport.sent.some((message) => message.type === 'command')).toBe(true),
    )
    const commandId = transport.sent.at(-1)!.messageId
    const payload: BridgeErrorPayload = {
      code: 'revision_mismatch',
      detail: 'Expected recorder revision 0; current revision is 2.',
      currentRevision: 2,
      retryable: true,
    }
    transport.receive({
      ...common,
      revision: 2,
      messageId: 'error-1',
      correlationId: commandId,
      type: 'error',
      payload,
    })
    await expect(command).rejects.toThrow(/revision_mismatch/u)
    expect(client.snapshot().lastError).toEqual(payload)
  })

  it('recovers a 1006 close with a fresh transport epoch and a fresh hello/snapshot gate', async () => {
    vi.useFakeTimers()
    const transport = new RecoverableStudyBridgeTransport()
    let id = 0
    const client = new StudyBridgeClient({
      transport,
      bridgeLaunch: 'bridgeLaunchExample12345',
      browserPageEpoch: 'browser-page-recovery',
      browserInstanceId: 'browser-recovery',
      reconnectDelaysMs: [100, 200, 400],
      createId: () => `recovery-${++id}`,
    })
    await client.connect()
    const initialHello = transport.sent.find((message) => message.type === 'hello')!
    const incoming = (transportEpoch: string) => ({
      protocol: STUDY_BRIDGE_PROTOCOL,
      bridgeProcessEpoch: 'apk-process-recovery',
      browserPageEpoch: 'browser-page-recovery',
      transportEpoch,
      revision: 0,
      sender: { role: 'apk' as const, instanceId: 'apk-recovery' },
      target: 'webxr' as const,
    })

    transport.receive(hello(incoming(initialHello.transportEpoch)))
    expect(client.snapshot().sensorConnected).toBe(false)
    transport.receive(snapshot(incoming(initialHello.transportEpoch), acquisitionSnapshotPayload()))
    expect(client.snapshot().sensorConnected).toBe(true)

    transport.drop()
    expect(client.snapshot()).toMatchObject({
      connection: 'closed',
      sensorConnected: false,
      snapshot: null,
    })
    await vi.advanceTimersByTimeAsync(99)
    expect(transport.connectCalls).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(transport.connectCalls).toBe(2)

    const sentHellos = transport.sent.filter((message) => message.type === 'hello')
    expect(sentHellos).toHaveLength(2)
    const recoveryHello = sentHellos[1]!
    expect(recoveryHello.transportEpoch).not.toBe(initialHello.transportEpoch)
    expect(recoveryHello.browserPageEpoch).toBe(initialHello.browserPageEpoch)
    expect(recoveryHello.bridgeProcessEpoch).toBe('unbound')
    expect(recoveryHello).not.toHaveProperty('sessionId')
    expect(recoveryHello.revision).toBe(0)
    expect(recoveryHello.payload.bridgeLaunch).toBe(initialHello.payload.bridgeLaunch)

    transport.receive(snapshot(incoming(initialHello.transportEpoch), acquisitionSnapshotPayload()))
    expect(client.snapshot().sensorConnected).toBe(false)
    transport.receive(hello(incoming(recoveryHello.transportEpoch)))
    expect(client.snapshot().sensorConnected).toBe(false)
    transport.receive(snapshot(incoming(recoveryHello.transportEpoch), acquisitionSnapshotPayload()))
    expect(client.snapshot()).toMatchObject({
      connection: 'open',
      sensorConnected: true,
      transportEpoch: recoveryHello.transportEpoch,
    })
    client.close()
    vi.useRealTimers()
  })

  it('rejects an uncertain command on disconnect and never replays it after recovery', async () => {
    vi.useFakeTimers()
    const transport = new RecoverableStudyBridgeTransport()
    let id = 0
    const client = new StudyBridgeClient({
      transport,
      bridgeLaunch: 'bridgeLaunchExample12345',
      browserPageEpoch: 'browser-page-no-replay',
      browserInstanceId: 'browser-no-replay',
      reconnectDelaysMs: [50],
      createId: () => `no-replay-${++id}`,
    })
    await client.connect()
    const firstHello = transport.sent[0]!
    const common = {
      protocol: STUDY_BRIDGE_PROTOCOL,
      bridgeProcessEpoch: 'apk-process-no-replay',
      browserPageEpoch: 'browser-page-no-replay',
      transportEpoch: firstHello.transportEpoch,
      revision: 0,
      sender: { role: 'apk' as const, instanceId: 'apk-no-replay' },
      target: 'webxr' as const,
    }
    transport.receive(hello(common))
    transport.receive(snapshot(common, acquisitionSnapshotPayload()))

    const command = client.applySensorAction('request_status', 'observed')
    await vi.advanceTimersByTimeAsync(0)
    expect(transport.sent.filter((message) => message.type === 'command')).toHaveLength(1)
    transport.drop()
    await expect(command).rejects.toThrow(/1006/u)
    await vi.advanceTimersByTimeAsync(50)
    const recoveryHello = transport.sent.filter((message) => message.type === 'hello')[1]!
    const recoveryCommon = { ...common, transportEpoch: recoveryHello.transportEpoch }
    transport.receive(hello(recoveryCommon))
    transport.receive(snapshot(recoveryCommon, acquisitionSnapshotPayload()))
    await vi.advanceTimersByTimeAsync(0)
    expect(transport.sent.filter((message) => message.type === 'command')).toHaveLength(1)
    client.close()
    vi.useRealTimers()
  })

  it('uses capped exponential reconnect delays and only one timer per failed attempt', async () => {
    vi.useFakeTimers()
    const transport = new RecoverableStudyBridgeTransport([
      'fault',
      'fault',
      'fault',
      'fault',
      'open',
    ])
    const client = new StudyBridgeClient({
      transport,
      bridgeLaunch: 'bridgeLaunchExample12345',
      reconnectDelaysMs: [100, 200, 400],
      createId: (() => {
        let id = 0
        return () => `backoff-${++id}`
      })(),
    })
    await expect(client.connect()).rejects.toThrow(/unavailable/u)
    expect(transport.connectCalls).toBe(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(transport.connectCalls).toBe(2)
    await vi.advanceTimersByTimeAsync(200)
    expect(transport.connectCalls).toBe(3)
    await vi.advanceTimersByTimeAsync(400)
    expect(transport.connectCalls).toBe(4)
    await vi.advanceTimersByTimeAsync(399)
    expect(transport.connectCalls).toBe(4)
    await vi.advanceTimersByTimeAsync(1)
    expect(transport.connectCalls).toBe(5)
    expect(transport.sent.filter((message) => message.type === 'hello')).toHaveLength(1)
    client.close()
    vi.useRealTimers()
  })

  it('retires an open transport that never provides the fresh hello/snapshot pair', async () => {
    vi.useFakeTimers()
    const transport = new RecoverableStudyBridgeTransport()
    let id = 0
    const client = new StudyBridgeClient({
      transport,
      bridgeLaunch: 'bridgeLaunchExample12345',
      browserPageEpoch: 'browser-page-handshake-timeout',
      browserInstanceId: 'browser-handshake-timeout',
      handshakeTimeoutMs: 80,
      reconnectDelaysMs: [20],
      createId: () => `handshake-timeout-${++id}`,
    })
    await client.connect()
    await vi.advanceTimersByTimeAsync(79)
    expect(transport.closeCalls).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(transport.closeCalls).toBe(1)
    expect(client.snapshot().sensorConnected).toBe(false)
    await vi.advanceTimersByTimeAsync(20)
    expect(transport.connectCalls).toBe(2)

    const recoveryHello = transport.sent.filter((message) => message.type === 'hello')[1]!
    const common = {
      protocol: STUDY_BRIDGE_PROTOCOL,
      bridgeProcessEpoch: 'apk-process-handshake-timeout',
      browserPageEpoch: 'browser-page-handshake-timeout',
      transportEpoch: recoveryHello.transportEpoch,
      revision: 0,
      sender: { role: 'apk' as const, instanceId: 'apk-handshake-timeout' },
      target: 'webxr' as const,
    }
    transport.receive(hello(common))
    transport.receive(snapshot(common, acquisitionSnapshotPayload()))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(transport.closeCalls).toBe(1)
    expect(client.snapshot().sensorConnected).toBe(true)
    client.close()
    vi.useRealTimers()
  })

  it('treats close as authoritative and fences a scheduled reconnect', async () => {
    vi.useFakeTimers()
    const transport = new RecoverableStudyBridgeTransport()
    const client = new StudyBridgeClient({
      transport,
      bridgeLaunch: 'bridgeLaunchExample12345',
      reconnectDelaysMs: [100],
    })
    await client.connect()
    transport.drop()
    client.close()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(transport.connectCalls).toBe(1)
    expect(transport.closeCalls).toBe(1)
    await expect(client.connect()).rejects.toThrow(/closed/u)
    vi.useRealTimers()
  })

  it('times out without synthesizing a durable sensor receipt', async () => {
    vi.useFakeTimers()
    const { client, transport, common } = fixture()
    await client.connect()
    transport.receive(hello(common))
    transport.receive(snapshot(common, acquisitionSnapshotPayload()))
    const command = client.applySensorAction('request_status')
    const rejection = expect(command).rejects.toThrow(/timed out before persisted plus/u)
    await vi.advanceTimersByTimeAsync(1_001)
    await rejection
    vi.useRealTimers()
  })
})

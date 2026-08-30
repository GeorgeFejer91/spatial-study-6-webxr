import { describe, expect, it, vi } from 'vitest'

import {
  acquisitionSnapshotPayload,
  apkHelloPayload,
  readyPolarProjection,
} from '../test/bridge-fixtures.ts'
import { StudyBridgeClient } from './client.ts'
import {
  STUDY_BRIDGE_PROTOCOL,
  type BridgeEnvelope,
  type BridgeErrorPayload,
  type BridgeExperimentMarker,
  type BridgeHelloPayload,
  type BridgeInboundEnvelope,
  type BridgeReceiptPayload,
  type BridgeSnapshotPayload,
} from './contract.ts'
import { FakeStudyBridgeTransport } from './fake.ts'

function fixture() {
  const transport = new FakeStudyBridgeTransport()
  let id = 0
  const client = new StudyBridgeClient({
    transport,
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
): BridgeEnvelope<'hello', BridgeHelloPayload> {
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

  it('identifies WebXR as experiment owner and waits for a durable marker snapshot', async () => {
    const { client, transport, common } = fixture()
    await client.connect()
    expect(transport.sent[0]).toMatchObject({
      type: 'hello',
      protocol: STUDY_BRIDGE_PROTOCOL,
      payload: { authority: 'webxr_experiment_owner' },
    })
    transport.receive(hello(common))
    transport.receive(snapshot(common, acquisitionSnapshotPayload()))

    const result = client.recordExperimentMarker(marker())
    await vi.waitFor(() =>
      expect(transport.sent.some((message) => message.type === 'command')).toBe(true),
    )
    const command = transport.sent.at(-1)
    expect(command).toMatchObject({
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

  it('times out without synthesizing a durable sensor receipt', async () => {
    vi.useFakeTimers()
    const { client, transport, common } = fixture()
    await client.connect()
    transport.receive(hello(common))
    const command = client.applySensorAction('request_status')
    const rejection = expect(command).rejects.toThrow(/timed out before persisted plus/u)
    await vi.advanceTimersByTimeAsync(1_001)
    await rejection
    vi.useRealTimers()
  })
})

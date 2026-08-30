import { describe, expect, it } from 'vitest'

import { acquisitionSnapshotPayload, readyPolarProjection } from '../test/bridge-fixtures.ts'
import {
  disconnectedPolarStatus,
  parseBridgeExperimentMarker,
  parseBridgeInboundEnvelope,
  parseBridgeOutboundEnvelope,
  polarProjectionIsReady,
  STUDY_BRIDGE_PROTOCOL,
  type BridgeEnvelope,
  type BridgeSnapshotPayload,
} from './contract.ts'

function snapshotEnvelope(): BridgeEnvelope<'snapshot', BridgeSnapshotPayload> {
  return {
    protocol: STUDY_BRIDGE_PROTOCOL,
    bridgeProcessEpoch: 'apk-process-1',
    browserPageEpoch: 'browser-page-1',
    transportEpoch: 'transport-1',
    revision: 0,
    messageId: 'snapshot-1',
    sender: { role: 'apk', instanceId: 'apk-1' },
    target: 'webxr',
    type: 'snapshot',
    payload: acquisitionSnapshotPayload(),
  }
}

describe('study6.bridge.v2 contract', () => {
  it('accepts the bounded recording snapshot from the APK sensor provider', () => {
    const message = parseBridgeInboundEnvelope(snapshotEnvelope())
    expect(message.type).toBe('snapshot')
    if (message.type !== 'snapshot') throw new Error('Expected snapshot.')
    expect(message.payload.recording).toMatchObject({
      recordingEpoch: 'recording-epoch-1',
      ownerSessionId: null,
      state: 'recording',
      revision: 0,
    })
    expect(message.payload.polar.readinessReason).toBe('sensor-not-connected')
  })

  it('rejects controller-originated data on the APK-to-WebXR channel', () => {
    const value = snapshotEnvelope()
    value.sender = { role: 'controller', instanceId: 'wrong-route' }
    expect(() => parseBridgeInboundEnvelope(value)).toThrow(/sender must be apk/u)
  })

  it('rejects broadcast APK data outside the canonical point-to-point route', () => {
    const value = snapshotEnvelope()
    value.target = 'broadcast'
    expect(() => parseBridgeInboundEnvelope(value)).toThrow(/must target webxr/u)
  })

  it('rejects unknown envelope and nested payload fields like the native strict decoder', () => {
    const envelope = snapshotEnvelope() as unknown as Record<string, unknown>
    envelope.unexpected = true
    expect(() => parseBridgeInboundEnvelope(envelope)).toThrow()

    const nested = snapshotEnvelope() as unknown as {
      payload: { polar: Record<string, unknown> }
    }
    nested.payload.polar.unexpected = true
    expect(() => parseBridgeInboundEnvelope(nested)).toThrow()
  })

  it('fails closed unless real, fresh, stable 130 Hz ECG and its writer are healthy', () => {
    const ready = readyPolarProjection()
    expect(polarProjectionIsReady(ready)).toBe(true)
    expect(polarProjectionIsReady({ ...ready, ecgSampleRateHz: 128 })).toBe(false)
    expect(polarProjectionIsReady({ ...ready, previewKind: 'none', waveformMicrovolts: [] })).toBe(
      false,
    )
    expect(
      polarProjectionIsReady({ ...ready, writer: { ...ready.writer, healthy: false } }),
    ).toBe(false)
    expect(polarProjectionIsReady({ ...ready, lastSampleAgeMs: 2_001 })).toBe(false)
    expect(polarProjectionIsReady(disconnectedPolarStatus())).toBe(false)
  })

  it('rejects experiment state or participant data leaked into a sensor snapshot', () => {
    const leaked = snapshotEnvelope() as unknown as {
      payload: Record<string, unknown>
    }
    leaked.payload.state = { participantId: 'must-not-cross-the-sensor-channel' }
    expect(() => parseBridgeInboundEnvelope(leaked)).toThrow()
  })

  it('binds every staged receipt to the same command in its envelope and payload', () => {
    const receipt = {
      protocol: STUDY_BRIDGE_PROTOCOL,
      bridgeProcessEpoch: 'apk-process-1',
      browserPageEpoch: 'browser-page-1',
      transportEpoch: 'transport-1',
      revision: 1,
      messageId: 'receipt-1',
      correlationId: 'command-a',
      sender: { role: 'apk', instanceId: 'apk-1' },
      target: 'webxr',
      type: 'receipt',
      payload: {
        commandMessageId: 'command-b',
        stage: 'persisted',
        outcome: 'persisted',
        effectiveRevision: 1,
      },
    }
    expect(() => parseBridgeInboundEnvelope(receipt)).toThrow(/correlationId/u)
  })

  it.each(['block_start_intent', 'media_started', 'block_completed'] as const)(
    'requires the complete block tuple for %s markers',
    (eventType) => {
      const marker = {
        markerId: `marker-${eventType}`,
        eventType,
        webxrRevision: 8,
        browserMonotonicMs: 12_000,
        browserUtc: '2026-08-30T12:00:00Z',
      }
      expect(() => parseBridgeExperimentMarker(marker)).toThrow()
      expect(
        parseBridgeExperimentMarker({
          ...marker,
          sessionId: 'session-001',
          blockOrder: 1,
          conditionId: 'HC_HE',
          mediaId: 'Hand_HC_HE',
        }),
      ).toMatchObject({ eventType, sessionId: 'session-001' })
    },
  )

  it('binds recording and marker payload sessions to their command envelopes', () => {
    const common = {
      protocol: STUDY_BRIDGE_PROTOCOL,
      sessionId: 'session-001',
      bridgeProcessEpoch: 'apk-process-1',
      browserPageEpoch: 'browser-page-1',
      transportEpoch: 'transport-1',
      revision: 0,
      messageId: 'command-1',
      expectedRevision: 0,
      sender: { role: 'webxr', instanceId: 'browser-1' },
      target: 'apk',
      type: 'command',
    }
    const begin = {
      ...common,
      payload: {
        action: 'begin_recording',
        sessionId: 'session-001',
        webxrRevision: 7,
        recordingRequestId: 'recording-request-1',
      },
    }
    expect(parseBridgeOutboundEnvelope(begin)).toMatchObject({ sessionId: 'session-001' })
    expect(() =>
      parseBridgeOutboundEnvelope({ ...begin, sessionId: 'different-session' }),
    ).toThrow(/must match payload.sessionId/u)

    const marker = {
      ...common,
      payload: {
        action: 'record_experiment_marker',
        marker: {
          markerId: 'marker-1',
          eventType: 'media_started',
          webxrRevision: 8,
          sessionId: 'session-001',
          blockOrder: 1,
          conditionId: 'HC_HE',
          mediaId: 'Hand_HC_HE',
          browserMonotonicMs: 12_000,
          browserUtc: '2026-08-30T12:00:00Z',
        },
      },
    }
    expect(parseBridgeOutboundEnvelope(marker)).toMatchObject({ sessionId: 'session-001' })
    expect(() =>
      parseBridgeOutboundEnvelope({ ...marker, sessionId: 'different-session' }),
    ).toThrow(/must match marker.sessionId/u)
  })
})

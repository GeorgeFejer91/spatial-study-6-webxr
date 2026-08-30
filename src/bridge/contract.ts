import { z } from 'zod'

export const STUDY_BRIDGE_PROTOCOL = 'study6.bridge.v2' as const
export const STUDY_BRIDGE_SCHEMA_REVISION = 2 as const
export const MAX_STUDY_BRIDGE_MESSAGE_BYTES = 65_536 as const
export const PLACEHOLDER_STIMULUS_MODE = 'placeholder.v1' as const

export const REQUIRED_APK_BRIDGE_CAPABILITIES = [
  'begin_recording',
  'session_owned_recording',
  'durable_markers',
  'polar_status_projection',
] as const

export type BridgeRole = 'apk' | 'webxr' | 'controller'
export type BridgeTarget = 'apk' | 'webxr' | 'controller' | 'broadcast'
export type BridgeMessageType =
  | 'hello'
  | 'snapshot'
  | 'polar_status'
  | 'command'
  | 'receipt'
  | 'error'

export interface BridgeSender {
  role: BridgeRole
  instanceId: string
}

export interface BridgeEnvelope<
  TType extends BridgeMessageType = BridgeMessageType,
  TPayload = unknown,
> {
  protocol: typeof STUDY_BRIDGE_PROTOCOL
  sessionId?: string
  bridgeProcessEpoch: string
  browserPageEpoch?: string
  transportEpoch: string
  revision: number
  messageId: string
  correlationId?: string
  expectedRevision?: number
  deadlineElapsedRealtimeMs?: number
  sender: BridgeSender
  target: BridgeTarget
  type: TType
  payload: TPayload
}

export type PolarConnectionPhase =
  | 'unavailable'
  | 'permission_required'
  | 'scanning'
  | 'detected'
  | 'connecting'
  | 'connected'
  | 'streaming'
  | 'fault'

export type PolarWriterPhase = 'idle' | 'recording' | 'fault'

/**
 * Bounded, non-identifying projection of the APK-owned Polar stream.
 * `waveformMicrovolts` may contain only real PMD samples; simulated samples
 * must use previewKind `none` and an empty array.
 */
export interface PolarStatusProjection {
  phase: PolarConnectionPhase
  ready: boolean
  readinessReason: string
  heartRateBpm: number | null
  rrIntervalCount: number
  ecgSampleRateHz: number | null
  ecgSampleCount: number
  lastSampleAgeMs: number | null
  stableDurationMs: number | null
  previewKind: 'none' | 'real_samples'
  waveformMicrovolts: readonly number[]
  writer: {
    phase: PolarWriterPhase
    healthy: boolean
    queueDepth: number
    storageFreeBytes: number | null
  }
  reconnectCount: number
  gapCount: number
}

export interface BridgeSnapshotPayload {
  recording: SensorRecordingProjection
  polar: PolarStatusProjection
}

export type SensorRecordingState = 'recording' | 'finalized' | 'fault'

export interface SensorRecordingProjection {
  recordingEpoch: string
  ownerSessionId: string | null
  state: SensorRecordingState
  revision: number
  markerCount: number
  samplesWritten: number
  droppedBatches: number
  artifactOpen: boolean
  durable: boolean
}

interface BridgeHelloPayloadBase {
  schemaRevision: typeof STUDY_BRIDGE_SCHEMA_REVISION
  buildId: string
  capabilities: readonly string[]
}

export interface ApkBridgeHelloPayload extends BridgeHelloPayloadBase {
  authority: 'sensor_recorder_provider'
}

export interface WebXrBridgeHelloPayload extends BridgeHelloPayloadBase {
  authority: 'webxr_experiment_owner'
  bridgeLaunch: string
}

export type BridgeHelloPayload = ApkBridgeHelloPayload | WebXrBridgeHelloPayload

export const BRIDGE_RECEIPT_STAGES = [
  'received',
  'authorized',
  'accepted',
  'persisted',
  'applied',
  'observed',
] as const

export type BridgeReceiptStage = (typeof BRIDGE_RECEIPT_STAGES)[number]

export interface BridgeReceiptPayload {
  commandMessageId: string
  stage: BridgeReceiptStage
  outcome: string
  detail?: string
  effectiveRevision: number
  effectId?: string
}

export interface BridgeErrorPayload {
  code: string
  detail: string
  currentRevision: number
  retryable: boolean
}

export const BRIDGE_SENSOR_ACTIONS = [
  'request_status',
  'reconnect_sensor',
  'begin_recording',
  'record_experiment_marker',
  'finalize_recording',
  'request_sensor_export',
  'return_to_experiment',
] as const

export type BridgeSensorAction = (typeof BRIDGE_SENSOR_ACTIONS)[number]

export const EXPERIMENT_MARKER_EVENT_TYPES = [
  'experiment_ready',
  'block_start_intent',
  'media_started',
  'media_paused',
  'media_resumed',
  'media_ended',
  'block_completed',
  'technical_hold',
  'session_aborted',
  'session_finalized',
] as const

export type ExperimentMarkerEventType = (typeof EXPERIMENT_MARKER_EVENT_TYPES)[number]

/** Privacy-minimized metadata written next to ECG; never contains answers or demographics. */
export interface BridgeExperimentMarker {
  markerId: string
  eventType: ExperimentMarkerEventType
  webxrRevision: number
  sessionId?: string
  blockOrder?: number
  conditionId?: 'HC_HE' | 'LC_HE' | 'HC_LE' | 'LC_LE'
  mediaId?: string
  mediaPositionMs?: number
  browserMonotonicMs: number
  browserUtc: string
}

export type BridgeCommandPayload =
  | {
      action: 'begin_recording'
      sessionId: string
      webxrRevision: number
      recordingRequestId: string
    }
  | { action: 'record_experiment_marker'; marker: BridgeExperimentMarker }
  | {
      action: Exclude<BridgeSensorAction, 'begin_recording' | 'record_experiment_marker'>
    }

export type BridgeInboundEnvelope =
  | BridgeEnvelope<'hello', ApkBridgeHelloPayload>
  | BridgeEnvelope<'snapshot', BridgeSnapshotPayload>
  | BridgeEnvelope<'polar_status', PolarStatusProjection>
  | BridgeEnvelope<'receipt', BridgeReceiptPayload>
  | BridgeEnvelope<'error', BridgeErrorPayload>

export type BridgeOutboundEnvelope =
  | BridgeEnvelope<'hello', WebXrBridgeHelloPayload>
  | BridgeEnvelope<'command', BridgeCommandPayload>

const senderSchema = z.object({
  role: z.enum(['apk', 'webxr', 'controller']),
  instanceId: z.string().min(1).max(128),
}).strict()

const envelopeSchema = z.object({
  protocol: z.literal(STUDY_BRIDGE_PROTOCOL),
  sessionId: z.string().regex(/^[A-Za-z0-9._-]{1,96}$/u).optional(),
  bridgeProcessEpoch: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u),
  browserPageEpoch: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u).optional(),
  transportEpoch: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u),
  revision: z.number().int().nonnegative(),
  messageId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u),
  correlationId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u).optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
  deadlineElapsedRealtimeMs: z.number().int().positive().optional(),
  sender: senderSchema,
  target: z.enum(['apk', 'webxr', 'controller', 'broadcast']),
  type: z.enum(['hello', 'snapshot', 'polar_status', 'command', 'receipt', 'error']),
  payload: z.unknown(),
}).strict()

const apkHelloSchema = z.object({
  schemaRevision: z.literal(STUDY_BRIDGE_SCHEMA_REVISION),
  buildId: z.string().min(1).max(96),
  capabilities: z.array(z.string().min(1).max(128)).max(64),
  authority: z.literal('sensor_recorder_provider'),
}).strict()

const webXrHelloSchema = z.object({
  schemaRevision: z.literal(STUDY_BRIDGE_SCHEMA_REVISION),
  buildId: z.string().min(1).max(96),
  capabilities: z.array(z.string().min(1).max(128)).max(64),
  authority: z.literal('webxr_experiment_owner'),
  bridgeLaunch: z.string().regex(/^[A-Za-z0-9_-]{16,96}$/u),
}).strict()

const BLOCK_TUPLE_MARKER_TYPES = new Set<ExperimentMarkerEventType>([
  'block_start_intent',
  'media_started',
  'block_completed',
])

const experimentMarkerSchema = z.object({
  markerId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u),
  eventType: z.enum(EXPERIMENT_MARKER_EVENT_TYPES),
  webxrRevision: z.number().int().nonnegative(),
  sessionId: z.string().regex(/^[A-Za-z0-9._-]{1,96}$/u).optional(),
  blockOrder: z.number().int().min(1).max(4).optional(),
  conditionId: z.enum(['HC_HE', 'LC_HE', 'HC_LE', 'LC_LE']).optional(),
  mediaId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u).optional(),
  mediaPositionMs: z.number().int().nonnegative().optional(),
  browserMonotonicMs: z.number().int().nonnegative(),
  browserUtc: z.string().datetime({ offset: true }),
}).strict().superRefine((marker, context) => {
  if (!BLOCK_TUPLE_MARKER_TYPES.has(marker.eventType)) return
  for (const field of ['sessionId', 'blockOrder', 'conditionId', 'mediaId'] as const) {
    if (marker[field] === undefined) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: `${marker.eventType} requires ${field}.`,
      })
    }
  }
})

const polarStatusSchema = z.object({
  phase: z.enum([
    'unavailable',
    'permission_required',
    'scanning',
    'detected',
    'connecting',
    'connected',
    'streaming',
    'fault',
  ]),
  ready: z.boolean(),
  readinessReason: z.string().max(256),
  heartRateBpm: z.number().int().min(20).max(260).nullable(),
  rrIntervalCount: z.number().int().nonnegative(),
  ecgSampleRateHz: z.number().int().positive().max(2_000).nullable(),
  ecgSampleCount: z.number().int().nonnegative(),
  lastSampleAgeMs: z.number().int().nonnegative().nullable(),
  stableDurationMs: z.number().int().nonnegative().nullable(),
  previewKind: z.enum(['none', 'real_samples']),
  waveformMicrovolts: z.array(z.number().finite().min(-10_000_000).max(10_000_000)).max(256),
  writer: z.object({
    phase: z.enum(['idle', 'recording', 'fault']),
    healthy: z.boolean(),
    queueDepth: z.number().int().nonnegative(),
    storageFreeBytes: z.number().int().nonnegative().nullable(),
  }).strict(),
  reconnectCount: z.number().int().nonnegative(),
  gapCount: z.number().int().nonnegative(),
}).strict()

const snapshotSchema = z.object({
  recording: z.object({
    recordingEpoch: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u),
    ownerSessionId: z.string().regex(/^[A-Za-z0-9._-]{1,96}$/u).nullable(),
    state: z.enum(['recording', 'finalized', 'fault']),
    revision: z.number().int().nonnegative(),
    markerCount: z.number().int().nonnegative(),
    samplesWritten: z.number().int().nonnegative(),
    droppedBatches: z.number().int().nonnegative(),
    artifactOpen: z.boolean(),
    durable: z.boolean(),
  }).strict(),
  polar: polarStatusSchema,
}).strict()

const beginRecordingCommandSchema = z.object({
  action: z.literal('begin_recording'),
  sessionId: z.string().regex(/^[A-Za-z0-9._-]{1,96}$/u),
  webxrRevision: z.number().int().nonnegative(),
  recordingRequestId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u),
}).strict()

const markerCommandSchema = z.object({
  action: z.literal('record_experiment_marker'),
  marker: experimentMarkerSchema,
}).strict()

const noArgumentCommandSchema = z.object({
  action: z.enum([
    'request_status',
    'reconnect_sensor',
    'finalize_recording',
    'request_sensor_export',
    'return_to_experiment',
  ]),
}).strict()

const commandSchema = z.discriminatedUnion('action', [
  beginRecordingCommandSchema,
  markerCommandSchema,
  noArgumentCommandSchema,
])

const receiptSchema = z.object({
  commandMessageId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u),
  stage: z.enum(BRIDGE_RECEIPT_STAGES),
  outcome: z.string().min(1).max(96),
  detail: z.string().max(512).optional(),
  effectiveRevision: z.number().int().nonnegative(),
  effectId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u).optional(),
}).strict()

const errorSchema = z.object({
  code: z.string().regex(/^[a-z0-9_]{1,96}$/u),
  detail: z.string().max(512),
  currentRevision: z.number().int().nonnegative(),
  retryable: z.boolean(),
}).strict()

export function disconnectedPolarStatus(reason = 'Sensor bridge unavailable'): PolarStatusProjection {
  return {
    phase: 'unavailable',
    ready: false,
    readinessReason: reason,
    heartRateBpm: null,
    rrIntervalCount: 0,
    ecgSampleRateHz: null,
    ecgSampleCount: 0,
    lastSampleAgeMs: null,
    stableDurationMs: null,
    previewKind: 'none',
    waveformMicrovolts: [],
    writer: {
      phase: 'idle',
      healthy: false,
      queueDepth: 0,
      storageFreeBytes: null,
    },
    reconnectCount: 0,
    gapCount: 0,
  }
}

export function polarProjectionFromStatus(
  payload: PolarStatusProjection,
  _previous: PolarStatusProjection = disconnectedPolarStatus(),
): PolarStatusProjection {
  return structuredClone(payload)
}

export function polarProjectionFromSnapshot(payload: BridgeSnapshotPayload): PolarStatusProjection {
  return structuredClone(payload.polar)
}

/** Fail closed: only real, current, stable 130 Hz PMD data with a healthy writer is ready. */
export function polarProjectionIsReady(status: PolarStatusProjection): boolean {
  return (
    status.ready &&
    status.phase === 'streaming' &&
    status.heartRateBpm !== null &&
    status.ecgSampleRateHz === 130 &&
    status.ecgSampleCount > 0 &&
    status.lastSampleAgeMs !== null &&
    status.lastSampleAgeMs <= 2_000 &&
    status.stableDurationMs !== null &&
    status.stableDurationMs >= 3_000 &&
    status.previewKind === 'real_samples' &&
    status.waveformMicrovolts.length > 0 &&
    status.writer.phase === 'recording' &&
    status.writer.healthy
  )
}

export function bridgeReceiptStageIndex(stage: BridgeReceiptStage): number {
  return BRIDGE_RECEIPT_STAGES.indexOf(stage)
}

export function missingRequiredApkBridgeCapabilities(
  capabilities: readonly string[],
): readonly (typeof REQUIRED_APK_BRIDGE_CAPABILITIES)[number][] {
  const advertised = new Set(capabilities)
  return REQUIRED_APK_BRIDGE_CAPABILITIES.filter((capability) => !advertised.has(capability))
}

export function parseBridgeExperimentMarker(value: unknown): BridgeExperimentMarker {
  return experimentMarkerSchema.parse(value)
}

export function parseBridgeInboundEnvelope(value: unknown): BridgeInboundEnvelope {
  const envelope = envelopeSchema.parse(value)
  if (envelope.sender.role !== 'apk') {
    throw new Error(`Inbound bridge sender must be apk, received ${envelope.sender.role}.`)
  }
  if (envelope.target !== 'webxr') {
    throw new Error(`Inbound APK message must target webxr, received ${envelope.target}.`)
  }
  switch (envelope.type) {
    case 'hello':
      return { ...envelope, type: 'hello', payload: apkHelloSchema.parse(envelope.payload) }
    case 'snapshot': {
      const payload = snapshotSchema.parse(envelope.payload)
      return {
        ...envelope,
        type: 'snapshot',
        payload,
      }
    }
    case 'polar_status':
      return {
        ...envelope,
        type: 'polar_status',
        payload: polarStatusSchema.parse(envelope.payload),
      }
    case 'receipt': {
      const payload = receiptSchema.parse(envelope.payload)
      if (envelope.correlationId !== payload.commandMessageId) {
        throw new Error('Receipt correlationId must match payload.commandMessageId.')
      }
      return { ...envelope, type: 'receipt', payload }
    }
    case 'error':
      return { ...envelope, type: 'error', payload: errorSchema.parse(envelope.payload) }
    case 'command':
      throw new Error('The APK cannot send a command through the WebXR client channel.')
  }
}

/**
 * Validates the WebXR-to-APK route, including cross-field session ownership
 * constraints which Draft 2020-12 JSON Schema cannot express portably.
 */
export function parseBridgeOutboundEnvelope(value: unknown): BridgeOutboundEnvelope {
  const envelope = envelopeSchema.parse(value)
  if (envelope.sender.role !== 'webxr') {
    throw new Error(`Outbound bridge sender must be webxr, received ${envelope.sender.role}.`)
  }
  if (envelope.target !== 'apk') {
    throw new Error(`Outbound WebXR message must target apk, received ${envelope.target}.`)
  }
  if (envelope.browserPageEpoch === undefined) {
    throw new Error('Outbound WebXR messages must bind browserPageEpoch.')
  }

  if (envelope.type === 'hello') {
    return { ...envelope, type: 'hello', payload: webXrHelloSchema.parse(envelope.payload) }
  }
  if (envelope.type !== 'command') {
    throw new Error(`WebXR cannot send ${envelope.type} through the APK client channel.`)
  }
  if (envelope.expectedRevision === undefined) {
    throw new Error('Outbound bridge commands must bind expectedRevision.')
  }

  const payload = commandSchema.parse(envelope.payload)
  if (payload.action === 'begin_recording' && envelope.sessionId !== payload.sessionId) {
    throw new Error('begin_recording envelope sessionId must match payload.sessionId.')
  }
  if (
    payload.action === 'record_experiment_marker' &&
    envelope.sessionId !== payload.marker.sessionId
  ) {
    throw new Error('Experiment marker envelope sessionId must match marker.sessionId.')
  }
  return { ...envelope, type: 'command', payload }
}

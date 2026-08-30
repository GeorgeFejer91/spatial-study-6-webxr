import { z } from 'zod'

import {
  BRIDGE_RECEIPT_STAGES,
} from '../bridge/contract.ts'

const base64UrlPattern = /^[A-Za-z0-9_-]+$/
const publicTokenPattern = /^[a-z0-9_-]+$/

/** Controller intents target the WebXR experiment owner, not the sensor APK. */
export const remoteCommandNames = [
  'request_status',
  'recenter_panel',
  'start_block',
  'pause_media',
  'resume_media',
  'advance',
  'back',
  'abort_session',
  'finalize_session',
  'reconnect_sensor',
  'return_to_experiment',
  'request_export',
] as const

export type RemoteCommandName = (typeof remoteCommandNames)[number]

export const RelayDescriptorSchema = z.object({
  protocol: z.literal('study6.relay.v1'),
  url: z
    .string()
    .url()
    .max(512)
    .refine((value) => value.startsWith('wss://') || /^ws:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//u.test(value), {
      message: 'Relay URL must use WSS, except for an explicit loopback development URL.',
    }),
  room: z.string().min(16).max(80).regex(publicTokenPattern),
  token: z.string().min(43).max(128).regex(base64UrlPattern),
}).strict()

export type RelayDescriptor = z.infer<typeof RelayDescriptorSchema>

export const PairingDescriptorSchema = z.object({
  version: z.literal(2),
  controlProtocol: z.literal('brsp/1'),
  room: z.string().min(16).max(80).regex(publicTokenPattern),
  streamId: z.string().min(16).max(80).regex(publicTokenPattern),
  key: z.string().length(43).regex(base64UrlPattern),
  forceTurn: z.boolean(),
  spectatorMedia: z.boolean(),
  relay: RelayDescriptorSchema.optional(),
}).strict()

export type PairingDescriptor = z.infer<typeof PairingDescriptorSchema>

const messageBase = {
  protocol: z.literal('spatial-study-6-companion/v1'),
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sentAt: z.string().datetime(),
}

export const CompanionStatusSchema = z.object({
  revision: z.number().int().nonnegative(),
  phase: z.string().min(1).max(80),
  route: z.enum(['browser', 'immersive-vr']),
  language: z.enum(['en', 'de']),
  xrPresenting: z.boolean(),
  participantActive: z.boolean(),
  blockOrdinal: z.number().int().min(0).max(4).nullable(),
  condition: z.string().max(32).nullable(),
  mediaElapsedSeconds: z.number().min(0).max(86_400).nullable(),
  mediaDurationSeconds: z.number().min(0).max(86_400).nullable(),
  mediaPaused: z.boolean(),
  storageHealthy: z.boolean(),
  authority: z.literal('webxr_experiment_owner'),
  bridgeConnected: z.boolean(),
  recordingState: z.enum(['unavailable', 'recording', 'finalized', 'fault']),
  recordingRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  recordingMarkerCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  recordingSamplesWritten: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  recordingDroppedBatches: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  recordingArtifactOpen: z.boolean(),
  recordingDurable: z.boolean(),
  polarPhase: z.enum([
    'unavailable',
    'permission_required',
    'scanning',
    'detected',
    'connecting',
    'connected',
    'streaming',
    'fault',
  ]),
  polarReady: z.boolean(),
  polarReadinessReason: z.string().max(240),
  heartRateBpm: z.number().int().min(20).max(260).nullable(),
  ecgSampleRateHz: z.number().min(0).max(2_000).nullable(),
  ecgSampleCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  lastEcgSampleAgeMs: z.number().nonnegative().max(86_400_000).nullable(),
  polarWriterHealthy: z.boolean(),
  polarReconnectCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  polarGapCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  startPreflightReady: z.boolean(),
  lastReceiptStage: z.enum(BRIDGE_RECEIPT_STAGES).nullable(),
  /**
   * BRSP target-local correlation marker. The controller uses this to prove
   * that a status projection was produced after a specific command outcome;
   * WebXR remains the sole owner of the experiment revision.
   */
  remoteCommandReceiptId: z
    .string()
    .min(8)
    .max(96)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u)
    .nullable()
    .optional(),
  remoteControlEnabled: z.boolean(),
  remoteAdvanceAllowed: z.boolean(),
  remoteBackAllowed: z.boolean(),
  remoteStartAllowed: z.boolean(),
  remoteAbortAllowed: z.boolean(),
  remoteFinalizeAllowed: z.boolean(),
  remoteExportAllowed: z.boolean(),
}).strict()

export type CompanionStatus = z.infer<typeof CompanionStatusSchema>

export const CompanionMessageSchema = z.discriminatedUnion('kind', [
  z.object({
    ...messageBase,
    kind: z.literal('hello'),
    role: z.enum(['experiment', 'companion']),
  }),
  z.object({
    ...messageBase,
    kind: z.literal('status'),
    status: CompanionStatusSchema,
  }),
  z.object({
    ...messageBase,
    kind: z.literal('command'),
    commandId: z.string().uuid(),
    name: z.enum(remoteCommandNames),
    expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }),
  z.object({
    ...messageBase,
    kind: z.literal('ack'),
    commandId: z.string().uuid(),
    accepted: z.boolean(),
    code: z.string().min(1).max(80),
    message: z.string().max(240),
    stage: z.enum(BRIDGE_RECEIPT_STAGES).optional(),
    resultingRevision: z.number().int().nonnegative().optional(),
  }),
])

export type CompanionMessage = z.infer<typeof CompanionMessageSchema>

export const EncryptedEnvelopeSchema = z.object({
  protocol: z.literal('s6c-aesgcm-v1'),
  nonce: z.string().length(16).regex(base64UrlPattern),
  ciphertext: z.string().min(16).max(16_384).regex(base64UrlPattern),
})

export type EncryptedEnvelope = z.infer<typeof EncryptedEnvelopeSchema>

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(length))
  crypto.getRandomValues(bytes)
  return bytes
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!base64UrlPattern.test(value)) throw new Error('Invalid base64url value.')
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + padding)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function randomToken(byteLength: number): string {
  // VDO.Ninja sanitizes hyphens to underscores. Generate the already-normalized
  // spelling so event stream IDs and pairing descriptors stay identical.
  return toBase64Url(randomBytes(byteLength)).toLowerCase().replaceAll('-', '_')
}

export function createPairingDescriptor(
  forceTurn = false,
  relay?: RelayDescriptor,
  spectatorMedia = false,
): PairingDescriptor {
  return {
    version: 2,
    controlProtocol: 'brsp/1',
    room: `s6_${randomToken(18)}`,
    streamId: `s6xr_${randomToken(18)}`,
    key: toBase64Url(randomBytes(32)),
    forceTurn,
    spectatorMedia,
    ...(relay ? { relay: RelayDescriptorSchema.parse(relay) } : {}),
  }
}

export function encodePairingDescriptor(descriptor: PairingDescriptor): string {
  const safe = PairingDescriptorSchema.parse(descriptor)
  return toBase64Url(new TextEncoder().encode(JSON.stringify(safe)))
}

export function decodePairingDescriptor(fragment: string): PairingDescriptor {
  const encoded = fragment.replace(/^#(?:pair=)?/u, '')
  if (encoded.length < 1 || encoded.length > 2_048) {
    throw new Error('Pairing descriptor has an invalid length.')
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(encoded))
  return PairingDescriptorSchema.parse(JSON.parse(text) as unknown)
}

const additionalData = new TextEncoder().encode('spatial-study-6-companion/aesgcm/v1')

async function importPairingKey(key: string): Promise<CryptoKey> {
  const bytes = fromBase64Url(key)
  if (bytes.byteLength !== 32) throw new Error('Pairing key must contain 256 bits.')
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function encryptCompanionMessage(
  keyValue: string,
  messageValue: CompanionMessage,
): Promise<EncryptedEnvelope> {
  const message = CompanionMessageSchema.parse(messageValue)
  const plaintext = new TextEncoder().encode(JSON.stringify(message))
  if (plaintext.byteLength > 8_192) throw new Error('Companion message is too large.')
  const nonce = randomBytes(12)
  const key = await importPairingKey(keyValue)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData, tagLength: 128 },
    key,
    plaintext,
  )
  return {
    protocol: 's6c-aesgcm-v1',
    nonce: toBase64Url(nonce),
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
  }
}

export async function decryptCompanionMessage(
  keyValue: string,
  envelopeValue: unknown,
): Promise<CompanionMessage> {
  const envelope = EncryptedEnvelopeSchema.parse(envelopeValue)
  const nonce = fromBase64Url(envelope.nonce)
  const ciphertext = fromBase64Url(envelope.ciphertext)
  const key = await importPairingKey(keyValue)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce, additionalData, tagLength: 128 },
    key,
    ciphertext,
  )
  const text = new TextDecoder('utf-8', { fatal: true }).decode(plaintext)
  return CompanionMessageSchema.parse(JSON.parse(text) as unknown)
}

export class ReplayWindow {
  private readonly nonces = new Set<string>()
  private readonly capacity: number

  constructor(capacity = 256) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error('Replay-window capacity must be a positive integer.')
    }
    this.capacity = capacity
  }

  accept(envelopeValue: unknown): boolean {
    const envelope = EncryptedEnvelopeSchema.safeParse(envelopeValue)
    if (!envelope.success || this.nonces.has(envelope.data.nonce)) return false
    this.nonces.add(envelope.data.nonce)
    if (this.nonces.size > this.capacity) {
      const oldest = this.nonces.values().next().value
      if (typeof oldest === 'string') this.nonces.delete(oldest)
    }
    return true
  }
}

/**
 * Reliable ordered VDO.Ninja control channels must carry strictly increasing
 * application sequence numbers. This closes the replay gap after a nonce ages
 * out of the bounded nonce window without depending on synchronized wall clocks.
 */
export class SequenceReplayGuard {
  private highestSequence = -1

  accept(message: CompanionMessage): boolean {
    if (message.sequence <= this.highestSequence) return false
    this.highestSequence = message.sequence
    return true
  }
}

export function nowIso(): string {
  return new Date().toISOString()
}

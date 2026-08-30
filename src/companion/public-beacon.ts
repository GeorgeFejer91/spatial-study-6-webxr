import {
  eventDetail,
  loadVdoNinjaSdk,
  type VdoNinjaSdk,
} from './vdo-sdk.ts'
import {
  PairingDescriptorSchema,
  type PairingDescriptor,
} from './protocol.ts'

/**
 * Public, passwordless VDO room used only to discover online Study 6 targets.
 * It is deliberately unrelated to the private BRSP room and proof secret.
 */
export const STUDY6_PUBLIC_BEACON_ROOM = 'spatial_study_6_public_beacon_v1'
export const STUDY6_PUBLIC_BEACON_STREAM_PREFIX = 's6_beacon_'
export const STUDY6_PUBLIC_BEACON_MAX_TARGETS = 32
export const STUDY6_PUBLIC_BEACON_MAX_LISTING_ITEMS = 128

const STUDY6_PUBLIC_BEACON_SALT = 'spatial-study-6-public-beacon-v1'
const STUDY6_PUBLIC_PAIRING_DOMAIN = 'spatial-study-6-public-pairing-v1'
const SOURCE_HINT_PATTERN = /^[A-Za-z0-9_-]{8,128}$/u
const BEACON_STREAM_PATTERN = /^s6_beacon_([0-9a-f]{24})$/u
const PEER_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u

export interface Study6PublicBeaconIdentity {
  /** Opaque public handle. It is not a BRSP room, stream ID, key, or identity. */
  hint: string
  /** Generic display text derived from the opaque handle, never caller-provided text. */
  label: string
  /** Public VDO announcement ID. It contains only the opaque handle. */
  announcementStreamId: string
}

export interface Study6PublicBeaconTarget {
  /** Complete opaque handle needed to distinguish public announcements. */
  hint: string
  /** Generic, locally derived display label. */
  label: string
}

export interface Study6PublicBeaconBroadcasterSnapshot {
  phase: 'idle' | 'connecting' | 'broadcasting' | 'reconnecting' | 'error'
  hint: string
  label: string
  message: string
}

export interface Study6PublicBeaconReceiverSnapshot {
  phase: 'idle' | 'connecting' | 'listening' | 'reconnecting' | 'error'
  targets: Study6PublicBeaconTarget[]
  message: string
}

export type Study6PublicBeaconSdkFactory = () => VdoNinjaSdk | Promise<VdoNinjaSdk>

interface InternalTarget {
  publicTarget: Study6PublicBeaconTarget
  peerKey?: string
}

interface ListingDetail {
  list?: unknown
  streamID?: unknown
  streamId?: unknown
  uuid?: unknown
  UUID?: unknown
}

function detailEvent<T>(type: string, detail: T): CustomEvent<T> {
  return new CustomEvent(type, { detail })
}

function bytesToHex(bytes: Uint8Array): string {
  let result = ''
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0')
  return result
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function genericLabel(hint: string): string {
  return `Study 6 WebXR ${hint.slice(0, 8).toUpperCase()}`
}

/**
 * Produces a reproducible public announcement without copying the source hint
 * into signaling. Callers should supply only an already nonsecret, random
 * stream ID/hint. Even then, only its truncated SHA-256 digest is announced.
 */
export async function deriveStudy6PublicBeaconIdentity(
  nonsecretSourceHint: string,
): Promise<Study6PublicBeaconIdentity> {
  if (!SOURCE_HINT_PATTERN.test(nonsecretSourceHint)) {
    throw new TypeError('The public beacon source hint must be an 8-128 character opaque token.')
  }
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonsecretSourceHint)),
  )
  const hint = bytesToHex(digest).slice(0, 24)
  return {
    hint,
    label: genericLabel(hint),
    announcementStreamId: `${STUDY6_PUBLIC_BEACON_STREAM_PREFIX}${hint}`,
  }
}

/** Recover the public VDO announcement ID from a receiver-provided hint. */
export function study6PublicBeaconStreamId(hint: string): string {
  if (!/^[0-9a-f]{24}$/u.test(hint)) throw new TypeError('Invalid Study 6 beacon hint.')
  return `${STUDY6_PUBLIC_BEACON_STREAM_PREFIX}${hint}`
}

async function publicPairingDigest(purpose: 'brsp-key' | 'vdo-room' | 'vdo-stream', hint: string) {
  study6PublicBeaconStreamId(hint)
  const input = `${STUDY6_PUBLIC_PAIRING_DOMAIN}\0${purpose}\0${hint}`
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)))
}

/**
 * Derive the complete data-only BRSP/VDO descriptor from a public beacon hint.
 *
 * This is an intentionally open-control prototype: the returned `key` is
 * reproducible by every visitor and therefore authenticates only the derived
 * session transcript, not a trusted person or device. No hidden input exists.
 * The target must use this exact descriptor when starting `CompanionHost`, and
 * it must still expose only the existing bounded Study 6 semantic command
 * profile; this function does not create or widen any command capability.
 */
export async function deriveStudy6PublicPairingDescriptor(
  hint: string,
): Promise<PairingDescriptor> {
  const [keyDigest, roomDigest, streamDigest] = await Promise.all([
    publicPairingDigest('brsp-key', hint),
    publicPairingDigest('vdo-room', hint),
    publicPairingDigest('vdo-stream', hint),
  ])
  return PairingDescriptorSchema.parse({
    version: 2,
    controlProtocol: 'brsp/1',
    room: `s6pub_room_${bytesToHex(roomDigest).slice(0, 32)}`,
    streamId: `s6pub_target_${bytesToHex(streamDigest).slice(0, 32)}`,
    key: bytesToBase64Url(keyDigest),
    forceTurn: false,
    spectatorMedia: false,
  })
}

function targetFromStreamId(value: unknown): Study6PublicBeaconTarget | undefined {
  if (typeof value !== 'string') return undefined
  const match = BEACON_STREAM_PATTERN.exec(value)
  if (!match?.[1]) return undefined
  return { hint: match[1], label: genericLabel(match[1]) }
}

function normalizedPeerKey(value: unknown): string | undefined {
  return typeof value === 'string' && PEER_KEY_PATTERN.test(value) ? value : undefined
}

function listingItem(value: unknown): { target: Study6PublicBeaconTarget; peerKey?: string } | undefined {
  if (typeof value === 'string') {
    const target = targetFromStreamId(value)
    return target ? { target } : undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const item = value as ListingDetail
  const target = targetFromStreamId(item.streamID ?? item.streamId)
  if (!target) return undefined
  const peerKey = normalizedPeerKey(item.UUID ?? item.uuid)
  return peerKey ? { target, peerKey } : { target }
}

async function createPublicBeaconSdk(): Promise<VdoNinjaSdk> {
  const Constructor = await loadVdoNinjaSdk()
  return new Constructor({
    password: false,
    salt: STUDY6_PUBLIC_BEACON_SALT,
    forceTURN: false,
    autoPingViewer: false,
    maxReconnectAttempts: 5,
    reconnectDelay: 1_000,
  })
}

/**
 * Announces one discovery-only target in the fixed public room. This class has
 * no pairing descriptor, BRSP secret, scope, status, media, `view`, custom
 * channel, or `sendData` input, so those values cannot enter the public plane.
 */
export class Study6PublicBeaconBroadcaster extends EventTarget {
  private readonly identity: Study6PublicBeaconIdentity
  private readonly sdkFactory: Study6PublicBeaconSdkFactory
  private sdk: VdoNinjaSdk | null = null
  private sdkListeners: Array<[string, EventListener]> = []
  private phase: Study6PublicBeaconBroadcasterSnapshot['phase'] = 'idle'
  private message = ''
  private generation = 0

  constructor(
    identity: Study6PublicBeaconIdentity,
    options: { sdkFactory?: Study6PublicBeaconSdkFactory } = {},
  ) {
    super()
    const expectedStreamId = study6PublicBeaconStreamId(identity.hint)
    if (identity.announcementStreamId !== expectedStreamId || identity.label !== genericLabel(identity.hint)) {
      throw new TypeError('The Study 6 public beacon identity is not canonical.')
    }
    this.identity = { ...identity }
    this.sdkFactory = options.sdkFactory ?? createPublicBeaconSdk
  }

  snapshot(): Study6PublicBeaconBroadcasterSnapshot {
    return {
      phase: this.phase,
      hint: this.identity.hint,
      label: this.identity.label,
      message: this.message,
    }
  }

  async start(): Promise<Study6PublicBeaconBroadcasterSnapshot> {
    await this.stop()
    const generation = ++this.generation
    this.phase = 'connecting'
    this.message = 'Publishing the public Study 6 availability beacon…'
    this.emitState()
    let sdk: VdoNinjaSdk | null = null
    try {
      sdk = await this.sdkFactory()
      if (generation !== this.generation) {
        await sdk.disconnect()
        return this.snapshot()
      }
      this.sdk = sdk
      this.listenSdk(sdk, generation)
      await sdk.connect()
      if (generation !== this.generation) return this.snapshot()
      await sdk.joinRoom({ room: STUDY6_PUBLIC_BEACON_ROOM, password: false })
      if (generation !== this.generation) return this.snapshot()
      const announced = await sdk.announce({
        streamID: this.identity.announcementStreamId,
        label: this.identity.label,
      })
      if (generation !== this.generation) return this.snapshot()
      if (announced !== this.identity.announcementStreamId) {
        throw new Error('VDO.Ninja changed the canonical public beacon stream ID.')
      }
      this.phase = 'broadcasting'
      this.message = 'This headset is visible in the public Study 6 target list.'
      this.emitState()
      return this.snapshot()
    } catch (error) {
      if (generation !== this.generation) return this.snapshot()
      await this.disconnectCurrentSdk()
      this.phase = 'error'
      this.message = 'The public Study 6 availability beacon could not be published.'
      this.emitState()
      throw error
    }
  }

  async stop(): Promise<void> {
    this.generation += 1
    this.phase = 'idle'
    this.message = ''
    this.emitState()
    await this.disconnectCurrentSdk()
  }

  private listenSdk(sdk: VdoNinjaSdk, generation: number): void {
    const onDisconnected = (event: Event) => {
      if (!this.isCurrent(sdk, generation)) return
      const detail = eventDetail<{ willReconnect?: unknown }>(event)
      this.phase = detail.willReconnect === true ? 'reconnecting' : 'error'
      this.message = detail.willReconnect === true
        ? 'The public availability beacon is reconnecting…'
        : 'The public availability beacon disconnected.'
      this.emitState()
    }
    const onReconnecting = () => {
      if (!this.isCurrent(sdk, generation)) return
      this.phase = 'reconnecting'
      this.message = 'The public availability beacon is reconnecting…'
      this.emitState()
    }
    const onReconnected = () => {
      if (!this.isCurrent(sdk, generation)) return
      this.phase = 'broadcasting'
      this.message = 'This headset is visible in the public Study 6 target list.'
      this.emitState()
    }
    const onReconnectFailed = () => {
      if (!this.isCurrent(sdk, generation)) return
      this.phase = 'error'
      this.message = 'The public availability beacon could not reconnect.'
      this.emitState()
    }
    this.addSdkListener(sdk, 'disconnected', onDisconnected)
    this.addSdkListener(sdk, 'reconnecting', onReconnecting)
    this.addSdkListener(sdk, 'reconnected', onReconnected)
    this.addSdkListener(sdk, 'reconnectFailed', onReconnectFailed)
  }

  private isCurrent(sdk: VdoNinjaSdk, generation: number): boolean {
    return this.sdk === sdk && this.generation === generation && this.phase !== 'idle'
  }

  private addSdkListener(sdk: VdoNinjaSdk, type: string, listener: EventListener): void {
    sdk.addEventListener(type, listener)
    this.sdkListeners.push([type, listener])
  }

  private async disconnectCurrentSdk(): Promise<void> {
    const sdk = this.sdk
    this.sdk = null
    if (!sdk) return
    for (const [type, listener] of this.sdkListeners) sdk.removeEventListener(type, listener)
    this.sdkListeners = []
    try {
      await sdk.disconnect()
    } catch {
      // Local Stop wins even if signaling has already disappeared.
    }
  }

  private emitState(): void {
    this.dispatchEvent(detailEvent('statechange', this.snapshot()))
  }
}

/**
 * Lists public Study 6 targets without viewing them. It never creates a peer
 * connection or receives application data; private BRSP pairing remains a
 * separate authenticated plane.
 */
export class Study6PublicBeaconReceiver extends EventTarget {
  private readonly sdkFactory: Study6PublicBeaconSdkFactory
  private sdk: VdoNinjaSdk | null = null
  private sdkListeners: Array<[string, EventListener]> = []
  private readonly targets = new Map<string, InternalTarget>()
  private readonly peerStreams = new Map<string, Set<string>>()
  private phase: Study6PublicBeaconReceiverSnapshot['phase'] = 'idle'
  private message = ''
  private generation = 0
  private targetEventQueued = false

  constructor(options: { sdkFactory?: Study6PublicBeaconSdkFactory } = {}) {
    super()
    this.sdkFactory = options.sdkFactory ?? createPublicBeaconSdk
  }

  snapshot(): Study6PublicBeaconReceiverSnapshot {
    return {
      phase: this.phase,
      targets: [...this.targets.values()]
        .map(({ publicTarget }) => ({ ...publicTarget }))
        .sort((left, right) => left.hint.localeCompare(right.hint)),
      message: this.message,
    }
  }

  async start(): Promise<Study6PublicBeaconReceiverSnapshot> {
    await this.stop()
    const generation = ++this.generation
    this.phase = 'connecting'
    this.message = 'Looking for public Study 6 targets…'
    this.emitState()
    let sdk: VdoNinjaSdk | null = null
    try {
      sdk = await this.sdkFactory()
      if (generation !== this.generation) {
        await sdk.disconnect()
        return this.snapshot()
      }
      this.sdk = sdk
      this.listenSdk(sdk, generation)
      await sdk.connect()
      if (generation !== this.generation) return this.snapshot()
      await sdk.joinRoom({ room: STUDY6_PUBLIC_BEACON_ROOM, password: false })
      if (generation !== this.generation) return this.snapshot()
      this.phase = 'listening'
      this.message = 'Public Study 6 target discovery is active.'
      this.emitState()
      return this.snapshot()
    } catch (error) {
      if (generation !== this.generation) return this.snapshot()
      await this.disconnectCurrentSdk()
      this.clearTargets()
      this.phase = 'error'
      this.message = 'Public Study 6 target discovery could not start.'
      this.emitState()
      throw error
    }
  }

  async stop(): Promise<void> {
    this.generation += 1
    this.phase = 'idle'
    this.message = ''
    this.clearTargets()
    this.emitState()
    await this.disconnectCurrentSdk()
  }

  private listenSdk(sdk: VdoNinjaSdk, generation: number): void {
    const onListing = (event: Event) => {
      if (!this.isCurrent(sdk, generation)) return
      const detail = eventDetail<ListingDetail>(event)
      if (Array.isArray(detail.list)) {
        this.replaceFromListing(detail.list.slice(0, STUDY6_PUBLIC_BEACON_MAX_LISTING_ITEMS))
        return
      }
      this.addListingItem(detail)
    }
    const onAdded = (event: Event) => {
      if (!this.isCurrent(sdk, generation)) return
      this.addListingItem(eventDetail<ListingDetail>(event))
    }
    const onLeft = (event: Event) => {
      if (!this.isCurrent(sdk, generation)) return
      const detail = eventDetail<ListingDetail>(event)
      const peerKey = normalizedPeerKey(detail.UUID ?? detail.uuid)
      if (peerKey) this.removePeer(peerKey)
    }
    const onDisconnected = (event: Event) => {
      if (!this.isCurrent(sdk, generation)) return
      const detail = eventDetail<{ willReconnect?: unknown }>(event)
      this.clearTargets()
      this.phase = detail.willReconnect === true ? 'reconnecting' : 'error'
      this.message = detail.willReconnect === true
        ? 'Public target discovery is reconnecting…'
        : 'Public target discovery disconnected.'
      this.emitState()
    }
    const onReconnecting = () => {
      if (!this.isCurrent(sdk, generation)) return
      this.clearTargets()
      this.phase = 'reconnecting'
      this.message = 'Public target discovery is reconnecting…'
      this.emitState()
    }
    const onReconnected = () => {
      if (!this.isCurrent(sdk, generation)) return
      this.phase = 'listening'
      this.message = 'Public Study 6 target discovery is active.'
      this.emitState()
    }
    const onReconnectFailed = () => {
      if (!this.isCurrent(sdk, generation)) return
      this.clearTargets()
      this.phase = 'error'
      this.message = 'Public target discovery could not reconnect.'
      this.emitState()
    }
    this.addSdkListener(sdk, 'listing', onListing)
    this.addSdkListener(sdk, 'videoaddedtoroom', onAdded)
    this.addSdkListener(sdk, 'userLeft', onLeft)
    this.addSdkListener(sdk, 'disconnected', onDisconnected)
    this.addSdkListener(sdk, 'reconnecting', onReconnecting)
    this.addSdkListener(sdk, 'reconnected', onReconnected)
    this.addSdkListener(sdk, 'reconnectFailed', onReconnectFailed)
  }

  private isCurrent(sdk: VdoNinjaSdk, generation: number): boolean {
    return this.sdk === sdk && this.generation === generation && this.phase !== 'idle'
  }

  private replaceFromListing(values: unknown[]): void {
    const normalized = values
      .map((value) => listingItem(value))
      .filter((value): value is NonNullable<typeof value> => value !== undefined)
      .sort((left, right) => left.target.hint.localeCompare(right.target.hint))
      .slice(0, STUDY6_PUBLIC_BEACON_MAX_TARGETS)
    const next = new Map<string, InternalTarget>()
    for (const { target, peerKey } of normalized) {
      const streamId = study6PublicBeaconStreamId(target.hint)
      if (!next.has(streamId)) next.set(streamId, { publicTarget: target, peerKey })
    }
    if (this.samePublicTargets(next)) {
      this.targets.clear()
      for (const [streamId, target] of next) this.targets.set(streamId, target)
      this.rebuildPeerIndex()
      return
    }
    this.targets.clear()
    for (const [streamId, target] of next) this.targets.set(streamId, target)
    this.rebuildPeerIndex()
    this.queueTargetsChange()
  }

  private addListingItem(value: unknown): void {
    const normalized = listingItem(value)
    if (!normalized) return
    const streamId = study6PublicBeaconStreamId(normalized.target.hint)
    const existing = this.targets.get(streamId)
    if (!existing && this.targets.size >= STUDY6_PUBLIC_BEACON_MAX_TARGETS) return
    this.targets.set(streamId, {
      publicTarget: normalized.target,
      peerKey: normalized.peerKey ?? existing?.peerKey,
    })
    this.rebuildPeerIndex()
    if (!existing) this.queueTargetsChange()
  }

  private removePeer(peerKey: string): void {
    const streamIds = this.peerStreams.get(peerKey)
    if (!streamIds) return
    let changed = false
    for (const streamId of streamIds) changed = this.targets.delete(streamId) || changed
    this.rebuildPeerIndex()
    if (changed) this.queueTargetsChange()
  }

  private rebuildPeerIndex(): void {
    this.peerStreams.clear()
    for (const [streamId, target] of this.targets) {
      if (!target.peerKey) continue
      const streams = this.peerStreams.get(target.peerKey) ?? new Set<string>()
      streams.add(streamId)
      this.peerStreams.set(target.peerKey, streams)
    }
  }

  private samePublicTargets(next: Map<string, InternalTarget>): boolean {
    if (next.size !== this.targets.size) return false
    for (const streamId of next.keys()) if (!this.targets.has(streamId)) return false
    return true
  }

  private clearTargets(): void {
    if (this.targets.size === 0) return
    this.targets.clear()
    this.peerStreams.clear()
    this.queueTargetsChange()
  }

  private queueTargetsChange(): void {
    if (this.targetEventQueued) return
    this.targetEventQueued = true
    const generation = this.generation
    queueMicrotask(() => {
      this.targetEventQueued = false
      if (generation !== this.generation && this.phase !== 'idle') return
      this.dispatchEvent(detailEvent('targetschange', this.snapshot()))
    })
  }

  private addSdkListener(sdk: VdoNinjaSdk, type: string, listener: EventListener): void {
    sdk.addEventListener(type, listener)
    this.sdkListeners.push([type, listener])
  }

  private async disconnectCurrentSdk(): Promise<void> {
    const sdk = this.sdk
    this.sdk = null
    if (!sdk) return
    for (const [type, listener] of this.sdkListeners) sdk.removeEventListener(type, listener)
    this.sdkListeners = []
    try {
      await sdk.disconnect()
    } catch {
      // Local Stop wins even if signaling has already disappeared.
    }
  }

  private emitState(): void {
    this.dispatchEvent(detailEvent('statechange', this.snapshot()))
  }
}

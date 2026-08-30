import {
  BRSP_CONTROL_MAX_BYTES,
  BRSP_STATE_MAX_BYTES,
  type BRSPMessageData,
  type BRSPRole,
  type BRSPTransport,
} from './vendor/browser-remote-sync-protocol/brsp.js'
import { eventDetail, type VdoChannelDetail, type VdoNinjaSdk } from './vdo-sdk'

export const VDO_BRSP_CONTROL_CHANNEL = 'brsp_control_v1'
export const VDO_BRSP_STATE_CHANNEL = 'brsp_state_v1'
export const VDO_BRSP_CONTROL_BACKLOG_LIMIT = 262_144

const encoder = new TextEncoder()

interface PeerRecord {
  readonly peerKey: string
  control?: RTCDataChannel
  state?: RTCDataChannel
  opened: boolean
  closing: boolean
  pendingState?: string
}

export interface Study6BrspVdoPeerTransportOptions {
  sdk: VdoNinjaSdk
  role: BRSPRole
  /** If supplied, auxiliary channels from other published streams are ignored. */
  streamId?: string
}

type TransportEventDetail = {
  peerKey: string
  reason?: string
  data?: BRSPMessageData
}

function detailEvent(type: string, detail: TransportEventDetail): Event {
  const event = new Event(type)
  Object.defineProperty(event, 'detail', { value: detail, enumerable: true })
  return event
}

function messageBytes(value: unknown): number {
  if (typeof value === 'string') return encoder.encode(value).byteLength
  if (value instanceof ArrayBuffer) return value.byteLength
  if (ArrayBuffer.isView(value)) return value.byteLength
  return Number.POSITIVE_INFINITY
}

function logicalLabel(value: string | undefined): string {
  return value?.startsWith('x-') ? value.slice(2) : (value ?? '')
}

function laneForLabel(value: string | undefined): 'control' | 'state' | undefined {
  const normalized = logicalLabel(value)
  if (normalized === VDO_BRSP_CONTROL_CHANNEL) return 'control'
  if (normalized === VDO_BRSP_STATE_CHANNEL) return 'state'
  return undefined
}

function channelHasExpectedSemantics(channel: RTCDataChannel, lane: 'control' | 'state'): boolean {
  if (lane === 'control') {
    return channel.ordered === true
      && channel.maxRetransmits === null
      && channel.maxPacketLifeTime === null
  }
  return channel.ordered === false
    && channel.maxRetransmits === 0
    && channel.maxPacketLifeTime === null
}

/**
 * BRSP/1 transport lanes added to the VDO peer connection that already carries
 * the Study 6 spectator stream. This class never connects, publishes, views, or
 * disconnects the supplied SDK instance.
 */
export class Study6BrspVdoPeerTransport extends EventTarget implements BRSPTransport {
  private readonly sdk: VdoNinjaSdk
  private readonly role: BRSPRole
  private readonly streamId?: string
  private readonly sdkListeners: Array<[string, EventListener]> = []
  private peer: PeerRecord | null = null
  private active = false
  private generation = 0

  constructor({ sdk, role, streamId }: Study6BrspVdoPeerTransportOptions) {
    super()
    if (role !== 'target' && role !== 'controller') throw new TypeError('role must be target or controller.')
    this.sdk = sdk
    this.role = role
    this.streamId = streamId
  }

  /** Attach to the already-started VDO SDK. No network work occurs before this call. */
  start(): void {
    if (this.active) return
    if (this.role === 'target' && typeof this.sdk.openChannel !== 'function') {
      throw new Error('The pinned VDO.Ninja SDK does not expose openChannel().')
    }
    this.active = true
    this.generation += 1
    this.listen('dataChannelOpen', this.handleDataChannelOpen)
    this.listen('channelOpen', this.handleChannelOpen)
    this.listen('dataChannelClose', this.handleBasePeerClose)
    this.listen('userLeft', this.handleBasePeerClose)
    this.listen('connectionFailed', this.handleBasePeerClose)
  }

  sendControl(peerKey: string, data: string): boolean {
    const peer = this.peerFor(peerKey)
    const channel = peer?.control
    const bytes = messageBytes(data)
    if (!channel || channel.readyState !== 'open' || bytes > BRSP_CONTROL_MAX_BYTES) return false
    if (channel.bufferedAmount + bytes > VDO_BRSP_CONTROL_BACKLOG_LIMIT) return false
    try {
      channel.send(data)
      return true
    } catch {
      return false
    }
  }

  sendState(peerKey: string, data: string): boolean {
    const peer = this.peerFor(peerKey)
    const channel = peer?.state
    if (!channel || channel.readyState !== 'open' || messageBytes(data) > BRSP_STATE_MAX_BYTES) return false
    if (channel.bufferedAmount > 0) {
      peer.pendingState = data
      return false
    }
    try {
      channel.send(data)
      peer.pendingState = undefined
      return true
    } catch {
      peer.pendingState = data
      return false
    }
  }

  closePeer(peerKey: string): void {
    if (this.peer?.peerKey !== peerKey) return
    this.closeCurrentPeer('BRSP peer closed locally.', false)
  }

  /** Close only the BRSP lanes and remove listeners; ownership of sdk stays with the caller. */
  stop(): void {
    if (!this.active) return
    this.active = false
    this.generation += 1
    for (const [type, listener] of this.sdkListeners) this.sdk.removeEventListener(type, listener)
    this.sdkListeners.length = 0
    this.closeCurrentPeer('BRSP transport stopped.', false)
  }

  private readonly handleDataChannelOpen = (event: Event): void => {
    if (!this.active || this.role !== 'target') return
    const detail = eventDetail<VdoChannelDetail>(event)
    if (!detail.uuid || detail.type !== 'publisher' || !this.matchesStream(detail.streamID)) return
    if (this.peer && this.peer.peerKey !== detail.uuid) return
    if (this.peer) return
    const peer: PeerRecord = {
      peerKey: detail.uuid,
      opened: false,
      closing: false,
    }
    this.peer = peer
    void this.openTargetChannels(peer, this.generation)
  }

  private readonly handleChannelOpen = (event: Event): void => {
    if (!this.active || this.role !== 'controller') return
    const detail = eventDetail<VdoChannelDetail>(event)
    const channel = detail.channel
    const lane = laneForLabel(detail.label ?? channel?.label)
    if (!detail.uuid || !channel || !lane || !this.matchesStream(detail.streamID)) return
    if (this.peer && this.peer.peerKey !== detail.uuid) {
      channel.close()
      return
    }
    const peer = this.peer ?? {
      peerKey: detail.uuid,
      opened: false,
      closing: false,
    }
    this.peer = peer
    if (!this.attachChannel(peer, lane, channel)) this.closeCurrentPeer(`Invalid BRSP ${lane} channel.`)
  }

  private readonly handleBasePeerClose = (event: Event): void => {
    if (!this.active || !this.peer) return
    const detail = eventDetail<VdoChannelDetail>(event)
    const peerKey = detail.uuid ?? detail.UUID
    if (peerKey === this.peer.peerKey) this.closeCurrentPeer('VDO peer connection closed.')
  }

  private listen(type: string, listener: EventListener): void {
    this.sdk.addEventListener(type, listener)
    this.sdkListeners.push([type, listener])
  }

  private matchesStream(streamId: string | undefined): boolean {
    return !this.streamId || streamId === this.streamId
  }

  private peerFor(peerKey: string): PeerRecord | undefined {
    return this.peer?.peerKey === peerKey && this.peer.opened && !this.peer.closing
      ? this.peer
      : undefined
  }

  private async openTargetChannels(peer: PeerRecord, generation: number): Promise<void> {
    const openChannel = this.sdk.openChannel
    if (!openChannel) return
    const results = await Promise.allSettled([
      openChannel.call(this.sdk, peer.peerKey, VDO_BRSP_CONTROL_CHANNEL, { ordered: true }),
      openChannel.call(this.sdk, peer.peerKey, VDO_BRSP_STATE_CHANNEL, {
        ordered: false,
        maxRetransmits: 0,
      }),
    ])
    const openedChannels = results
      .filter((result): result is PromiseFulfilledResult<RTCDataChannel> => result.status === 'fulfilled')
      .map((result) => result.value)
    if (!this.active || generation !== this.generation || this.peer !== peer
      || results.some((result) => result.status === 'rejected')) {
      for (const channel of openedChannels) channel.close()
      if (this.peer === peer) this.closeCurrentPeer('Failed to open both BRSP data channels.')
      return
    }
    const [control, state] = openedChannels
    if (!control || !state
      || !this.attachChannel(peer, 'control', control)
      || !this.attachChannel(peer, 'state', state)) {
      this.closeCurrentPeer('VDO returned an invalid BRSP data channel.')
    }
  }

  private attachChannel(peer: PeerRecord, lane: 'control' | 'state', channel: RTCDataChannel): boolean {
    if (peer.closing || peer[lane] || laneForLabel(channel.label) !== lane
      || !channelHasExpectedSemantics(channel, lane)) {
      channel.close()
      return false
    }
    peer[lane] = channel
    channel.binaryType = 'arraybuffer'
    if (lane === 'state') channel.bufferedAmountLowThreshold = 0
    channel.addEventListener('open', () => this.finishPeerOpen(peer), { once: true })
    channel.addEventListener('message', (event) => this.handleMessage(peer, lane, event))
    channel.addEventListener('close', () => {
      if (this.peer === peer && !peer.closing) this.closeCurrentPeer(`${lane} data channel closed.`)
    }, { once: true })
    if (lane === 'state') {
      channel.addEventListener('bufferedamountlow', () => this.flushPendingState(peer))
    }
    this.finishPeerOpen(peer)
    return true
  }

  private finishPeerOpen(peer: PeerRecord): void {
    if (!this.active || this.peer !== peer || peer.opened || peer.closing) return
    if (peer.control?.readyState !== 'open' || peer.state?.readyState !== 'open') return
    peer.opened = true
    this.dispatchEvent(detailEvent('peeropen', { peerKey: peer.peerKey }))
  }

  private handleMessage(peer: PeerRecord, lane: 'control' | 'state', event: MessageEvent): void {
    if (!this.active || this.peer !== peer || !peer.opened || peer.closing) return
    const maximum = lane === 'control' ? BRSP_CONTROL_MAX_BYTES : BRSP_STATE_MAX_BYTES
    if (messageBytes(event.data) > maximum) return
    this.dispatchEvent(detailEvent(`${lane}message`, { peerKey: peer.peerKey, data: event.data }))
  }

  private flushPendingState(peer: PeerRecord): void {
    if (this.peer !== peer || peer.closing || !peer.pendingState) return
    if (peer.state?.readyState !== 'open' || peer.state.bufferedAmount > 0) return
    const pending = peer.pendingState
    peer.pendingState = undefined
    this.sendState(peer.peerKey, pending)
  }

  private closeCurrentPeer(reason: string, notify = true): void {
    const peer = this.peer
    if (!peer || peer.closing) return
    peer.closing = true
    this.peer = null
    for (const channel of [peer.control, peer.state]) {
      try {
        channel?.close()
      } catch {
        // Best-effort closure of app-owned data channels only.
      }
    }
    if (notify && peer.opened) {
      this.dispatchEvent(detailEvent('peerclose', { peerKey: peer.peerKey, reason }))
    }
  }
}

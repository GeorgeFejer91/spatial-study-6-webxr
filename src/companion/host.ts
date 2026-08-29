import {
  CompanionMessageSchema,
  createPairingDescriptor,
  decryptCompanionMessage,
  encodePairingDescriptor,
  encryptCompanionMessage,
  EncryptedEnvelopeSchema,
  nowIso,
  ReplayWindow,
  SequenceReplayGuard,
  type CompanionMessage,
  type CompanionStatus,
  type PairingDescriptor,
  type RemoteCommandName,
} from './protocol'
import {
  createVdoSdk,
  eventDetail,
  loadVdoNinjaSdk,
  type VdoChannelDetail,
  type VdoDataDetail,
  type VdoNinjaSdk,
} from './vdo-sdk'

export interface CommandDecision {
  accepted: boolean
  code: string
  message: string
}

export interface CompanionHostOptions {
  getStatus: () => CompanionStatus
  handleCommand: (
    name: Exclude<RemoteCommandName, 'request_status'>,
    expectedRevision: number,
  ) => CommandDecision | Promise<CommandDecision>
  companionPageUrl?: URL
  frameRate?: number
}

export interface CompanionHostSnapshot {
  phase: 'idle' | 'connecting' | 'broadcasting' | 'error'
  viewerCount: number
  pairingUrl: string | null
  message: string
}

function detailEvent<T>(type: string, detail: T): CustomEvent<T> {
  return new CustomEvent(type, { detail })
}

export class CompanionHost extends EventTarget {
  private readonly options: CompanionHostOptions
  private sdk: VdoNinjaSdk | null = null
  private descriptor: PairingDescriptor | null = null
  private captureStream: MediaStream | null = null
  private phase: CompanionHostSnapshot['phase'] = 'idle'
  private message = ''
  private readonly openPeers = new Set<string>()
  private readonly peers = new Set<string>()
  private readonly replayByPeer = new Map<string, ReplayWindow>()
  private readonly sequenceByPeer = new Map<string, SequenceReplayGuard>()
  private readonly receiveChains = new Map<string, Promise<void>>()
  private readonly sendChains = new Map<string, Promise<void>>()
  private statusTimer: number | undefined
  private sequence = 0

  constructor(options: CompanionHostOptions) {
    super()
    this.options = options
  }

  snapshot(): CompanionHostSnapshot {
    return {
      phase: this.phase,
      viewerCount: this.peers.size,
      pairingUrl: this.descriptor ? this.pairingUrl(this.descriptor).toString() : null,
      message: this.message,
    }
  }

  async start(canvas: HTMLCanvasElement, forceTurn = false): Promise<CompanionHostSnapshot> {
    if (!('captureStream' in canvas) || typeof canvas.captureStream !== 'function') {
      throw new Error('This browser cannot capture the WebXR spectator canvas.')
    }
    await this.stop()
    this.phase = 'connecting'
    this.message = 'Connecting to VDO.Ninja signaling…'
    this.emitState()
    try {
      this.descriptor = createPairingDescriptor(forceTurn)
      const Constructor = await loadVdoNinjaSdk()
      this.sdk = createVdoSdk(Constructor, forceTurn, this.descriptor.key)
      this.attachListeners(this.sdk)
      this.captureStream = canvas.captureStream(this.options.frameRate ?? 15)
      if (this.captureStream.getVideoTracks().length !== 1) {
        throw new Error('The spectator canvas did not produce a video track.')
      }
      await this.sdk.connect()
      await this.sdk.joinRoom({ room: this.descriptor.room })
      await this.sdk.publish(this.captureStream, {
        streamID: this.descriptor.streamId,
        label: 'Spatial Study 6 spectator',
      })
      this.phase = 'broadcasting'
      this.message = 'Pairing is ready. No recording is performed by this app.'
      this.statusTimer = window.setInterval(() => {
        void this.broadcastStatus().catch((error: unknown) => {
          this.message = error instanceof Error ? error.message : String(error)
          this.emitState()
        })
      }, 1_000)
      this.emitState()
      return this.snapshot()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.disconnect()
      this.descriptor = null
      this.phase = 'error'
      this.message = message
      this.emitState()
      throw error
    }
  }

  async stop(): Promise<void> {
    await this.disconnect()
    this.descriptor = null
    this.phase = 'idle'
    this.message = ''
    this.emitState()
  }

  private async disconnect(): Promise<void> {
    if (this.statusTimer !== undefined) window.clearInterval(this.statusTimer)
    this.statusTimer = undefined
    const sdk = this.sdk
    this.sdk = null
    if (sdk) await Promise.resolve(sdk.disconnect()).catch(() => undefined)
    for (const track of this.captureStream?.getTracks() ?? []) track.stop()
    this.captureStream = null
    this.openPeers.clear()
    this.peers.clear()
    this.replayByPeer.clear()
    this.sequenceByPeer.clear()
    this.receiveChains.clear()
    this.sendChains.clear()
  }

  private attachListeners(sdk: VdoNinjaSdk): void {
    sdk.addEventListener('dataChannelOpen', (event) => {
      const { type, uuid } = eventDetail<VdoChannelDetail>(event)
      if (!uuid || type !== 'publisher') return
      this.openPeers.add(uuid)
      this.peers.delete(uuid)
      this.replayByPeer.set(uuid, new ReplayWindow())
      this.sequenceByPeer.set(uuid, new SequenceReplayGuard())
      this.emitState()
      void this.send(uuid, {
        protocol: 'spatial-study-6-companion/v1',
        kind: 'hello',
        role: 'experiment',
        sequence: this.sequence++,
        sentAt: nowIso(),
      })
    })
    const removePeer = (event: Event) => {
      const detail = eventDetail<VdoChannelDetail>(event)
      const uuid = detail.uuid ?? detail.UUID
      if (!uuid) return
      this.openPeers.delete(uuid)
      this.peers.delete(uuid)
      this.replayByPeer.delete(uuid)
      this.sequenceByPeer.delete(uuid)
      this.receiveChains.delete(uuid)
      this.sendChains.delete(uuid)
      this.emitState()
    }
    sdk.addEventListener('dataChannelClose', removePeer)
    sdk.addEventListener('userLeft', removePeer)
    sdk.addEventListener('dataReceived', (event) => {
      const detail = eventDetail<VdoDataDetail>(event)
      if (!detail.uuid) return
      const previous = this.receiveChains.get(detail.uuid) ?? Promise.resolve()
      const next = previous
        .catch(() => undefined)
        .then(() => this.receive(detail))
        .catch((error: unknown) => {
          this.message = error instanceof Error ? error.message : String(error)
          this.emitState()
        })
      this.receiveChains.set(detail.uuid, next)
    })
    sdk.addEventListener('error', (event) => {
      const detail = eventDetail<{ error?: unknown }>(event)
      this.message = detail.error instanceof Error ? detail.error.message : String(detail.error ?? 'Transport error')
      this.emitState()
    })
  }

  private async receive(detail: VdoDataDetail): Promise<void> {
    const { uuid, data } = detail
    if (!uuid || !this.descriptor) return
    const envelope = EncryptedEnvelopeSchema.safeParse(data)
    const replay = this.replayByPeer.get(uuid)
    if (!envelope.success || !replay?.accept(envelope.data)) return
    let message: CompanionMessage
    try {
      message = await decryptCompanionMessage(this.descriptor.key, envelope.data)
    } catch {
      // Authentication, schema, and decoding failures are deliberately silent.
      return
    }
    const sequence = this.sequenceByPeer.get(uuid)
    if (!sequence?.accept(message)) return
    if (message.kind === 'hello') {
      if (message.role !== 'companion') return
      this.peers.add(uuid)
      this.emitState()
      await this.sendStatus(uuid)
      return
    }
    if (!this.peers.has(uuid)) return
    if (message.kind === 'command') {
      let decision: CommandDecision
      if (message.name === 'request_status') {
        // Status is the resynchronization path: a newly connected viewer starts
        // at revision zero and must be able to learn the current revision.
        decision = {
          accepted: true,
          code: 'status_requested',
          message: 'Fresh study status sent.',
        }
      } else if (message.expectedRevision !== this.options.getStatus().revision) {
        decision = {
          accepted: false,
          code: 'stale_revision',
          message: 'The headset state changed; refresh status and try again.',
        }
      } else {
        try {
          decision = await this.options.handleCommand(message.name, message.expectedRevision)
        } catch {
          decision = {
            accepted: false,
            code: 'command_handler_failed',
            message: 'The headset could not apply the command.',
          }
        }
      }
      await this.send(uuid, {
        protocol: 'spatial-study-6-companion/v1',
        kind: 'ack',
        sequence: this.sequence++,
        sentAt: nowIso(),
        commandId: message.commandId,
        accepted: decision.accepted,
        code: decision.code,
        message: decision.message,
      })
      // Always follow an acknowledgement with authoritative status so a stale
      // companion can recover without guessing a revision.
      await this.sendStatus(uuid)
    }
  }

  async broadcastStatus(): Promise<void> {
    await Promise.all(Array.from(this.peers, (uuid) => this.sendStatus(uuid)))
  }

  private sendStatus(uuid: string): Promise<void> {
    return this.send(uuid, {
      protocol: 'spatial-study-6-companion/v1',
      kind: 'status',
      sequence: this.sequence++,
      sentAt: nowIso(),
      status: this.options.getStatus(),
    })
  }

  private send(uuid: string, messageValue: unknown): Promise<void> {
    const message = CompanionMessageSchema.parse(messageValue)
    const previous = this.sendChains.get(uuid) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const sdk = this.sdk
        const descriptor = this.descriptor
        if (!sdk || !descriptor || !this.openPeers.has(uuid)) return
        const envelope = await encryptCompanionMessage(descriptor.key, message)
        if (this.sdk !== sdk || this.descriptor !== descriptor || !this.openPeers.has(uuid)) return
        const sent = sdk.sendData(envelope, { uuid, preference: 'publisher' })
        if (!sent && this.openPeers.has(uuid)) {
          throw new Error('The companion message could not be queued on the peer channel.')
        }
      })
    this.sendChains.set(uuid, next)
    return next
  }

  private pairingUrl(descriptor: PairingDescriptor): URL {
    const page = this.options.companionPageUrl ?? new URL(`${import.meta.env.BASE_URL}companion.html`, location.origin)
    const url = new URL(page)
    url.hash = `pair=${encodePairingDescriptor(descriptor)}`
    return url
  }

  private emitState(): void {
    this.dispatchEvent(detailEvent('statechange', this.snapshot()))
  }
}

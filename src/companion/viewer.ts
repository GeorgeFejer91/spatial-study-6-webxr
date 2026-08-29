import {
  decryptCompanionMessage,
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
  type VdoTrackDetail,
} from './vdo-sdk'

export interface CommandAcknowledgement {
  commandId: string
  accepted: boolean
  code: string
  message: string
}

export interface CompanionViewerSnapshot {
  phase: 'idle' | 'connecting' | 'connected' | 'error'
  message: string
  peerConnected: boolean
}

function detailEvent<T>(type: string, detail: T): CustomEvent<T> {
  return new CustomEvent(type, { detail })
}

export class CompanionViewer extends EventTarget {
  private readonly descriptor: PairingDescriptor
  private sdk: VdoNinjaSdk | null = null
  private channelUuid: string | null = null
  private peerUuid: string | null = null
  private phase: CompanionViewerSnapshot['phase'] = 'idle'
  private message = ''
  private sequence = 0
  private latestRevision = 0
  private readonly replay = new ReplayWindow()
  private readonly sequenceGuard = new SequenceReplayGuard()
  private receiveChain: Promise<void> = Promise.resolve()
  private sendChain: Promise<void> = Promise.resolve()

  constructor(descriptor: PairingDescriptor) {
    super()
    this.descriptor = descriptor
  }

  snapshot(): CompanionViewerSnapshot {
    return {
      phase: this.phase,
      message: this.message,
      peerConnected: this.peerUuid !== null,
    }
  }

  async connect(): Promise<void> {
    await this.stop()
    this.phase = 'connecting'
    this.message = 'Connecting to the headset…'
    this.emitState()
    try {
      const Constructor = await loadVdoNinjaSdk()
      this.sdk = createVdoSdk(Constructor, this.descriptor.forceTurn, this.descriptor.key)
      this.attachListeners(this.sdk)
      await this.sdk.connect()
      await this.sdk.joinRoom({ room: this.descriptor.room })
      await this.sdk.view(this.descriptor.streamId, {
        audio: false,
        video: true,
        label: 'Spatial Study 6 companion',
      })
      this.phase = 'connected'
      this.message = 'Waiting for the headset video and control channel…'
      this.emitState()
    } catch (error) {
      this.phase = 'error'
      this.message = error instanceof Error ? error.message : String(error)
      this.emitState()
      await this.disconnect()
      throw error
    }
  }

  async stop(): Promise<void> {
    await this.disconnect()
    this.phase = 'idle'
    this.message = ''
    this.emitState()
  }

  private async disconnect(): Promise<void> {
    const sdk = this.sdk
    this.sdk = null
    if (sdk) await Promise.resolve(sdk.disconnect()).catch(() => undefined)
    this.channelUuid = null
    this.peerUuid = null
  }

  async sendCommand(name: RemoteCommandName): Promise<string> {
    if (!this.sdk || !this.peerUuid) throw new Error('The headset control channel is not connected.')
    const commandId = crypto.randomUUID()
    const message = {
      protocol: 'spatial-study-6-companion/v1',
      kind: 'command',
      sequence: this.sequence++,
      sentAt: nowIso(),
      commandId,
      name,
      expectedRevision: this.latestRevision,
    } as const
    await this.queueSend(message, this.peerUuid)
    return commandId
  }

  private attachListeners(sdk: VdoNinjaSdk): void {
    sdk.addEventListener('dataChannelOpen', (event) => {
      const detail = eventDetail<VdoChannelDetail>(event)
      if (!detail.uuid || detail.type !== 'viewer') return
      this.channelUuid = detail.uuid
      this.peerUuid = null
      this.message = 'Control channel connected; authenticating the headset…'
      this.emitState()
      void this.sendHello().catch((error: unknown) => this.reportTransportError(error))
    })
    sdk.addEventListener('dataChannelClose', (event) => {
      const detail = eventDetail<VdoChannelDetail>(event)
      if (detail.type !== 'viewer' || detail.uuid !== this.channelUuid) return
      this.channelUuid = null
      this.peerUuid = null
      this.message = 'The headset control channel closed.'
      this.emitState()
    })
    sdk.addEventListener('track', (event) => {
      const detail = eventDetail<VdoTrackDetail>(event)
      if (detail.streamID && detail.streamID !== this.descriptor.streamId) return
      const stream = detail.streams?.[0] ?? (detail.track ? new MediaStream([detail.track]) : undefined)
      if (stream) this.dispatchEvent(detailEvent('stream', stream))
    })
    sdk.addEventListener('dataReceived', (event) => {
      const detail = eventDetail<VdoDataDetail>(event)
      if (!detail.uuid || detail.uuid !== this.channelUuid) return
      this.receiveChain = this.receiveChain
        .catch(() => undefined)
        .then(() => this.receive(detail))
        .catch((error: unknown) => this.reportTransportError(error))
    })
    sdk.addEventListener('error', (event) => {
      const detail = eventDetail<{ error?: unknown }>(event)
      this.message = detail.error instanceof Error ? detail.error.message : String(detail.error ?? 'Transport error')
      this.emitState()
    })
  }

  private async sendHello(): Promise<void> {
    if (!this.sdk || !this.channelUuid) return
    await this.queueSend({
      protocol: 'spatial-study-6-companion/v1',
      kind: 'hello',
      role: 'companion',
      sequence: this.sequence++,
      sentAt: nowIso(),
    }, this.channelUuid)
  }

  private async receive(detail: VdoDataDetail): Promise<void> {
    if (!this.sdk || detail.uuid !== this.channelUuid) return
    const envelope = EncryptedEnvelopeSchema.safeParse(detail.data)
    if (!envelope.success || !this.replay.accept(envelope.data)) return
    let message: CompanionMessage
    try {
      message = await decryptCompanionMessage(this.descriptor.key, envelope.data)
    } catch {
      // Authentication, schema, and decoding failures are deliberately silent.
      return
    }
    if (!this.sdk || detail.uuid !== this.channelUuid) return
    if (!this.sequenceGuard.accept(message)) return
    if (message.kind === 'hello') {
      if (message.role !== 'experiment' || !detail.uuid) return
      this.peerUuid = detail.uuid
      this.message = 'Secure control channel connected.'
      this.emitState()
      await this.sendCommand('request_status')
    } else if (!this.peerUuid || detail.uuid !== this.peerUuid) {
      return
    } else if (message.kind === 'status') {
      this.latestRevision = message.status.revision
      this.dispatchEvent(detailEvent<CompanionStatus>('status', message.status))
    } else if (message.kind === 'ack') {
      this.dispatchEvent(
        detailEvent<CommandAcknowledgement>('ack', {
          commandId: message.commandId,
          accepted: message.accepted,
          code: message.code,
          message: message.message,
        }),
      )
    }
  }

  private queueSend(message: Parameters<typeof encryptCompanionMessage>[1], uuid: string): Promise<void> {
    const next = this.sendChain
      .catch(() => undefined)
      .then(async () => {
        const sdk = this.sdk
        if (!sdk || (uuid !== this.channelUuid && uuid !== this.peerUuid)) {
          throw new Error('The headset control channel is no longer connected.')
        }
        const envelope = await encryptCompanionMessage(this.descriptor.key, message)
        if (this.sdk !== sdk || (uuid !== this.channelUuid && uuid !== this.peerUuid)) {
          throw new Error('The headset control channel closed before the message was ready.')
        }
        const sent = sdk.sendData(envelope, { uuid, preference: 'viewer' })
        if (!sent) throw new Error('The message could not be queued on the peer channel.')
      })
    this.sendChain = next
    return next
  }

  private reportTransportError(error: unknown): void {
    this.message = error instanceof Error ? error.message : String(error)
    this.emitState()
  }

  private emitState(): void {
    this.dispatchEvent(detailEvent('statechange', this.snapshot()))
  }
}

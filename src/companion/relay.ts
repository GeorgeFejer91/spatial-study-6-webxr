import {
  CompanionMessageSchema,
  decryptCompanionMessage,
  encryptCompanionMessage,
  EncryptedEnvelopeSchema,
  ReplayWindow,
  SequenceReplayGuard,
  type CompanionMessage,
  type PairingDescriptor,
} from './protocol.ts'

export type RelayPeerRole = 'bridge' | 'webxr' | 'controller'

interface RelayWebSocket extends EventTarget {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
}

export interface CompanionRelayClientOptions {
  role: RelayPeerRole
  peerId?: string
  createSocket?: (url: string) => RelayWebSocket
  authenticationTimeoutMs?: number
}

export interface CompanionRelaySnapshot {
  phase: 'idle' | 'connecting' | 'connected' | 'error'
  message: string
}

const SOCKET_OPEN = 1

function detailEvent<T>(type: string, detail: T): CustomEvent<T> {
  return new CustomEvent(type, { detail })
}

function randomPeerId(role: RelayPeerRole): string {
  return `s6_${role}_${crypto.randomUUID().toLowerCase().replaceAll('-', '_')}`
}

/**
 * Experimental legacy encrypted relay client. Production browser control now
 * uses BRSP/1 on VDO custom data channels; this client is intentionally not a
 * BRSP failover until role-bound relay admission and a BRSP transport adapter
 * are implemented. The relay never sees this legacy payload in plaintext.
 */
export class CompanionRelayClient extends EventTarget {
  private readonly descriptor: PairingDescriptor
  private readonly options: CompanionRelayClientOptions
  private readonly peerId: string
  private socket: RelayWebSocket | null = null
  private phase: CompanionRelaySnapshot['phase'] = 'idle'
  private message = ''
  private readonly replay = new ReplayWindow()
  private readonly sequenceGuard = new SequenceReplayGuard()
  private receiveChain: Promise<void> = Promise.resolve()

  constructor(descriptor: PairingDescriptor, options: CompanionRelayClientOptions) {
    super()
    if (!descriptor.relay) throw new Error('The pairing descriptor has no failover relay.')
    this.descriptor = descriptor
    this.options = options
    this.peerId = options.peerId ?? randomPeerId(options.role)
  }

  snapshot(): CompanionRelaySnapshot {
    return { phase: this.phase, message: this.message }
  }

  async connect(): Promise<CompanionRelaySnapshot> {
    this.stop()
    const relay = this.descriptor.relay
    if (!relay) throw new Error('The pairing descriptor has no failover relay.')
    this.phase = 'connecting'
    this.message = 'Connecting to the encrypted APK failover route…'
    this.emitState()

    const createSocket = this.options.createSocket ?? ((url: string) => new WebSocket(url))
    const socket = createSocket(relay.url)
    this.socket = socket
    return new Promise<CompanionRelaySnapshot>((resolve, reject) => {
      let settled = false
      const timer = window.setTimeout(() => {
        if (settled || this.socket !== socket) return
        settled = true
        this.fail(socket, 'Relay authentication timed out.')
        reject(new Error('Relay authentication timed out.'))
      }, this.options.authenticationTimeoutMs ?? 10_000)

      const settleError = (reason: string) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        this.fail(socket, reason)
        reject(new Error(reason))
      }

      socket.addEventListener('open', () => {
        if (this.socket !== socket) return
        socket.send(
          JSON.stringify({
            protocol: relay.protocol,
            kind: 'authenticate',
            room: relay.room,
            peer: this.peerId,
            role: this.options.role,
            token: relay.token,
          }),
        )
      })
      socket.addEventListener('message', (event) => {
        if (this.socket !== socket || typeof (event as MessageEvent).data !== 'string') return
        const data = (event as MessageEvent<string>).data
        let parsed: unknown
        try {
          parsed = JSON.parse(data) as unknown
        } catch {
          return
        }
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          'protocol' in parsed &&
          parsed.protocol === 'study6.relay.v1' &&
          'kind' in parsed &&
          parsed.kind === 'relay_ready'
        ) {
          if (!settled) {
            settled = true
            window.clearTimeout(timer)
            this.phase = 'connected'
            this.message = 'Encrypted APK failover route connected.'
            this.emitState()
            resolve(this.snapshot())
          }
          return
        }
        const envelope = EncryptedEnvelopeSchema.safeParse(parsed)
        if (!envelope.success || !this.replay.accept(envelope.data)) return
        this.receiveChain = this.receiveChain
          .catch(() => undefined)
          .then(async () => {
            const message = await decryptCompanionMessage(this.descriptor.key, envelope.data)
            if (!this.sequenceGuard.accept(message)) return
            this.dispatchEvent(detailEvent<CompanionMessage>('message', message))
          })
          .catch(() => undefined)
      })
      socket.addEventListener('error', () => settleError('The failover relay connection failed.'))
      socket.addEventListener('close', () => {
        if (!settled) {
          settleError('The failover relay closed before authentication completed.')
          return
        }
        if (this.socket === socket) {
          this.socket = null
          this.phase = 'idle'
          this.message = 'The encrypted APK failover route closed.'
          this.emitState()
        }
      })
    })
  }

  async send(messageValue: CompanionMessage): Promise<void> {
    const message = CompanionMessageSchema.parse(messageValue)
    const socket = this.socket
    if (this.phase !== 'connected' || !socket || socket.readyState !== SOCKET_OPEN) {
      throw new Error('The APK failover route is not connected.')
    }
    const envelope = await encryptCompanionMessage(this.descriptor.key, message)
    if (this.socket !== socket || socket.readyState !== SOCKET_OPEN) {
      throw new Error('The APK failover route closed before the message was sent.')
    }
    socket.send(JSON.stringify(envelope))
  }

  stop(): void {
    const socket = this.socket
    this.socket = null
    if (socket) socket.close(1000, 'client stop')
    this.phase = 'idle'
    this.message = ''
    this.emitState()
  }

  private fail(socket: RelayWebSocket, reason: string): void {
    if (this.socket !== socket) return
    this.socket = null
    socket.close(1008, reason)
    this.phase = 'error'
    this.message = reason
    this.emitState()
  }

  private emitState(): void {
    this.dispatchEvent(detailEvent<CompanionRelaySnapshot>('statechange', this.snapshot()))
  }
}

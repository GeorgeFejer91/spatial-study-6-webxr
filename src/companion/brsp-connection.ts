import {
  BRSPConnection,
  canonicalStringify,
  decodeEnvelope,
  type BRSPTransportMessageDetail,
  type JsonValue,
} from './vendor/browser-remote-sync-protocol/brsp.js'

export class BrspCommandFingerprintWindow {
  private readonly fingerprints = new Map<string, string>()
  private readonly capacity: number

  constructor(capacity = 512) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new TypeError('Command fingerprint capacity must be a positive integer.')
    }
    this.capacity = capacity
  }

  observe(commandId: string, body: JsonValue): 'new' | 'duplicate' | 'conflict' {
    const fingerprint = canonicalStringify(body)
    const previous = this.fingerprints.get(commandId)
    if (previous !== undefined) return previous === fingerprint ? 'duplicate' : 'conflict'
    this.fingerprints.set(commandId, fingerprint)
    if (this.fingerprints.size > this.capacity) {
      const oldest = this.fingerprints.keys().next().value
      if (typeof oldest === 'string') this.fingerprints.delete(oldest)
    }
    return 'new'
  }
}

/**
 * Study 6 defense in depth around the pinned BRSP/1 reference state machine.
 * Upstream binds cached command IDs to their canonical body; this larger
 * application window independently rejects conflicting authenticated reuse.
 */
export class Study6BrspConnection<State extends JsonValue = JsonValue>
  extends BRSPConnection<State> {
  private readonly commandFingerprints = new BrspCommandFingerprintWindow()

  override async receiveControl(
    detail: Partial<BRSPTransportMessageDetail> = {},
  ): Promise<void> {
    if (this.role === 'target' && detail.data !== undefined) {
      const envelope = decodeEnvelope(detail.data)
      if (envelope?.type === 'command') {
        const commandId = envelope.body.commandId
        if (typeof commandId === 'string') {
          const result = this.commandFingerprints.observe(
            commandId,
            envelope.body as JsonValue,
          )
          if (result === 'conflict') {
            throw new TypeError('A command ID was reused with different command bytes.')
          }
        }
      }
    }
    await super.receiveControl(detail)
  }
}

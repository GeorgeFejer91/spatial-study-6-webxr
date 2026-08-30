import type { BridgeOutboundEnvelope } from './contract.ts'
import type {
  BridgeTransportEvent,
  BridgeTransportState,
  StudyBridgeTransport,
} from './transport.ts'

/** Deterministic test/development transport; it never claims to be real ECG. */
export class FakeStudyBridgeTransport implements StudyBridgeTransport {
  private readonly listeners = new Set<(event: BridgeTransportEvent) => void>()
  private currentState: BridgeTransportState = 'idle'
  readonly sent: BridgeOutboundEnvelope[] = []

  get state(): BridgeTransportState {
    return this.currentState
  }

  async connect(): Promise<void> {
    this.setState('connecting', 'Fake bridge connecting.')
    this.setState('open', 'Fake bridge connected.')
  }

  send(message: BridgeOutboundEnvelope): void {
    if (this.currentState !== 'open') throw new Error('Fake bridge transport is not open.')
    this.sent.push(structuredClone(message))
  }

  subscribe(listener: (event: BridgeTransportEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close(): void {
    this.setState('closed', 'Fake bridge closed.')
  }

  receive(value: unknown): void {
    this.listeners.forEach((listener) => listener({ type: 'message', value }))
  }

  fail(detail = 'Fake bridge fault.'): void {
    this.setState('fault', detail)
  }

  private setState(state: BridgeTransportState, detail: string): void {
    this.currentState = state
    this.listeners.forEach((listener) => listener({ type: 'state', state, detail }))
  }
}

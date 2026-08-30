export type BRSPRole = 'controller' | 'target'

export type BRSPPhase =
  | 'waiting-for-peer'
  | 'authenticating'
  | 'ready'
  | 'disconnected'
  | 'error'
  | 'closed'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export type BRSPControlType =
  | 'hello'
  | 'proof'
  | 'ready'
  | 'command'
  | 'applied'
  | 'snapshot-request'
  | 'snapshot'
  | 'error'
  | 'bye'

export type BRSPStateType = 'state' | 'intent'
export type BRSPMessageType = BRSPControlType | BRSPStateType
export type BRSPLane = 'control' | 'state'
export type BRSPMessageData = string | ArrayBuffer | ArrayBufferView<ArrayBufferLike>

export interface BRSPEnvelope<
  Type extends BRSPMessageType = BRSPMessageType,
  Body extends JsonObject = JsonObject,
> {
  protocol: 'brsp'
  version: 1
  type: Type
  sessionId: string
  senderId: string
  senderEpoch: number
  sequence: number
  body: Body
}

export interface BRSPHelloBody extends JsonObject {
  role: BRSPRole
  nonce: string
  capabilities: string[]
  requestedScopes: string[]
  grantedScopes: string[]
}

export type BRSPHelloEnvelope = BRSPEnvelope<'hello', BRSPHelloBody>

export interface BRSPCommandBody extends JsonObject {
  commandId: string
  scope: string
  action: string
  args: JsonValue
  expectedRevision: number | null
}

export interface BRSPAppliedBody extends JsonObject {
  commandId: string
  ok: boolean
  revision: number
  result: JsonValue
  error: string | null
}

export interface BRSPCommandOutcome {
  ok: boolean
  revision: number
  result?: JsonValue
  error?: string | null
}

export interface BRSPSessionNegotiation {
  capabilities: string[]
  acceptedScopes: string[]
}

export interface BRSPTransportPeerDetail {
  peerKey: string
  reason?: string
}

export interface BRSPTransportMessageDetail {
  peerKey: string
  data: BRSPMessageData
}

export interface BRSPTransport extends EventTarget {
  sendControl(peerKey: string, data: string): boolean
  sendState(peerKey: string, data: string): boolean
  closePeer?(peerKey: string): void
  stop(): void | Promise<void>
}

export interface BRSPSnapshot<State extends JsonValue = JsonValue> {
  phase: BRSPPhase
  role: BRSPRole
  sessionId: string
  peerId: string
  remotePeerId?: string
  acceptedScopes: string[]
  capabilities: string[]
  pendingCommands: number
  lastStateAt?: number
  stateAgeMs?: number
  lastIntentAt?: number
  intentAgeMs?: number
}

export interface BRSPCommandContext extends BRSPCommandBody {}

export interface BRSPIntentDetail {
  scope: string
  controls: JsonValue
  sequence: number
  receivedAt: number
}

export interface BRSPIntentOutcome<State extends JsonValue = JsonValue> {
  revision?: number
  state: State
}

export interface BRSPConnectionOptions<State extends JsonValue = JsonValue> {
  transport: BRSPTransport
  role: BRSPRole
  sessionId: string
  sharedSecret: string
  peerId?: string
  epoch?: number
  capabilities?: string[]
  requestedScopes?: string[]
  grantedScopes?: string[]
  applyCommand?: (
    command: BRSPCommandContext,
  ) => BRSPCommandOutcome | Promise<BRSPCommandOutcome>
  applyIntent?: (
    intent: BRSPIntentDetail,
  ) => BRSPIntentOutcome<State> | void | Promise<BRSPIntentOutcome<State> | void>
  getState?: () => State | undefined
  now?: () => number
}

export interface BRSPPendingCommand {
  sentAt: number
  scope: string
  action: string
  expectedRevision: number | null
}

export interface BRSPEventDetailMap<State extends JsonValue = JsonValue> {
  phasechange: BRSPSnapshot<State> & { message: string }
  ready: BRSPSnapshot<State>
  remoteerror: { code: string; message: string }
  command: { command: BRSPCommandBody; outcome: BRSPCommandOutcome }
  commandapplied: BRSPAppliedBody & { pending?: BRSPPendingCommand }
  snapshot: { revision: number; state: State }
  state: { revision: number; state: State; sequence: number; receivedAt: number }
  intent: BRSPIntentDetail
  backpressure: { lane: 'state' | 'intent'; retained: 'latest-only' }
  intenterror: { message: string }
  peerclose: BRSPSnapshot<State> & { reason: string }
  protocolerror: BRSPSnapshot<State> & { message: string }
}

export type BRSPDetailEvent<Detail> = Event & { readonly detail: Detail }

export const BRSP_PROTOCOL: 'brsp'
export const BRSP_VERSION: 1
export const BRSP_CONTROL_MAX_BYTES: 16_384
export const BRSP_STATE_MAX_BYTES: 8_192
export const BRSP_STALE_MS: 2_000
export const BRSP_RECOVERY_FRAMES: 3
export const BRSP_CONTROL_TYPES: readonly BRSPControlType[]
export const BRSP_STATE_TYPES: readonly BRSPStateType[]

export function canonicalStringify(value: JsonValue): string
export function randomToken(byteLength?: number): string
export function randomEpoch(): number
export function isNewerSequence(sequence: number, previousSequence?: number | null): boolean

export function makeEnvelope<
  Type extends BRSPMessageType,
  Body extends JsonObject = JsonObject,
>(options: {
  type: Type
  sessionId: string
  senderId: string
  senderEpoch: number
  sequence: number
  body?: Body
}): BRSPEnvelope<Type, Body>

export function validateEnvelope<Envelope extends BRSPEnvelope>(
  envelope: Envelope,
  options?: { lane?: BRSPLane },
): Envelope

export function encodeEnvelope(
  envelope: BRSPEnvelope,
  options?: { lane?: BRSPLane },
): string

export function decodeEnvelope(
  value: BRSPMessageData,
  options?: { lane?: BRSPLane },
): BRSPEnvelope | undefined

export function createHelloEnvelope(options: {
  role: BRSPRole
  sessionId: string
  senderId: string
  senderEpoch: number
  sequence?: number
  nonce?: string
  capabilities?: string[]
  requestedScopes?: string[]
  grantedScopes?: string[]
}): BRSPHelloEnvelope

export function validateHelloBody(body: BRSPHelloBody): BRSPHelloBody
export function proofTranscript(firstHello: BRSPHelloEnvelope, secondHello: BRSPHelloEnvelope): string

export function createProofEnvelope(options: {
  localHello: BRSPHelloEnvelope
  remoteHello: BRSPHelloEnvelope
  secret: string
  sequence: number
}): Promise<BRSPEnvelope<'proof'>>

export function verifyProofEnvelope(options: {
  proof: BRSPEnvelope<'proof'>
  localHello: BRSPHelloEnvelope
  remoteHello: BRSPHelloEnvelope
  secret: string
}): Promise<boolean>

export function negotiateSession(
  localHello: BRSPHelloEnvelope,
  remoteHello: BRSPHelloEnvelope,
): BRSPSessionNegotiation

export function createReadyEnvelope(options: {
  localHello: BRSPHelloEnvelope
  remoteHello: BRSPHelloEnvelope
  sequence: number
}): BRSPEnvelope<'ready'>

export class BRSPConnection<State extends JsonValue = JsonValue> extends EventTarget {
  constructor(options: BRSPConnectionOptions<State>)

  readonly transport: BRSPTransport
  readonly role: BRSPRole
  readonly sessionId: string
  readonly peerId: string
  readonly epoch: number
  phase: BRSPPhase
  peerKey?: string
  acceptedScopes: string[]
  negotiatedCapabilities: string[]
  pendingCommands: Map<string, BRSPPendingCommand>
  lastStateAt?: number
  lastIntentAt?: number

  snapshot(): BRSPSnapshot<State>
  attachPeer(detail?: Partial<BRSPTransportPeerDetail>): Promise<void>
  receiveControl(detail?: Partial<BRSPTransportMessageDetail>): Promise<void>
  sendCommand(
    scope: string,
    action: string,
    args?: JsonValue,
    options?: { expectedRevision?: number | null },
  ): string
  publishSnapshot(state?: State, options?: { revision?: number }): boolean
  publishState(state?: State, options?: { revision?: number }): boolean
  publishIntent(scope: string, controls: JsonValue): boolean
  receiveState(detail?: Partial<BRSPTransportMessageDetail>): boolean
  isStateStale(at?: number, thresholdMs?: number): boolean
  isIntentStale(at?: number, thresholdMs?: number): boolean
  handlePeerClose(detail?: Partial<BRSPTransportPeerDetail>): void
  close(): Promise<void>

  addEventListener<Type extends keyof BRSPEventDetailMap<State>>(
    type: Type,
    listener: (this: BRSPConnection<State>, event: BRSPDetailEvent<BRSPEventDetailMap<State>[Type]>) => void,
    options?: boolean | AddEventListenerOptions,
  ): void
  removeEventListener<Type extends keyof BRSPEventDetailMap<State>>(
    type: Type,
    listener: (this: BRSPConnection<State>, event: BRSPDetailEvent<BRSPEventDetailMap<State>[Type]>) => void,
    options?: boolean | EventListenerOptions,
  ): void
}

import {
  MAX_STUDY_BRIDGE_MESSAGE_BYTES,
  type BridgeOutboundEnvelope,
} from './contract.ts'

export type BridgeTransportState = 'idle' | 'connecting' | 'open' | 'closed' | 'fault'

export type BridgeTransportEvent =
  | { type: 'state'; state: BridgeTransportState; detail: string }
  | { type: 'message'; value: unknown }

export interface StudyBridgeTransport {
  readonly state: BridgeTransportState
  connect(): Promise<void>
  send(message: BridgeOutboundEnvelope): void
  subscribe(listener: (event: BridgeTransportEvent) => void): () => void
  close(): void
}

export interface WebSocketLike {
  readonly readyState: number
  addEventListener(type: 'open', listener: () => void): void
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  addEventListener(type: 'close', listener: (event: CloseEvent) => void): void
  addEventListener(type: 'error', listener: () => void): void
  send(data: string): void
  close(code?: number, reason?: string): void
}

export interface WebSocketStudyBridgeTransportOptions {
  url: string
  createSocket?: (url: string) => WebSocketLike
}

function socketFactory(url: string): WebSocketLike {
  return new WebSocket(url)
}

export class WebSocketStudyBridgeTransport implements StudyBridgeTransport {
  private readonly url: string
  private readonly createSocket: (url: string) => WebSocketLike
  private readonly listeners = new Set<(event: BridgeTransportEvent) => void>()
  private socket: WebSocketLike | null = null
  private currentState: BridgeTransportState = 'idle'
  private socketGeneration = 0

  constructor(options: WebSocketStudyBridgeTransportOptions) {
    this.url = options.url
    this.createSocket = options.createSocket ?? socketFactory
  }

  get state(): BridgeTransportState {
    return this.currentState
  }

  connect(): Promise<void> {
    if (this.currentState === 'open') return Promise.resolve()
    if (this.currentState === 'connecting') {
      return Promise.reject(new Error('Sensor bridge connection is already pending.'))
    }
    this.setState('connecting', 'Connecting to the local sensor bridge.')
    return new Promise((resolve, reject) => {
      let settled = false
      const generation = ++this.socketGeneration
      const socket = this.createSocket(this.url)
      this.socket = socket
      socket.addEventListener('open', () => {
        if (generation !== this.socketGeneration) return
        settled = true
        this.setState('open', 'Sensor bridge transport connected.')
        resolve()
      })
      socket.addEventListener('message', (event) => {
        if (generation !== this.socketGeneration) return
        try {
          if (typeof event.data !== 'string') {
            throw new Error('Bridge frames must contain UTF-8 JSON text.')
          }
          if (new TextEncoder().encode(event.data).byteLength > MAX_STUDY_BRIDGE_MESSAGE_BYTES) {
            throw new Error(
              `Bridge frame exceeds ${MAX_STUDY_BRIDGE_MESSAGE_BYTES} UTF-8 bytes.`,
            )
          }
          const value = JSON.parse(event.data) as unknown
          this.emit({ type: 'message', value })
        } catch (error) {
          this.setState(
            'fault',
            error instanceof Error ? `Malformed bridge JSON: ${error.message}` : 'Malformed bridge JSON.',
          )
        }
      })
      socket.addEventListener('close', (event) => {
        if (generation !== this.socketGeneration) return
        this.socket = null
        this.setState('closed', event.reason || `Sensor bridge closed (${event.code}).`)
        if (!settled) reject(new Error('Sensor bridge closed before it connected.'))
      })
      socket.addEventListener('error', () => {
        if (generation !== this.socketGeneration) return
        this.setState('fault', 'Sensor bridge WebSocket failed.')
        if (!settled) reject(new Error('Sensor bridge WebSocket failed.'))
      })
    })
  }

  send(message: BridgeOutboundEnvelope): void {
    if (!this.socket || this.currentState !== 'open' || this.socket.readyState !== 1) {
      throw new Error('Sensor bridge transport is not open.')
    }
    this.socket.send(JSON.stringify(message))
  }

  subscribe(listener: (event: BridgeTransportEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close(): void {
    const socket = this.socket
    this.socket = null
    this.socketGeneration += 1
    if (socket) socket.close(1000, 'WebXR page closed')
    this.setState('closed', 'Sensor bridge transport closed.')
  }

  private emit(event: BridgeTransportEvent): void {
    this.listeners.forEach((listener) => listener(event))
  }

  private setState(state: BridgeTransportState, detail: string): void {
    this.currentState = state
    this.emit({ type: 'state', state, detail })
  }
}

export interface StudyBridgeLaunchConfig {
  url: string
  token: string | null
  fromFragment: boolean
}

function validateBridgeUrl(configured: string): string {
  const url = new URL(configured)
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error('bridgeWs must use ws: or wss:.')
  }
  const isLoopback =
    url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]'
  if (url.protocol === 'ws:' && !isLoopback) {
    throw new Error('Unencrypted bridgeWs is allowed only on loopback.')
  }
  return url.toString()
}

export function resolveStudyBridgeLaunchConfig(
  location: Pick<Location, 'protocol' | 'hostname' | 'host' | 'search' | 'hash'>,
): StudyBridgeLaunchConfig {
  const fragment = new URLSearchParams(location.hash.replace(/^#/u, ''))
  const fragmentUrl = fragment.get('bridgeWs')
  const fragmentToken = fragment.get('bridgeToken')
  if (fragmentUrl !== null || fragmentToken !== null) {
    if (!fragmentUrl || !fragmentToken) {
      throw new Error('The bridge launch fragment requires both bridgeWs and bridgeToken.')
    }
    if (!/^[A-Za-z0-9_-]{43}$/u.test(fragmentToken)) {
      throw new Error('bridgeToken must be an unpadded 256-bit base64url value.')
    }
    const url = new URL(validateBridgeUrl(fragmentUrl))
    url.searchParams.set('token', fragmentToken)
    return { url: url.toString(), token: fragmentToken, fromFragment: true }
  }

  const configured = new URLSearchParams(location.search).get('bridgeUrl')
  if (configured) {
    return { url: validateBridgeUrl(configured), token: null, fromFragment: false }
  }
  const hostedByBridge = location.hostname === '127.0.0.1' || location.hostname === 'localhost'
  if (hostedByBridge) {
    return {
      url: `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/bridge`,
      token: null,
      fromFragment: false,
    }
  }
  return { url: 'ws://127.0.0.1:8766/bridge', token: null, fromFragment: false }
}

export function resolveStudyBridgeUrl(
  location: Pick<Location, 'protocol' | 'hostname' | 'host' | 'search' | 'hash'>,
): string {
  return resolveStudyBridgeLaunchConfig(location).url
}

import {
  MAX_STUDY_BRIDGE_MESSAGE_BYTES,
  parseBridgeOutboundEnvelope,
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
  close(code?: number, reason?: string): void
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
  private connectOperation: Promise<void> | null = null
  private rejectConnectOperation: ((error: Error) => void) | null = null

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
      return (
        this.connectOperation ??
        Promise.reject(new Error('Sensor bridge connection is already pending.'))
      )
    }

    // A WebSocket error is not required to be followed by a close event. Retire any
    // faulted socket before opening its replacement so only one generation can emit.
    const previousSocket = this.socket
    this.socket = null
    if (previousSocket) {
      this.socketGeneration += 1
      try {
        previousSocket.close(1012, 'Sensor bridge transport reconnecting')
      } catch {
        // The replacement generation is already fenced from this socket.
      }
    }

    this.setState('connecting', 'Connecting to the local sensor bridge.')
    const operation = new Promise<void>((resolve, reject) => {
      let settled = false
      const generation = ++this.socketGeneration
      const settleRejected = (error: Error) => {
        if (settled) return
        settled = true
        this.rejectConnectOperation = null
        reject(error)
      }
      this.rejectConnectOperation = settleRejected

      let socket: WebSocketLike
      try {
        socket = this.createSocket(this.url)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        this.setState('fault', `Sensor bridge WebSocket could not be created: ${detail}`)
        settleRejected(error instanceof Error ? error : new Error(detail))
        return
      }
      this.socket = socket
      socket.addEventListener('open', () => {
        if (generation !== this.socketGeneration) return
        if (settled) return
        settled = true
        this.rejectConnectOperation = null
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
          this.socket = null
          this.socketGeneration += 1
          try {
            socket.close(1003, 'Malformed sensor bridge frame')
          } catch {
            // The failed generation is already fenced.
          }
          this.setState(
            'fault',
            error instanceof Error ? `Malformed bridge JSON: ${error.message}` : 'Malformed bridge JSON.',
          )
        }
      })
      socket.addEventListener('close', (event) => {
        if (generation !== this.socketGeneration) return
        this.socket = null
        this.socketGeneration += 1
        this.setState('closed', event.reason || `Sensor bridge closed (${event.code}).`)
        settleRejected(new Error('Sensor bridge closed before it connected.'))
      })
      socket.addEventListener('error', () => {
        if (generation !== this.socketGeneration) return
        this.socket = null
        this.socketGeneration += 1
        try {
          socket.close(1011, 'Sensor bridge WebSocket failed')
        } catch {
          // The failed generation is already fenced.
        }
        this.setState('fault', 'Sensor bridge WebSocket failed.')
        settleRejected(new Error('Sensor bridge WebSocket failed.'))
      })
    })
    this.connectOperation = operation
    void operation.then(
      () => {
        if (this.connectOperation === operation) this.connectOperation = null
      },
      () => {
        if (this.connectOperation === operation) this.connectOperation = null
      },
    )
    return operation
  }

  send(message: BridgeOutboundEnvelope): void {
    if (!this.socket || this.currentState !== 'open' || this.socket.readyState !== 1) {
      throw new Error('Sensor bridge transport is not open.')
    }
    const encoded = JSON.stringify(parseBridgeOutboundEnvelope(message))
    if (new TextEncoder().encode(encoded).byteLength > MAX_STUDY_BRIDGE_MESSAGE_BYTES) {
      throw new Error(`Bridge frame exceeds ${MAX_STUDY_BRIDGE_MESSAGE_BYTES} UTF-8 bytes.`)
    }
    this.socket.send(encoded)
  }

  subscribe(listener: (event: BridgeTransportEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close(code = 1000, reason = 'WebXR page closed'): void {
    const socket = this.socket
    this.socket = null
    this.socketGeneration += 1
    const rejectPendingConnect = this.rejectConnectOperation
    this.rejectConnectOperation = null
    rejectPendingConnect?.(new Error('Sensor bridge transport closed.'))
    if (socket) {
      try {
        socket.close(code, reason)
      } catch {
        // Closing is authoritative even if the platform socket already failed.
      }
    }
    this.setState('closed', `Sensor bridge transport closed: ${reason}.`)
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
  bridgeLaunch: string | null
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
  const query = new URLSearchParams(location.search)
  if (query.has('bridgeToken')) {
    throw new Error('bridgeToken is secret launch material and is accepted only in the URL fragment.')
  }
  const bridgeLaunch = query.get('bridgeLaunch')
  if (bridgeLaunch !== null && !/^[A-Za-z0-9_-]{16,96}$/u.test(bridgeLaunch)) {
    throw new Error('bridgeLaunch must be 16 to 96 base64url characters.')
  }

  const fragment = new URLSearchParams(location.hash.replace(/^#/u, ''))
  const fragmentUrl = fragment.get('bridgeWs')
  const fragmentToken = fragment.get('bridgeToken')
  if (fragmentUrl !== null || fragmentToken !== null) {
    if (!fragmentUrl || !fragmentToken) {
      throw new Error('The bridge launch fragment requires both bridgeWs and bridgeToken.')
    }
    if (bridgeLaunch === null) {
      throw new Error('The authenticated bridge launch requires the bridgeLaunch query parameter.')
    }
    if (!/^[A-Za-z0-9_-]{43}$/u.test(fragmentToken)) {
      throw new Error('bridgeToken must be an unpadded 256-bit base64url value.')
    }
    const url = new URL(validateBridgeUrl(fragmentUrl))
    url.searchParams.set('token', fragmentToken)
    return {
      url: url.toString(),
      token: fragmentToken,
      bridgeLaunch,
      fromFragment: true,
    }
  }

  const configured = query.get('bridgeUrl')
  if (configured) {
    return {
      url: validateBridgeUrl(configured),
      token: null,
      bridgeLaunch,
      fromFragment: false,
    }
  }
  const hostedByBridge = location.hostname === '127.0.0.1' || location.hostname === 'localhost'
  if (hostedByBridge) {
    return {
      url: `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/bridge`,
      token: null,
      bridgeLaunch,
      fromFragment: false,
    }
  }
  return {
    url: 'ws://127.0.0.1:8766/bridge',
    token: null,
    bridgeLaunch,
    fromFragment: false,
  }
}

export function resolveStudyBridgeUrl(
  location: Pick<Location, 'protocol' | 'hostname' | 'host' | 'search' | 'hash'>,
): string {
  return resolveStudyBridgeLaunchConfig(location).url
}

import { describe, expect, it } from 'vitest'

import {
  resolveStudyBridgeLaunchConfig,
  WebSocketStudyBridgeTransport,
  type BridgeTransportEvent,
  type WebSocketLike,
} from './transport.ts'

class ControlledSocket {
  readyState = 0
  readonly sent: string[] = []
  readonly closes: Array<{ code?: number; reason?: string }> = []
  private readonly listeners = new Map<string, Array<(event?: unknown) => void>>()

  addEventListener(type: string, listener: (event?: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3
    this.closes.push({ code, reason })
  }

  open(): void {
    this.readyState = 1
    this.emit('open')
  }

  fail(): void {
    this.emit('error')
  }

  closed(code: number, reason = ''): void {
    this.readyState = 3
    this.emit('close', { code, reason } as CloseEvent)
  }

  message(data: unknown): void {
    this.emit('message', { data } as MessageEvent<unknown>)
  }

  private emit(type: string, event?: unknown): void {
    this.listeners.get(type)?.forEach((listener) => listener(event))
  }
}

function location(overrides: Partial<Location> = {}): Pick<
  Location,
  'protocol' | 'hostname' | 'host' | 'search' | 'hash'
> {
  return {
    protocol: 'https:',
    hostname: 'georgefejer91.github.io',
    host: 'georgefejer91.github.io',
    search: '',
    hash: '',
    ...overrides,
  }
}

describe('Sensor Bridge launch descriptor', () => {
  it('consumes the APK fragment names and puts the secret only in the WebSocket handshake', () => {
    const token = 'A'.repeat(43)
    const launch = resolveStudyBridgeLaunchConfig(
      location({
        search: '?bridgeLaunch=bridgeLaunchExample12345',
        hash: `#bridgeWs=${encodeURIComponent('ws://127.0.0.1:8766/bridge')}&bridgeToken=${token}`,
      }),
    )
    expect(launch).toEqual({
      url: `ws://127.0.0.1:8766/bridge?token=${token}`,
      token,
      bridgeLaunch: 'bridgeLaunchExample12345',
      fromFragment: true,
    })
  })

  it('rejects a partial descriptor, malformed token, and cleartext non-loopback endpoint', () => {
    expect(() =>
      resolveStudyBridgeLaunchConfig(location({ hash: '#bridgeWs=ws%3A%2F%2F127.0.0.1%2Fbridge' })),
    ).toThrow(/requires both/u)
    expect(() =>
      resolveStudyBridgeLaunchConfig(
        location({
          search: '?bridgeLaunch=bridgeLaunchExample12345',
          hash: '#bridgeWs=ws%3A%2F%2F127.0.0.1%2Fbridge&bridgeToken=short',
        }),
      ),
    ).toThrow(/256-bit base64url/u)
    const token = 'A'.repeat(43)
    expect(() =>
      resolveStudyBridgeLaunchConfig(
        location({
          search: '?bridgeLaunch=bridgeLaunchExample12345',
          hash: `#bridgeWs=ws%3A%2F%2F192.168.1.4%3A8766%2Fbridge&bridgeToken=${token}`,
        }),
      ),
    ).toThrow(/only on loopback/u)
  })

  it('requires a valid nonsecret launch nonce in query and refuses query-string secrets', () => {
    const token = 'A'.repeat(43)
    expect(() =>
      resolveStudyBridgeLaunchConfig(
        location({
          hash: `#bridgeWs=ws%3A%2F%2F127.0.0.1%2Fbridge&bridgeToken=${token}`,
        }),
      ),
    ).toThrow(/requires the bridgeLaunch query/u)
    expect(() =>
      resolveStudyBridgeLaunchConfig(location({ search: '?bridgeLaunch=short' })),
    ).toThrow(/16 to 96 base64url/u)
    expect(() =>
      resolveStudyBridgeLaunchConfig(
        location({ search: `?bridgeLaunch=bridgeLaunchExample12345&bridgeToken=${token}` }),
      ),
    ).toThrow(/only in the URL fragment/u)
  })

  it('defaults GitHub Pages to the fixed local APK endpoint', () => {
    expect(resolveStudyBridgeLaunchConfig(location())).toMatchObject({
      url: 'ws://127.0.0.1:8766/bridge',
      token: null,
      bridgeLaunch: null,
      fromFragment: false,
    })
  })
})

describe('WebSocket sensor bridge transport generations', () => {
  it('reopens the exact authenticated URL after a 1006 close and fences stale socket events', async () => {
    const token = 'T'.repeat(43)
    const url = `ws://127.0.0.1:8766/bridge?token=${token}`
    const sockets: ControlledSocket[] = []
    const urls: string[] = []
    const events: BridgeTransportEvent[] = []
    const transport = new WebSocketStudyBridgeTransport({
      url,
      createSocket: (createdUrl) => {
        urls.push(createdUrl)
        const socket = new ControlledSocket()
        sockets.push(socket)
        return socket as unknown as WebSocketLike
      },
    })
    transport.subscribe((event) => events.push(event))

    const firstConnect = transport.connect()
    sockets[0]!.open()
    await firstConnect
    sockets[0]!.closed(1006)
    expect(transport.state).toBe('closed')

    const secondConnect = transport.connect()
    sockets[1]!.open()
    await secondConnect
    expect(urls).toEqual([url, url])
    expect(urls.every((candidate) => candidate.includes(token))).toBe(true)

    const eventCount = events.length
    sockets[0]!.message('{not-json')
    sockets[0]!.closed(1006, 'late stale close')
    expect(events).toHaveLength(eventCount)
    expect(transport.state).toBe('open')
    transport.close()
  })

  it('retires and fences an errored socket even when the platform never emits close', async () => {
    const sockets: ControlledSocket[] = []
    const transport = new WebSocketStudyBridgeTransport({
      url: 'ws://127.0.0.1:8766/bridge?token=opaque',
      createSocket: () => {
        const socket = new ControlledSocket()
        sockets.push(socket)
        return socket as unknown as WebSocketLike
      },
    })
    const firstConnect = transport.connect()
    sockets[0]!.fail()
    await expect(firstConnect).rejects.toThrow(/failed/u)
    expect(sockets[0]!.closes).toEqual([
      { code: 1011, reason: 'Sensor bridge WebSocket failed' },
    ])

    const secondConnect = transport.connect()
    sockets[1]!.open()
    await secondConnect
    expect(transport.state).toBe('open')
    transport.close()
  })

  it('rejects a pending connect and ignores its late open after authoritative close', async () => {
    const socket = new ControlledSocket()
    const transport = new WebSocketStudyBridgeTransport({
      url: 'ws://127.0.0.1:8766/bridge?token=opaque',
      createSocket: () => socket as unknown as WebSocketLike,
    })
    const connect = transport.connect()
    transport.close(1000, 'test stopped')
    await expect(connect).rejects.toThrow(/closed/u)
    socket.open()
    expect(transport.state).toBe('closed')
    expect(socket.closes).toEqual([{ code: 1000, reason: 'test stopped' }])
  })
})

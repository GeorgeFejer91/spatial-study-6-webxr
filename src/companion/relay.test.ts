import { describe, expect, it, vi } from 'vitest'

import { createPairingDescriptor, encryptCompanionMessage, nowIso } from './protocol.ts'
import { CompanionRelayClient } from './relay.ts'

class FakeSocket extends EventTarget {
  readyState = 0
  readonly sent: string[] = []
  closeCode: number | undefined

  open(): void {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }

  receive(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }))
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(code?: number): void {
    this.closeCode = code
    this.readyState = 3
  }
}

function descriptor() {
  return createPairingDescriptor(false, {
    protocol: 'study6.relay.v1',
    url: 'wss://relay.example.test/v1/socket',
    room: 's6_1234567890abcdef',
    token: 'a'.repeat(43),
  })
}

describe('CompanionRelayClient', () => {
  it('authenticates before sending encrypted domain messages', async () => {
    const socket = new FakeSocket()
    const client = new CompanionRelayClient(descriptor(), {
      role: 'controller',
      peerId: 'controller_123456',
      createSocket: () => socket,
    })
    const connected = client.connect()
    socket.open()
    expect(JSON.parse(socket.sent[0] ?? '{}')).toMatchObject({
      protocol: 'study6.relay.v1',
      kind: 'authenticate',
      role: 'controller',
    })
    socket.receive({ protocol: 'study6.relay.v1', kind: 'relay_ready', status: 'authenticated' })
    await expect(connected).resolves.toMatchObject({ phase: 'connected' })

    await client.send({
      protocol: 'spatial-study-6-companion/v1',
      kind: 'hello',
      role: 'companion',
      sequence: 1,
      sentAt: nowIso(),
    })
    expect(JSON.parse(socket.sent[1] ?? '{}')).toMatchObject({ protocol: 's6c-aesgcm-v1' })
  })

  it('decrypts authenticated messages and rejects a replay', async () => {
    const pairing = descriptor()
    const socket = new FakeSocket()
    const client = new CompanionRelayClient(pairing, {
      role: 'controller',
      createSocket: () => socket,
    })
    const received = vi.fn()
    client.addEventListener('message', received)
    const connected = client.connect()
    socket.open()
    socket.receive({ protocol: 'study6.relay.v1', kind: 'relay_ready', status: 'authenticated' })
    await connected
    const envelope = await encryptCompanionMessage(pairing.key, {
      protocol: 'spatial-study-6-companion/v1',
      kind: 'hello',
      role: 'experiment',
      sequence: 7,
      sentAt: nowIso(),
    })
    socket.receive(envelope)
    socket.receive(envelope)
    await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(1))
  })
})

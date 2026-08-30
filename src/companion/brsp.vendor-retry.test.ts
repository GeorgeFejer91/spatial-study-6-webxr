import { describe, expect, it } from 'vitest'

import {
  BRSPConnection,
  decodeEnvelope,
  encodeEnvelope,
  makeEnvelope,
  type BRSPMessageData,
} from './vendor/browser-remote-sync-protocol/brsp.js'

class LinkedTransport extends EventTarget {
  readonly peerKey = 'peer-link'
  readonly sentControl: BRSPMessageData[] = []
  peer: LinkedTransport | null = null
  dropControl?: (data: BRSPMessageData) => boolean
  closed = false

  connect(peer: LinkedTransport): void {
    this.peer = peer
    peer.peer = this
  }

  open(): void {
    this.emit('peeropen', { peerKey: this.peerKey })
  }

  sendControl(peerKey: string, data: BRSPMessageData): boolean {
    if (this.closed || peerKey !== this.peerKey) return false
    this.sentControl.push(data)
    if (this.dropControl?.(data)) return true
    queueMicrotask(() => this.peer?.emit('controlmessage', { peerKey, data }))
    return true
  }

  sendState(peerKey: string, data: BRSPMessageData): boolean {
    if (this.closed || peerKey !== this.peerKey) return false
    queueMicrotask(() => this.peer?.emit('statemessage', { peerKey, data }))
    return true
  }

  closePeer(peerKey: string): void {
    if (peerKey === this.peerKey) this.closed = true
  }

  async stop(): Promise<void> {
    this.closed = true
  }

  private emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail }))
  }
}

function eventOnce<T>(target: EventTarget, type: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`Timed out waiting for ${type}.`)), 2_000)
    target.addEventListener(type, (event) => {
      window.clearTimeout(timer)
      resolve((event as CustomEvent<T>).detail)
    }, { once: true })
  })
}

async function settle(): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, 10))
}

describe('BRSP/1 duplicate command conformance', () => {
  it('applies once, replies with a fresh sequence, and rejects conflicting reuse', async () => {
    const targetTransport = new LinkedTransport()
    const controllerTransport = new LinkedTransport()
    targetTransport.connect(controllerTransport)
    let revision = 0
    let applyCount = 0
    let droppedFirstApplied = false
    targetTransport.dropControl = (data) => {
      if (decodeEnvelope(data)?.type !== 'applied' || droppedFirstApplied) return false
      droppedFirstApplied = true
      return true
    }
    const target = new BRSPConnection({
      transport: targetTransport,
      role: 'target',
      sessionId: 'session_command_retry',
      sharedSecret: 'command-retry-secret-with-entropy',
      peerId: 'target_command_retry',
      grantedScopes: ['scene.write'],
      getState: () => ({ revision }),
      applyCommand: () => {
        applyCount += 1
        revision += 1
        return { ok: true, revision, result: { applied: true } }
      },
    })
    const controller = new BRSPConnection({
      transport: controllerTransport,
      role: 'controller',
      sessionId: 'session_command_retry',
      sharedSecret: 'command-retry-secret-with-entropy',
      peerId: 'controller_command_retry',
      requestedScopes: ['scene.write'],
    })
    const ready = Promise.all([
      eventOnce(target as unknown as EventTarget, 'ready'),
      eventOnce(controller as unknown as EventTarget, 'ready'),
    ])
    targetTransport.open()
    controllerTransport.open()
    await ready

    const commandId = controller.sendCommand('scene.write', 'apply-once', {})
    await settle()
    expect(applyCount).toBe(1)
    expect(controller.pendingCommands.has(commandId)).toBe(true)
    const original = controllerTransport.sentControl
      .map((data) => decodeEnvelope(data))
      .find((envelope) => envelope?.type === 'command' && envelope.body.commandId === commandId)
    expect(original).toBeDefined()

    const applied = eventOnce<{ commandId: string }>(
      controller as unknown as EventTarget,
      'commandapplied',
    )
    controllerTransport.sendControl(controllerTransport.peerKey, encodeEnvelope(makeEnvelope({
      type: 'command',
      sessionId: original!.sessionId,
      senderId: original!.senderId,
      senderEpoch: original!.senderEpoch,
      sequence: (original!.sequence + 1) >>> 0,
      body: original!.body,
    })))
    await expect(applied).resolves.toMatchObject({ commandId })
    expect(applyCount).toBe(1)
    const acknowledgements = targetTransport.sentControl
      .map((data) => decodeEnvelope(data))
      .filter((envelope) => envelope?.type === 'applied' && envelope.body.commandId === commandId)
    expect(acknowledgements).toHaveLength(2)
    expect(acknowledgements[0]!.sequence).not.toBe(acknowledgements[1]!.sequence)

    const protocolError = eventOnce<{ message: string }>(
      target as unknown as EventTarget,
      'protocolerror',
    )
    controllerTransport.sendControl(controllerTransport.peerKey, encodeEnvelope(makeEnvelope({
      type: 'command',
      sessionId: original!.sessionId,
      senderId: original!.senderId,
      senderEpoch: original!.senderEpoch,
      sequence: (original!.sequence + 2) >>> 0,
      body: { ...original!.body, action: 'different-action' },
    })))
    await expect(protocolError).resolves.toMatchObject({
      message: expect.stringMatching(/commandId was reused/iu),
    })
    await Promise.all([target.close(), controller.close()])
  })
})

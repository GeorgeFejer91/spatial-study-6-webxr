import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createPairingDescriptor,
  decryptCompanionMessage,
  encryptCompanionMessage,
  nowIso,
  type CompanionStatus,
  type EncryptedEnvelope,
} from './protocol'
import { CompanionViewer } from './viewer'

interface SentPacket {
  data: unknown
  target: unknown
}

class FakeVdoSdk extends EventTarget {
  static readonly VERSION = '1.5.5'
  static instance: FakeVdoSdk | null = null

  readonly sent: SentPacket[] = []
  readonly options: Record<string, unknown>

  constructor(options: Record<string, unknown> = {}) {
    super()
    this.options = options
    FakeVdoSdk.instance = this
  }

  async connect(): Promise<void> {}
  async joinRoom(_options: { room: string; password?: string | false }): Promise<void> {}
  async publish(_stream: MediaStream, options: { streamID: string }): Promise<string> {
    return options.streamID
  }
  async view(): Promise<RTCPeerConnection | null> {
    return null
  }
  sendData(data: unknown, target?: unknown): boolean {
    this.sent.push({ data, target })
    return true
  }
  async disconnect(): Promise<void> {}
}

function sdk(): FakeVdoSdk {
  const instance = FakeVdoSdk.instance
  if (!instance) throw new Error('Fake SDK was not constructed.')
  return instance
}

function dispatchSdkEvent(type: string, detail: unknown): void {
  sdk().dispatchEvent(new CustomEvent(type, { detail }))
}

const status: CompanionStatus = {
  revision: 7,
  phase: 'stimulus',
  route: 'immersive-vr',
  language: 'en',
  xrPresenting: true,
  participantActive: true,
  blockOrdinal: 2,
  condition: 'HC_HE',
  mediaElapsedSeconds: 12,
  mediaDurationSeconds: 300,
  mediaPaused: false,
  storageHealthy: true,
  remoteAdvanceAllowed: false,
  remoteBackAllowed: false,
  remoteStartAllowed: false,
}

describe('companion viewer control channel', () => {
  afterEach(() => {
    delete window.VDONinjaSDK
    FakeVdoSdk.instance = null
  })

  it('authenticates the publisher direction and carries the latest expected revision', async () => {
    window.VDONinjaSDK = FakeVdoSdk
    const descriptor = createPairingDescriptor()
    const viewer = new CompanionViewer(descriptor)
    await viewer.connect()

    expect(sdk().options.password).toBe(`s6-vdo-v1-${descriptor.key}`)
    dispatchSdkEvent('dataChannelOpen', {
      uuid: 'publisher-peer',
      type: 'viewer',
      streamID: descriptor.streamId,
    })
    await vi.waitFor(() => expect(sdk().sent).toHaveLength(1))
    const hello = await decryptCompanionMessage(
      descriptor.key,
      sdk().sent[0]?.data as EncryptedEnvelope,
    )
    expect(hello).toMatchObject({ kind: 'hello', role: 'companion', sequence: 0 })
    expect(sdk().sent[0]?.target).toEqual({ uuid: 'publisher-peer', preference: 'viewer' })

    const statusReceived = new Promise<void>((resolve) => {
      viewer.addEventListener('status', () => resolve(), { once: true })
    })
    dispatchSdkEvent('dataReceived', {
      uuid: 'publisher-peer',
      streamID: descriptor.streamId,
      data: await encryptCompanionMessage(descriptor.key, {
        protocol: 'spatial-study-6-companion/v1',
        kind: 'hello',
        role: 'experiment',
        sequence: 10,
        sentAt: nowIso(),
      }),
    })
    await vi.waitFor(() => expect(sdk().sent).toHaveLength(2))
    const initialStatusRequest = await decryptCompanionMessage(
      descriptor.key,
      sdk().sent[1]?.data as EncryptedEnvelope,
    )
    expect(initialStatusRequest).toMatchObject({
      kind: 'command',
      name: 'request_status',
      expectedRevision: 0,
      sequence: 1,
    })

    dispatchSdkEvent('dataReceived', {
      uuid: 'publisher-peer',
      streamID: descriptor.streamId,
      data: await encryptCompanionMessage(descriptor.key, {
        protocol: 'spatial-study-6-companion/v1',
        kind: 'status',
        sequence: 11,
        sentAt: nowIso(),
        status,
      }),
    })
    await statusReceived
    await viewer.sendCommand('pause_media')
    expect(sdk().sent).toHaveLength(3)
    const pause = await decryptCompanionMessage(
      descriptor.key,
      sdk().sent[2]?.data as EncryptedEnvelope,
    )
    expect(pause).toMatchObject({
      kind: 'command',
      name: 'pause_media',
      expectedRevision: 7,
      sequence: 2,
    })

    await viewer.stop()
  })
})

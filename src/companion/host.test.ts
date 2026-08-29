import { afterEach, describe, expect, it, vi } from 'vitest'

import { CompanionHost } from './host'
import {
  decodePairingDescriptor,
  decryptCompanionMessage,
  encryptCompanionMessage,
  nowIso,
  type CompanionStatus,
  type EncryptedEnvelope,
  type RemoteCommandName,
} from './protocol'

interface SentPacket {
  data: unknown
  target: unknown
}

class FakeHostSdk extends EventTarget {
  static readonly VERSION = '1.5.5'
  static instance: FakeHostSdk | null = null

  readonly sent: SentPacket[] = []
  readonly options: Record<string, unknown>
  joinedRoom: Record<string, unknown> | null = null
  published: { stream: MediaStream; options: Record<string, unknown> } | null = null

  constructor(options: Record<string, unknown> = {}) {
    super()
    this.options = options
    FakeHostSdk.instance = this
  }

  async connect(): Promise<void> {}
  async joinRoom(options: Record<string, unknown>): Promise<void> {
    this.joinedRoom = options
  }
  async publish(stream: MediaStream, options: Record<string, unknown>): Promise<string> {
    this.published = { stream, options }
    return String(options.streamID)
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

function sdk(): FakeHostSdk {
  const instance = FakeHostSdk.instance
  if (!instance) throw new Error('Fake host SDK was not constructed.')
  return instance
}

const status: CompanionStatus = {
  revision: 5,
  phase: 'stimulus',
  route: 'immersive-vr',
  language: 'en',
  xrPresenting: true,
  participantActive: true,
  blockOrdinal: 1,
  condition: 'HC_HE',
  mediaElapsedSeconds: 3,
  mediaDurationSeconds: 300,
  mediaPaused: false,
  storageHealthy: true,
  remoteAdvanceAllowed: false,
  remoteBackAllowed: false,
  remoteStartAllowed: false,
}

describe('companion host control channel', () => {
  afterEach(() => {
    delete window.VDONinjaSDK
    FakeHostSdk.instance = null
  })

  it('binds authenticated commands to the publisher direction and study revision', async () => {
    window.VDONinjaSDK = FakeHostSdk
    const track = { stop: vi.fn() }
    const stream = {
      getVideoTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream
    const canvas = document.createElement('canvas')
    Object.defineProperty(canvas, 'captureStream', { value: () => stream })
    const handleCommand = vi.fn(
      async (_name: Exclude<RemoteCommandName, 'request_status'>, _expectedRevision: number) => ({
        accepted: true,
        code: 'applied',
        message: 'Applied.',
      }),
    )
    const host = new CompanionHost({ getStatus: () => status, handleCommand })
    const snapshot = await host.start(canvas)
    const descriptor = decodePairingDescriptor(new URL(snapshot.pairingUrl ?? '').hash)

    expect(sdk().options.password).toBe(`s6-vdo-v1-${descriptor.key}`)
    expect(sdk().joinedRoom).toEqual({ room: descriptor.room })
    expect(sdk().published?.options).toMatchObject({ streamID: descriptor.streamId })

    sdk().dispatchEvent(new CustomEvent('dataChannelOpen', {
      detail: { uuid: 'viewer-peer', type: 'publisher', streamID: descriptor.streamId },
    }))
    await vi.waitFor(() => expect(sdk().sent).toHaveLength(1))
    expect(sdk().sent[0]?.target).toEqual({ uuid: 'viewer-peer', preference: 'publisher' })
    expect(await decryptCompanionMessage(
      descriptor.key,
      sdk().sent[0]?.data as EncryptedEnvelope,
    )).toMatchObject({ kind: 'hello', role: 'experiment' })

    sdk().dispatchEvent(new CustomEvent('dataReceived', {
      detail: {
        uuid: 'viewer-peer',
        data: await encryptCompanionMessage(descriptor.key, {
          protocol: 'spatial-study-6-companion/v1',
          kind: 'hello',
          role: 'companion',
          sequence: 0,
          sentAt: nowIso(),
        }),
      },
    }))
    await vi.waitFor(() => expect(sdk().sent).toHaveLength(2))
    expect(host.snapshot().viewerCount).toBe(1)

    sdk().dispatchEvent(new CustomEvent('dataReceived', {
      detail: {
        uuid: 'viewer-peer',
        data: await encryptCompanionMessage(descriptor.key, {
          protocol: 'spatial-study-6-companion/v1',
          kind: 'command',
          sequence: 1,
          sentAt: nowIso(),
          commandId: crypto.randomUUID(),
          name: 'pause_media',
          expectedRevision: 4,
        }),
      },
    }))
    await vi.waitFor(() => expect(sdk().sent).toHaveLength(4))
    expect(handleCommand).not.toHaveBeenCalled()
    expect(await decryptCompanionMessage(
      descriptor.key,
      sdk().sent[2]?.data as EncryptedEnvelope,
    )).toMatchObject({ kind: 'ack', accepted: false, code: 'stale_revision' })

    sdk().dispatchEvent(new CustomEvent('dataReceived', {
      detail: {
        uuid: 'viewer-peer',
        data: await encryptCompanionMessage(descriptor.key, {
          protocol: 'spatial-study-6-companion/v1',
          kind: 'command',
          sequence: 2,
          sentAt: nowIso(),
          commandId: crypto.randomUUID(),
          name: 'pause_media',
          expectedRevision: 5,
        }),
      },
    }))
    await vi.waitFor(() => expect(sdk().sent).toHaveLength(6))
    expect(handleCommand).toHaveBeenCalledWith('pause_media', 5)

    await host.stop()
    expect(track.stop).toHaveBeenCalled()
  })
})

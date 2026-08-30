import { afterEach, describe, expect, it, vi } from 'vitest'

import { CompanionHost } from './host'
import {
  createPairingDescriptor,
  decodePairingDescriptor,
  type CompanionStatus,
  type RemoteMutationCommandRequest,
} from './protocol'
import { CompanionViewer, type CommandAcknowledgement } from './viewer'
import type { VdoNinjaSdk, VdoOpenChannelOptions } from './vdo-sdk'

class LinkedChannel extends EventTarget {
  readonly label: string
  readonly ordered: boolean
  readonly maxRetransmits: number | null
  readonly maxPacketLifeTime: number | null
  readyState: RTCDataChannelState = 'open'
  bufferedAmount = 0
  bufferedAmountLowThreshold = 0
  binaryType: BinaryType = 'blob'
  peer: LinkedChannel | null = null

  constructor(label: string, options: VdoOpenChannelOptions = {}) {
    super()
    this.label = `x-${label}`
    this.ordered = options.ordered ?? true
    this.maxRetransmits = options.maxRetransmits ?? null
    this.maxPacketLifeTime = options.maxPacketLifeTime ?? null
  }

  send(data: string): void {
    if (this.readyState !== 'open') throw new Error('The linked channel is closed.')
    const peer = this.peer
    window.setTimeout(() => {
      if (peer?.readyState === 'open') peer.dispatchEvent(new MessageEvent('message', { data }))
    }, 0)
  }

  close(): void {
    if (this.readyState === 'closed') return
    this.finishClose()
    const peer = this.peer
    window.setTimeout(() => peer?.finishClose(), 0)
  }

  private finishClose(): void {
    if (this.readyState === 'closed') return
    this.readyState = 'closed'
    this.dispatchEvent(new Event('close'))
  }
}

class FakeNetwork {
  private sequence = 0
  readonly peers = new Map<string, FakeSdk>()
  readonly publishers = new Map<string, FakeSdk>()

  register(sdk: FakeSdk): string {
    const peerId = `vdo_peer_${++this.sequence}`
    this.peers.set(peerId, sdk)
    return peerId
  }

  view(controller: FakeSdk, streamId: string): void {
    const target = this.publishers.get(streamId)
    if (!target) throw new Error(`No publisher for ${streamId}.`)
    target.dispatchEvent(new CustomEvent('dataChannelOpen', {
      detail: { uuid: controller.peerId, type: 'publisher', streamID: streamId },
    }))
  }

  open(
    target: FakeSdk,
    controllerId: string,
    label: string,
    options: VdoOpenChannelOptions,
  ): RTCDataChannel {
    const controller = this.peers.get(controllerId)
    if (!controller) throw new Error(`No controller peer ${controllerId}.`)
    const local = new LinkedChannel(label, options)
    const remote = new LinkedChannel(label, options)
    local.peer = remote
    remote.peer = local
    controller.dispatchEvent(new CustomEvent('channelOpen', {
      detail: {
        uuid: target.peerId,
        streamID: target.publishedStreamId,
        label: remote.label,
        channel: remote as unknown as RTCDataChannel,
      },
    }))
    return local as unknown as RTCDataChannel
  }

  reset(): void {
    this.sequence = 0
    this.peers.clear()
    this.publishers.clear()
  }
}

const network = new FakeNetwork()

class FakeSdk extends EventTarget implements VdoNinjaSdk {
  static readonly VERSION = '1.5.5'
  static readonly instances: FakeSdk[] = []

  readonly peerId: string
  readonly options: Record<string, unknown>
  publishedStreamId: string | undefined
  disconnected = false

  constructor(options: Record<string, unknown> = {}) {
    super()
    this.options = options
    this.peerId = network.register(this)
    FakeSdk.instances.push(this)
  }

  async connect(): Promise<void> {}

  async joinRoom(_options: { room: string; password?: string | false }): Promise<void> {}

  async announce(options: { streamID: string; label: string }): Promise<string> {
    this.publishedStreamId = options.streamID
    network.publishers.set(options.streamID, this)
    return options.streamID
  }

  async publish(
    _stream: MediaStream,
    options: { streamID: string; label: string; room?: string; password?: string | false },
  ): Promise<string> {
    this.publishedStreamId = options.streamID
    network.publishers.set(options.streamID, this)
    return options.streamID
  }

  async view(
    streamId: string,
    _options: { audio: boolean; video: boolean; label?: string },
  ): Promise<RTCPeerConnection | null> {
    network.view(this, streamId)
    return null
  }

  sendData(
    _data: unknown,
    _target?: {
      uuid?: string
      streamID?: string
      preference?: 'publisher' | 'viewer' | 'any' | 'all'
    },
  ): boolean {
    return true
  }

  async openChannel(
    uuid: string,
    label: string,
    options: VdoOpenChannelOptions = {},
  ): Promise<RTCDataChannel> {
    return network.open(this, uuid, label, options)
  }

  async disconnect(): Promise<void> {
    this.disconnected = true
  }
}

function makeStatus(revision = 7): CompanionStatus {
  return {
    revision,
    phase: 'stimulus',
    route: 'immersive-vr',
    language: 'en',
    variant: 'DHS',
    timingMode: 'full',
    participantPrefix: 'PH',
    xrPresenting: true,
    participantActive: true,
    completedBlockCount: 0,
    blockOrdinal: 2,
    condition: 'HC_HE',
    mediaElapsedSeconds: 12,
    mediaDurationSeconds: 300,
    mediaPaused: false,
    storageHealthy: true,
    authority: 'webxr_experiment_owner',
    bridgeConnected: true,
    recordingState: 'recording',
    recordingRevision: 12,
    recordingMarkerCount: 3,
    recordingSamplesWritten: 1_300,
    recordingDroppedBatches: 0,
    recordingArtifactOpen: true,
    recordingDurable: true,
    polarPhase: 'streaming',
    polarReady: true,
    polarReadinessReason: 'Real 130 Hz ECG is stable and durable.',
    heartRateBpm: 64,
    ecgSampleRateHz: 130,
    ecgSampleCount: 1_300,
    lastEcgSampleAgeMs: 12,
    polarWriterHealthy: true,
    polarReconnectCount: 0,
    polarGapCount: 0,
    startPreflightReady: true,
    lastReceiptStage: 'observed',
    remoteControlEnabled: true,
    remoteConfigureAllowed: false,
    remoteParticipantStartAllowed: false,
    remoteAdvanceAllowed: false,
    remoteBackAllowed: false,
    remoteStartAllowed: false,
    remoteAbortAllowed: true,
    remoteFinalizeAllowed: false,
    remoteExportAllowed: true,
  }
}

function testCanvas(): HTMLCanvasElement {
  const track = { stop: vi.fn() }
  const stream = {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream
  const canvas = document.createElement('canvas')
  Object.defineProperty(canvas, 'captureStream', { value: () => stream })
  return canvas
}

describe('companion viewer BRSP controller', () => {
  afterEach(() => {
    delete window.VDONinjaSDK
    FakeSdk.instances.length = 0
    network.reset()
  })

  it('uses the latest authoritative WebXR revision and receives an applied acknowledgement', async () => {
    window.VDONinjaSDK = FakeSdk
    let currentStatus = makeStatus()
    const handleCommand = vi.fn(
      async (
        request: RemoteMutationCommandRequest,
        expectedRevision: number,
      ) => {
        currentStatus = {
          ...currentStatus,
          revision: expectedRevision + 1,
          mediaPaused: request.name === 'pause_media',
        }
        return { accepted: true, code: 'paused', message: 'Media paused.' }
      },
    )
    const host = new CompanionHost({ getStatus: () => currentStatus, handleCommand })
    let viewer: CompanionViewer | undefined

    try {
      const started = await host.start(testCanvas())
      const descriptor = decodePairingDescriptor(new URL(started.pairingUrl ?? '').hash)
      viewer = new CompanionViewer(descriptor)
      const statuses: CompanionStatus[] = []
      const acknowledgements: CommandAcknowledgement[] = []
      viewer.addEventListener('status', (event) => {
        statuses.push((event as CustomEvent<CompanionStatus>).detail)
      })
      viewer.addEventListener('ack', (event) => {
        acknowledgements.push((event as CustomEvent<CommandAcknowledgement>).detail)
      })

      await viewer.connect()
      await vi.waitFor(() => {
        expect(viewer?.snapshot()).toMatchObject({
          phase: 'connected',
          peerConnected: true,
          controlProtocol: 'brsp/1',
          stateStale: false,
        })
        expect(statuses.some(({ revision }) => revision === 7)).toBe(true)
      }, { timeout: 3_000 })

      const commandId = await viewer.sendCommand({ name: 'pause_media', args: {} })
      await vi.waitFor(() => {
        expect(acknowledgements.find((entry) => entry.commandId === commandId)).toMatchObject({
          accepted: true,
          code: 'paused',
          resultingRevision: 8,
        })
        expect(statuses.some(({ revision, mediaPaused, remoteCommandReceiptId }) => (
          revision === 8
          && mediaPaused
          && remoteCommandReceiptId === commandId
        ))).toBe(true)
      }, { timeout: 3_000 })
      expect(handleCommand).toHaveBeenCalledWith({ name: 'pause_media', args: {} }, 7)
    } finally {
      await viewer?.stop()
      await host.stop()
    }
  })

  it('does not clear a command barrier with an older equal-revision status', () => {
    const viewer = new CompanionViewer(createPairingDescriptor())
    const expectedCommandId = 'cmd_expected1234'
    Reflect.set(viewer, 'latestRevision', 7)
    Reflect.set(viewer, 'awaitingStatusCommandId', expectedCommandId)

    const acceptStatus = viewer as unknown as {
      acceptStatus: (status: CompanionStatus, revision: number) => void
    }
    acceptStatus.acceptStatus({
      ...makeStatus(7),
      remoteCommandReceiptId: 'cmd_older123456',
    }, 7)
    expect(viewer.snapshot().commandGateBlocked).toBe(true)

    acceptStatus.acceptStatus({
      ...makeStatus(7),
      remoteCommandReceiptId: expectedCommandId,
    }, 7)
    expect(viewer.snapshot().commandGateBlocked).toBe(false)
  })

  it('keeps controls gated until this connection receives authoritative status', () => {
    const viewer = new CompanionViewer(createPairingDescriptor())
    expect(viewer.snapshot().commandGateBlocked).toBe(true)

    const acceptStatus = viewer as unknown as {
      acceptStatus: (status: CompanionStatus, revision: number) => void
    }
    acceptStatus.acceptStatus(makeStatus(7), 7)
    expect(viewer.snapshot().commandGateBlocked).toBe(false)
  })

  it('keeps state-changing controls gated while authoritative status is stale', () => {
    const viewer = new CompanionViewer(createPairingDescriptor())
    Reflect.set(viewer, 'stateStale', true)

    expect(viewer.snapshot()).toMatchObject({
      stateStale: true,
      commandGateBlocked: true,
    })
  })

  it('never reaches ready when the controller uses a different pairing key', async () => {
    window.VDONinjaSDK = FakeSdk
    const status = makeStatus()
    const host = new CompanionHost({
      getStatus: () => status,
      handleCommand: () => ({ accepted: true, code: 'unused', message: 'Unused.' }),
    })
    let viewer: CompanionViewer | undefined

    try {
      const started = await host.start(testCanvas())
      const descriptor = decodePairingDescriptor(new URL(started.pairingUrl ?? '').hash)
      const wrongKey = createPairingDescriptor().key
      viewer = new CompanionViewer({ ...descriptor, key: wrongKey })
      const statusListener = vi.fn()
      viewer.addEventListener('status', statusListener)

      await viewer.connect()
      await vi.waitFor(() => {
        const authenticationFailed = viewer?.snapshot().phase === 'error'
          || /proof failed|rejected/iu.test(host.snapshot().message)
        expect(authenticationFailed).toBe(true)
      }, { timeout: 3_000 })
      expect(host.snapshot().viewerCount).toBe(0)
      expect(viewer.snapshot().peerConnected).toBe(false)
      expect(statusListener).not.toHaveBeenCalled()
    } finally {
      await viewer?.stop()
      await host.stop()
    }
  })

  it('fails closed when a silent target misses the authentication deadline', async () => {
    window.VDONinjaSDK = FakeSdk
    const descriptor = createPairingDescriptor()
    const silentTarget = new FakeSdk()
    await silentTarget.connect()
    await silentTarget.joinRoom({ room: descriptor.room })
    await silentTarget.announce({
      streamID: descriptor.streamId,
      label: 'silent target',
    })
    const viewer = new CompanionViewer(descriptor, { authenticationTimeoutMs: 25 })

    await viewer.connect()
    const controllerSdk = FakeSdk.instances.at(-1)!
    await vi.waitFor(() => {
      expect(viewer.snapshot()).toMatchObject({ phase: 'error', peerConnected: false })
      expect(controllerSdk.disconnected).toBe(true)
      expect(Reflect.get(viewer, 'brsp')).toBeNull()
      expect(Reflect.get(viewer, 'transport')).toBeNull()
    }, { timeout: 1_000 })

    silentTarget.dispatchEvent(new CustomEvent('dataChannelOpen', {
      detail: { uuid: controllerSdk.peerId, streamID: descriptor.streamId },
    }))
    await new Promise((resolve) => window.setTimeout(resolve, 30))
    expect(viewer.snapshot()).toMatchObject({ phase: 'error', peerConnected: false })
    await viewer.stop()
  })
})

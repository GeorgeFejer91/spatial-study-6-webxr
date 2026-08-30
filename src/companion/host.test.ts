import { afterEach, describe, expect, it, vi } from 'vitest'

import { STUDY6_BRSP_SCOPES } from './brsp-study6'
import { CompanionHost } from './host'
import {
  createPairingDescriptor,
  decodePairingDescriptor,
  type CompanionStatus,
  type RemoteMutationCommandRequest,
} from './protocol'
import { CompanionViewer, type CommandAcknowledgement } from './viewer'
import { decodeEnvelope } from './vendor/browser-remote-sync-protocol/brsp.js'
import type { VdoNinjaSdk, VdoOpenChannelOptions } from './vdo-sdk'

class LinkedDataChannel extends EventTarget {
  readonly label: string
  readonly ordered: boolean
  readonly maxRetransmits: number | null
  readonly maxPacketLifeTime: number | null
  readonly sent: string[] = []
  readyState: RTCDataChannelState = 'open'
  bufferedAmount = 0
  bufferedAmountLowThreshold = 0
  binaryType: BinaryType = 'blob'
  peer: LinkedDataChannel | null = null

  constructor(label: string, options: VdoOpenChannelOptions = {}) {
    super()
    this.label = `x-${label}`
    this.ordered = options.ordered ?? true
    this.maxRetransmits = options.maxRetransmits ?? null
    this.maxPacketLifeTime = options.maxPacketLifeTime ?? null
  }

  send(data: string): void {
    if (this.readyState !== 'open') throw new Error('The linked data channel is closed.')
    this.sent.push(data)
    const peer = this.peer
    window.setTimeout(() => {
      if (peer?.readyState === 'open') {
        peer.dispatchEvent(new MessageEvent('message', { data }))
      }
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

interface PublishedStream {
  sdk: FakeVdoSdk
  stream: MediaStream | null
  streamId: string
}

class FakeVdoNetwork {
  private sequence = 0
  readonly peers = new Map<string, FakeVdoSdk>()
  readonly streams = new Map<string, PublishedStream>()
  readonly channels: Array<{ owner: string; channel: LinkedDataChannel }> = []

  register(sdk: FakeVdoSdk): string {
    const id = `vdo_peer_${++this.sequence}`
    this.peers.set(id, sdk)
    return id
  }

  publish(sdk: FakeVdoSdk, stream: MediaStream | null, streamId: string): void {
    this.streams.set(streamId, { sdk, stream, streamId })
  }

  view(controller: FakeVdoSdk, streamId: string): void {
    const published = this.streams.get(streamId)
    if (!published) throw new Error(`No fake publisher for ${streamId}.`)
    published.sdk.dispatchEvent(new CustomEvent('dataChannelOpen', {
      detail: {
        uuid: controller.peerId,
        type: 'publisher',
        streamID: published.streamId,
      },
    }))
  }

  openChannel(
    target: FakeVdoSdk,
    remotePeerId: string,
    label: string,
    options: VdoOpenChannelOptions,
  ): RTCDataChannel {
    const controller = this.peers.get(remotePeerId)
    if (!controller) throw new Error(`No fake VDO peer ${remotePeerId}.`)
    const local = new LinkedDataChannel(label, options)
    const remote = new LinkedDataChannel(label, options)
    local.peer = remote
    remote.peer = local
    this.channels.push(
      { owner: target.peerId, channel: local },
      { owner: controller.peerId, channel: remote },
    )
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
    this.peers.clear()
    this.streams.clear()
    this.channels.length = 0
    this.sequence = 0
  }
}

const network = new FakeVdoNetwork()

class FakeVdoSdk extends EventTarget implements VdoNinjaSdk {
  static readonly VERSION = '1.5.5'
  static readonly instances: FakeVdoSdk[] = []

  readonly peerId: string
  readonly options: Record<string, unknown>
  publishedStreamId: string | undefined
  disconnectPromise: Promise<void> = Promise.resolve()

  constructor(options: Record<string, unknown> = {}) {
    super()
    this.options = options
    this.peerId = network.register(this)
    FakeVdoSdk.instances.push(this)
  }

  async connect(): Promise<void> {}

  async joinRoom(_options: { room: string; password?: string | false }): Promise<void> {}

  async announce(options: { streamID: string; label: string }): Promise<string> {
    this.publishedStreamId = options.streamID
    network.publish(this, null, options.streamID)
    return options.streamID
  }

  async publish(
    stream: MediaStream,
    options: { streamID: string; label: string; room?: string; password?: string | false },
  ): Promise<string> {
    this.publishedStreamId = options.streamID
    network.publish(this, stream, options.streamID)
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
    return network.openChannel(this, uuid, label, options)
  }

  async disconnect(): Promise<void> {
    await this.disconnectPromise
  }
}

function makeStatus(revision: number, recordingRevision = 12): CompanionStatus {
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
    blockOrdinal: 1,
    condition: 'HC_HE',
    mediaElapsedSeconds: 3,
    mediaDurationSeconds: 300,
    mediaPaused: false,
    storageHealthy: true,
    authority: 'webxr_experiment_owner',
    bridgeConnected: true,
    recordingState: 'recording',
    recordingRevision,
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

function canvasWithTrack(): {
  canvas: HTMLCanvasElement
  track: { stop: ReturnType<typeof vi.fn> }
  capture: ReturnType<typeof vi.fn>
} {
  const track = { stop: vi.fn() }
  const stream = {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream
  const canvas = document.createElement('canvas')
  const capture = vi.fn(() => stream)
  Object.defineProperty(canvas, 'captureStream', { value: capture })
  return { canvas, track, capture }
}

describe('companion host BRSP target', () => {
  afterEach(() => {
    delete window.VDONinjaSDK
    FakeVdoSdk.instances.length = 0
    network.reset()
  })

  it('authenticates a viewer, rejects a stale WebXR revision, and keeps sensor revision as result telemetry', async () => {
    window.VDONinjaSDK = FakeVdoSdk
    let currentStatus = makeStatus(5)
    const handleCommand = vi.fn(
      async (
        request: RemoteMutationCommandRequest,
        expectedRevision: number,
      ) => {
        currentStatus = {
          ...currentStatus,
          revision: expectedRevision + 1,
          mediaPaused: request.name === 'pause_media',
          recordingRevision: 88,
        }
        return {
          accepted: true,
          code: 'applied',
          message: 'Applied by WebXR.',
          sensorRevision: 88,
        }
      },
    )
    const { canvas, track } = canvasWithTrack()
    const host = new CompanionHost({
      getStatus: () => currentStatus,
      handleCommand,
      spectatorMedia: true,
    })
    let viewer: CompanionViewer | undefined

    try {
      const hostStarted = await host.start(canvas)
      const descriptor = decodePairingDescriptor(new URL(hostStarted.pairingUrl ?? '').hash)
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
        expect(host.snapshot()).toMatchObject({ viewerCount: 1 })
        expect(viewer?.snapshot()).toMatchObject({ phase: 'connected', peerConnected: true })
        expect(statuses.some((entry) => entry.revision === 5)).toBe(true)
      }, { timeout: 3_000 })
      expect(host.snapshot().acceptedScopes).toEqual([...STUDY6_BRSP_SCOPES].sort())
      expect(viewer.snapshot().acceptedScopes).toEqual([...STUDY6_BRSP_SCOPES].sort())

      // Advance authority without publishing it: the controller's explicit
      // expectedRevision=5 is now stale against the WebXR-owned revision 6.
      currentStatus = { ...currentStatus, revision: 6 }
      const staleCommandId = await viewer.sendCommand({ name: 'pause_media', args: {} })
      await vi.waitFor(() => {
        expect(acknowledgements.find(({ commandId }) => commandId === staleCommandId)).toMatchObject({
          accepted: false,
          code: 'stale_revision',
          resultingRevision: 6,
        })
        expect(statuses.some((entry) => entry.revision === 6)).toBe(true)
      }, { timeout: 3_000 })
      expect(handleCommand).not.toHaveBeenCalled()

      const appliedCommandId = await viewer.sendCommand({ name: 'pause_media', args: {} })
      await vi.waitFor(() => {
        expect(acknowledgements.find(({ commandId }) => commandId === appliedCommandId)).toMatchObject({
          accepted: true,
          code: 'applied',
          resultingRevision: 7,
        })
        expect(statuses.some((entry) => (
          entry.revision === 7
          && entry.recordingRevision === 88
          && entry.remoteCommandReceiptId === appliedCommandId
        ))).toBe(true)
      }, { timeout: 3_000 })
      expect(handleCommand).toHaveBeenCalledWith({ name: 'pause_media', args: {} }, 6)

      const targetControlMessages = network.channels
        .filter(({ owner, channel }) => (
          owner === FakeVdoSdk.instances[0]?.peerId && channel.label === 'x-brsp_control_v1'
        ))
        .flatMap(({ channel }) => channel.sent)
        .map((message) => decodeEnvelope(message))
      expect(targetControlMessages).toContainEqual(expect.objectContaining({
        type: 'applied',
        body: expect.objectContaining({
          commandId: appliedCommandId,
          revision: 7,
          result: expect.objectContaining({ sensorRevision: 88 }),
        }),
      }))
    } finally {
      await viewer?.stop()
      await host.stop()
    }

    expect(track.stop).toHaveBeenCalled()
  })

  it('rearms the same pairing descriptor after rejecting a wrong-key viewer', async () => {
    window.VDONinjaSDK = FakeVdoSdk
    const currentStatus = makeStatus(9)
    const { canvas } = canvasWithTrack()
    const host = new CompanionHost({
      getStatus: () => currentStatus,
      handleCommand: vi.fn(),
    })
    let wrongKeyViewer: CompanionViewer | undefined
    let correctKeyViewer: CompanionViewer | undefined

    try {
      const hostStarted = await host.start(canvas)
      const descriptor = decodePairingDescriptor(new URL(hostStarted.pairingUrl ?? '').hash)
      const replacementFirstCharacter = descriptor.key.startsWith('A') ? 'B' : 'A'
      wrongKeyViewer = new CompanionViewer({
        ...descriptor,
        key: `${replacementFirstCharacter}${descriptor.key.slice(1)}`,
      })

      await wrongKeyViewer.connect()
      await vi.waitFor(() => {
        expect(wrongKeyViewer?.snapshot().phase).toBe('error')
        expect(host.snapshot()).toMatchObject({
          phase: 'broadcasting',
          viewerCount: 0,
        })
        expect(host.snapshot().message).toContain('pairing is rearmed')
      }, { timeout: 3_000 })
      await wrongKeyViewer.stop()

      const statuses: CompanionStatus[] = []
      correctKeyViewer = new CompanionViewer(descriptor)
      correctKeyViewer.addEventListener('status', (event) => {
        statuses.push((event as CustomEvent<CompanionStatus>).detail)
      })
      await correctKeyViewer.connect()

      await vi.waitFor(() => {
        expect(host.snapshot()).toMatchObject({ viewerCount: 1 })
        expect(correctKeyViewer?.snapshot()).toMatchObject({
          phase: 'connected',
          peerConnected: true,
        })
        expect(statuses.some((entry) => entry.revision === 9)).toBe(true)
      }, { timeout: 3_000 })
    } finally {
      await wrongKeyViewer?.stop()
      await correctKeyViewer?.stop()
      await host.stop()
    }
  })

  it('evicts a silent peer after the authentication deadline and admits a controller', async () => {
    window.VDONinjaSDK = FakeVdoSdk
    const currentStatus = makeStatus(11)
    const { canvas } = canvasWithTrack()
    const host = new CompanionHost({
      getStatus: () => currentStatus,
      handleCommand: vi.fn(),
      authenticationTimeoutMs: 100,
    })
    let controller: CompanionViewer | undefined

    try {
      const hostStarted = await host.start(canvas)
      const descriptor = decodePairingDescriptor(new URL(hostStarted.pairingUrl ?? '').hash)
      const silentPeer = new FakeVdoSdk()
      await silentPeer.connect()
      await silentPeer.joinRoom({ room: descriptor.room })
      await silentPeer.view(descriptor.streamId, { audio: false, video: false })

      await vi.waitFor(() => {
        expect(host.snapshot()).toMatchObject({
          phase: 'broadcasting',
          viewerCount: 0,
        })
        expect(host.snapshot().message).toContain('authentication timed out')
      }, { timeout: 3_000 })

      const statuses: CompanionStatus[] = []
      controller = new CompanionViewer(descriptor)
      controller.addEventListener('status', (event) => {
        statuses.push((event as CustomEvent<CompanionStatus>).detail)
      })
      await controller.connect()

      await vi.waitFor(() => {
        expect(host.snapshot().viewerCount).toBe(1)
        expect(controller?.snapshot()).toMatchObject({
          phase: 'connected',
          peerConnected: true,
          commandGateBlocked: false,
        })
        expect(statuses.some(({ revision }) => revision === 11)).toBe(true)
      }, { timeout: 3_000 })
    } finally {
      await controller?.stop()
      await host.stop()
    }
  })

  it('uses a data-only peer by default and grants only status while control is off', async () => {
    window.VDONinjaSDK = FakeVdoSdk
    const status = { ...makeStatus(13), remoteControlEnabled: false }
    const { canvas, capture } = canvasWithTrack()
    const host = new CompanionHost({
      getStatus: () => status,
      handleCommand: vi.fn(),
    })
    let viewer: CompanionViewer | undefined

    try {
      const started = await host.start(canvas)
      const descriptor = decodePairingDescriptor(new URL(started.pairingUrl ?? '').hash)
      expect(descriptor.spectatorMedia).toBe(false)
      expect(capture).not.toHaveBeenCalled()
      viewer = new CompanionViewer(descriptor)
      await viewer.connect()
      await vi.waitFor(() => {
        expect(host.snapshot().acceptedScopes).toEqual(['study.status.read'])
        expect(viewer?.snapshot().acceptedScopes).toEqual(['study.status.read'])
      }, { timeout: 3_000 })
    } finally {
      await viewer?.stop()
      await host.stop()
    }
  })

  it('reuses the exact validated trusted-operator descriptor across host restarts', async () => {
    window.VDONinjaSDK = FakeVdoSdk
    const trusted = createPairingDescriptor(true)
    const { canvas } = canvasWithTrack()
    const host = new CompanionHost({
      getStatus: () => makeStatus(14),
      handleCommand: vi.fn(),
    })

    try {
      const first = await host.start(canvas, false, trusted)
      expect(decodePairingDescriptor(new URL(first.pairingUrl ?? '').hash)).toEqual(trusted)
      await host.stop()

      const second = await host.start(canvas, false, trusted)
      expect(decodePairingDescriptor(new URL(second.pairingUrl ?? '').hash)).toEqual(trusted)
    } finally {
      await host.stop()
    }
  })

  it('invalidates the pairing secret and stops optional capture before signaling disconnect resolves', async () => {
    window.VDONinjaSDK = FakeVdoSdk
    const { canvas, track } = canvasWithTrack()
    const host = new CompanionHost({
      getStatus: () => makeStatus(15),
      handleCommand: vi.fn(),
      spectatorMedia: true,
    })
    await host.start(canvas)

    let releaseDisconnect: () => void = () => {}
    FakeVdoSdk.instances[0]!.disconnectPromise = new Promise<void>((resolve) => {
      releaseDisconnect = resolve
    })
    let settled = false
    const stopping = host.stop().then(() => {
      settled = true
    })

    expect(host.snapshot()).toMatchObject({ phase: 'idle', pairingUrl: null })
    expect(track.stop).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    expect(settled).toBe(false)
    releaseDisconnect()
    await stopping
  })
})

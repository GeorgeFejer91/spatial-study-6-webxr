import { describe, expect, it, vi } from 'vitest'

import {
  Study6BrspVdoPeerTransport,
  VDO_BRSP_CONTROL_BACKLOG_LIMIT,
  VDO_BRSP_CONTROL_CHANNEL,
  VDO_BRSP_STATE_CHANNEL,
} from './brsp-vdo-peer-transport'
import {
  BRSP_CONTROL_MAX_BYTES,
  BRSP_STATE_MAX_BYTES,
} from './vendor/browser-remote-sync-protocol/brsp.js'
import type { VdoNinjaSdk, VdoOpenChannelOptions } from './vdo-sdk'

class FakeChannel extends EventTarget {
  readonly label: string
  readonly ordered: boolean
  readonly maxRetransmits: number | null
  readonly maxPacketLifeTime: number | null = null
  readyState: RTCDataChannelState = 'open'
  bufferedAmount = 0
  bufferedAmountLowThreshold = 0
  binaryType: BinaryType = 'blob'
  readonly sent: string[] = []

  constructor(label: string, { ordered = true, maxRetransmits }: VdoOpenChannelOptions = {}) {
    super()
    this.label = `x-${label}`
    this.ordered = ordered
    this.maxRetransmits = maxRetransmits ?? null
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    if (this.readyState === 'closed') return
    this.readyState = 'closed'
    this.dispatchEvent(new Event('close'))
  }

  receive(data: string): void {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }
}

interface OpenCall {
  peerKey: string
  label: string
  options: VdoOpenChannelOptions
}

class FakeSdk extends EventTarget {
  readonly openCalls: OpenCall[] = []
  readonly channels = new Map<string, FakeChannel>()

  async openChannel(
    peerKey: string,
    label: string,
    options: VdoOpenChannelOptions = {},
  ): Promise<RTCDataChannel> {
    this.openCalls.push({ peerKey, label, options })
    const channel = new FakeChannel(label, options)
    this.channels.set(label, channel)
    return channel as unknown as RTCDataChannel
  }

  emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail }))
  }
}

function asSdk(sdk: FakeSdk): VdoNinjaSdk {
  return sdk as unknown as VdoNinjaSdk
}

function once<Detail>(target: EventTarget, type: string): Promise<Detail> {
  return new Promise((resolve) => {
    target.addEventListener(type, (event) => {
      resolve((event as Event & { detail: Detail }).detail)
    }, { once: true })
  })
}

function controllerChannel(
  sdk: FakeSdk,
  peerKey: string,
  streamID: string,
  label: string,
  options: VdoOpenChannelOptions,
): FakeChannel {
  const channel = new FakeChannel(label, options)
  sdk.emit('channelOpen', {
    uuid: peerKey,
    streamID,
    label: channel.label,
    channel,
  })
  return channel
}

describe('Study 6 same-peer BRSP VDO transport', () => {
  it('opens exact reliable control and unordered zero-retry state lanes for one publisher peer', async () => {
    const sdk = new FakeSdk()
    const transport = new Study6BrspVdoPeerTransport({
      sdk: asSdk(sdk),
      role: 'target',
      streamId: 'study-stream',
    })

    sdk.emit('dataChannelOpen', { uuid: 'too-early', type: 'publisher', streamID: 'study-stream' })
    expect(sdk.openCalls).toHaveLength(0)
    transport.start()
    sdk.emit('dataChannelOpen', { uuid: 'wrong-direction', type: 'viewer', streamID: 'study-stream' })
    sdk.emit('dataChannelOpen', { uuid: 'wrong-stream', type: 'publisher', streamID: 'other-stream' })
    expect(sdk.openCalls).toHaveLength(0)

    const opened = once<{ peerKey: string }>(transport, 'peeropen')
    sdk.emit('dataChannelOpen', { uuid: 'controller-peer', type: 'publisher', streamID: 'study-stream' })
    await expect(opened).resolves.toEqual({ peerKey: 'controller-peer' })
    expect(sdk.openCalls).toEqual([
      { peerKey: 'controller-peer', label: VDO_BRSP_CONTROL_CHANNEL, options: { ordered: true } },
      {
        peerKey: 'controller-peer',
        label: VDO_BRSP_STATE_CHANNEL,
        options: { ordered: false, maxRetransmits: 0 },
      },
    ])

    sdk.emit('dataChannelOpen', { uuid: 'second-peer', type: 'publisher', streamID: 'study-stream' })
    expect(sdk.openCalls).toHaveLength(2)
    transport.stop()
  })

  it('accepts the target-created lanes on the controller and emits bounded lane messages', async () => {
    const sdk = new FakeSdk()
    const transport = new Study6BrspVdoPeerTransport({
      sdk: asSdk(sdk),
      role: 'controller',
      streamId: 'study-stream',
    })
    transport.start()
    const opened = once<{ peerKey: string }>(transport, 'peeropen')
    const state = controllerChannel(sdk, 'target-peer', 'study-stream', VDO_BRSP_STATE_CHANNEL, {
      ordered: false,
      maxRetransmits: 0,
    })
    const control = controllerChannel(sdk, 'target-peer', 'study-stream', VDO_BRSP_CONTROL_CHANNEL, {
      ordered: true,
    })
    await expect(opened).resolves.toEqual({ peerKey: 'target-peer' })

    const controlMessage = once<{ peerKey: string; data: string }>(transport, 'controlmessage')
    control.receive('control')
    await expect(controlMessage).resolves.toEqual({ peerKey: 'target-peer', data: 'control' })
    const stateMessage = once<{ peerKey: string; data: string }>(transport, 'statemessage')
    state.receive('state')
    await expect(stateMessage).resolves.toEqual({ peerKey: 'target-peer', data: 'state' })

    const listener = vi.fn()
    transport.addEventListener('controlmessage', listener)
    control.receive('x'.repeat(BRSP_CONTROL_MAX_BYTES + 1))
    state.receive('x'.repeat(BRSP_STATE_MAX_BYTES + 1))
    expect(listener).not.toHaveBeenCalled()
    transport.stop()
  })

  it('bounds reliable backlog and retains only the newest state under backpressure', async () => {
    const sdk = new FakeSdk()
    const transport = new Study6BrspVdoPeerTransport({ sdk: asSdk(sdk), role: 'target' })
    transport.start()
    const opened = once<{ peerKey: string }>(transport, 'peeropen')
    sdk.emit('dataChannelOpen', { uuid: 'controller-peer', type: 'publisher' })
    await opened
    const control = sdk.channels.get(VDO_BRSP_CONTROL_CHANNEL)
    const state = sdk.channels.get(VDO_BRSP_STATE_CHANNEL)
    if (!control || !state) throw new Error('Expected both fake channels.')

    expect(transport.sendControl('controller-peer', 'x'.repeat(BRSP_CONTROL_MAX_BYTES + 1))).toBe(false)
    control.bufferedAmount = VDO_BRSP_CONTROL_BACKLOG_LIMIT - 1
    expect(transport.sendControl('controller-peer', 'ab')).toBe(false)
    control.bufferedAmount = 0
    expect(transport.sendControl('controller-peer', 'ok')).toBe(true)
    expect(control.sent).toEqual(['ok'])

    state.bufferedAmount = 10
    expect(transport.sendState('controller-peer', 'old')).toBe(false)
    expect(transport.sendState('controller-peer', 'new')).toBe(false)
    expect(transport.sendState('controller-peer', 'x'.repeat(BRSP_STATE_MAX_BYTES + 1))).toBe(false)
    state.bufferedAmount = 0
    state.dispatchEvent(new Event('bufferedamountlow'))
    expect(state.sent).toEqual(['new'])
    transport.stop()
  })

  it('enforces one controller and emits one peer close when either BRSP lane closes', async () => {
    const sdk = new FakeSdk()
    const transport = new Study6BrspVdoPeerTransport({ sdk: asSdk(sdk), role: 'controller' })
    transport.start()
    const opened = once<{ peerKey: string }>(transport, 'peeropen')
    const control = controllerChannel(sdk, 'target-peer', '', VDO_BRSP_CONTROL_CHANNEL, { ordered: true })
    controllerChannel(sdk, 'target-peer', '', VDO_BRSP_STATE_CHANNEL, {
      ordered: false,
      maxRetransmits: 0,
    })
    await opened

    const rejected = controllerChannel(sdk, 'other-peer', '', VDO_BRSP_CONTROL_CHANNEL, { ordered: true })
    expect(rejected.readyState).toBe('closed')
    const closed = once<{ peerKey: string; reason: string }>(transport, 'peerclose')
    control.close()
    await expect(closed).resolves.toMatchObject({ peerKey: 'target-peer' })
    transport.stop()
  })

  it('closes local lanes without reflecting a remote peer-close event', async () => {
    const sdk = new FakeSdk()
    const transport = new Study6BrspVdoPeerTransport({ sdk: asSdk(sdk), role: 'target' })
    transport.start()
    const opened = once<{ peerKey: string }>(transport, 'peeropen')
    sdk.emit('dataChannelOpen', { uuid: 'controller-peer', type: 'publisher' })
    await opened
    const closed = vi.fn()
    transport.addEventListener('peerclose', closed)

    transport.closePeer('controller-peer')

    expect(closed).not.toHaveBeenCalled()
    expect(sdk.channels.get(VDO_BRSP_CONTROL_CHANNEL)?.readyState).toBe('closed')
    expect(sdk.channels.get(VDO_BRSP_STATE_CHANNEL)?.readyState).toBe('closed')
    expect(transport.sendControl('controller-peer', 'after-close')).toBe(false)
    transport.stop()
  })
})

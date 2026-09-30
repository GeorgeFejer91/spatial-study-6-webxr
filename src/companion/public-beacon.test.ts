import { describe, expect, it, vi } from 'vitest'

import {
  deriveStudy6PublicBeaconIdentity,
  STUDY6_PUBLIC_BEACON_MAX_TARGETS,
  STUDY6_PUBLIC_BEACON_ROOM,
  Study6PublicBeaconBroadcaster,
  Study6PublicBeaconReceiver,
  study6PublicBeaconStreamId,
} from './public-beacon.ts'
import type { VdoNinjaSdk } from './vdo-sdk.ts'

class FakeBeaconSdk extends EventTarget {
  readonly calls: Array<{ name: string; value?: unknown }> = []
  disconnectGate: Promise<void> | undefined

  async connect(): Promise<void> {
    this.calls.push({ name: 'connect' })
  }

  async joinRoom(value: { room: string; password?: string | false }): Promise<void> {
    this.calls.push({ name: 'joinRoom', value })
  }

  async announce(value: { streamID: string; label: string }): Promise<string> {
    this.calls.push({ name: 'announce', value })
    return value.streamID
  }

  async publish(): Promise<string> {
    this.calls.push({ name: 'publish' })
    throw new Error('Public discovery must not publish media.')
  }

  async view(): Promise<RTCPeerConnection | null> {
    this.calls.push({ name: 'view' })
    throw new Error('Public discovery must not view a target.')
  }

  sendData(): boolean {
    this.calls.push({ name: 'sendData' })
    throw new Error('Public discovery must not send application data.')
  }

  async openChannel(): Promise<RTCDataChannel> {
    this.calls.push({ name: 'openChannel' })
    throw new Error('Public discovery must not open a custom channel.')
  }

  async disconnect(): Promise<void> {
    this.calls.push({ name: 'disconnect' })
    await this.disconnectGate
  }

  emit(type: string, detail: unknown = {}): void {
    this.dispatchEvent(new CustomEvent(type, { detail }))
  }
}

function asSdk(sdk: FakeBeaconSdk): VdoNinjaSdk {
  return sdk as unknown as VdoNinjaSdk
}

function streamId(number: number): string {
  return study6PublicBeaconStreamId(number.toString(16).padStart(24, '0'))
}

async function microtask(): Promise<void> {
  await Promise.resolve()
}

describe('Study 6 public discovery beacon', () => {
  it('derives a stable opaque announcement from only a bounded nonsecret hint', async () => {
    const first = await deriveStudy6PublicBeaconIdentity('s6xr_public_nonsecret_hint_123456')
    const again = await deriveStudy6PublicBeaconIdentity('s6xr_public_nonsecret_hint_123456')
    const other = await deriveStudy6PublicBeaconIdentity('s6xr_public_nonsecret_hint_654321')

    expect(first).toEqual(again)
    expect(first).not.toEqual(other)
    expect(first.hint).toMatch(/^[0-9a-f]{24}$/u)
    expect(first.announcementStreamId).toBe(`s6_beacon_${first.hint}`)
    expect(first.label).toBe(`Study 6 WebXR ${first.hint.slice(0, 8).toUpperCase()}`)
    expect(JSON.stringify(first)).not.toContain('s6xr_public_nonsecret_hint')
    await expect(deriveStudy6PublicBeaconIdentity('private value with spaces')).rejects.toThrow(
      'opaque token',
    )
  })

  it('has no public-hint to control-credential derivation API', async () => {
    const module = await import('./public-beacon.ts')
    expect(module).not.toHaveProperty('deriveStudy6PublicPairingDescriptor')
  })

  it('is inert until start and publishes one passwordless data-only announcement', async () => {
    const sdk = new FakeBeaconSdk()
    const identity = await deriveStudy6PublicBeaconIdentity('s6xr_nonsecret_target_stream_123')
    const broadcaster = new Study6PublicBeaconBroadcaster(identity, {
      sdkFactory: () => asSdk(sdk),
    })

    expect(sdk.calls).toEqual([])
    await broadcaster.start()

    expect(sdk.calls).toEqual([
      { name: 'connect' },
      { name: 'joinRoom', value: { room: STUDY6_PUBLIC_BEACON_ROOM, password: false } },
      {
        name: 'announce',
        value: { streamID: identity.announcementStreamId, label: identity.label },
      },
    ])
    expect(broadcaster.snapshot()).toMatchObject({
      phase: 'broadcasting',
      hint: identity.hint,
      label: identity.label,
    })
    expect(sdk.calls.some(({ name }) => ['publish', 'view', 'sendData', 'openChannel'].includes(name)))
      .toBe(false)

    sdk.emit('disconnected', { willReconnect: true })
    expect(broadcaster.snapshot().phase).toBe('reconnecting')
    sdk.emit('reconnected')
    expect(broadcaster.snapshot().phase).toBe('broadcasting')
    await broadcaster.stop()
    expect(broadcaster.snapshot().phase).toBe('idle')
    expect(sdk.calls.at(-1)).toEqual({ name: 'disconnect' })
  })

  it('rejects a caller-provided label or mismatched public stream identity', async () => {
    const identity = await deriveStudy6PublicBeaconIdentity('s6xr_nonsecret_target_stream_456')
    expect(() => new Study6PublicBeaconBroadcaster({
      ...identity,
      label: 'Participant PH-42 has ECG ready and all permissions',
    })).toThrow('not canonical')
    expect(() => new Study6PublicBeaconBroadcaster({
      ...identity,
      announcementStreamId: 's6_beacon_000000000000000000000000',
    })).toThrow('not canonical')
  })

  it('lists only canonical opaque targets and never projects peer or experiment metadata', async () => {
    const sdk = new FakeBeaconSdk()
    const receiver = new Study6PublicBeaconReceiver({ sdkFactory: () => asSdk(sdk) })
    await receiver.start()

    expect(sdk.calls).toEqual([
      { name: 'connect' },
      { name: 'joinRoom', value: { room: STUDY6_PUBLIC_BEACON_ROOM, password: false } },
    ])
    sdk.emit('listing', {
      list: [
        {
          streamID: streamId(1),
          UUID: 'peer_one',
          label: 'pairingKey=do-not-project',
          pairingKey: 'secret',
          scopes: ['all'],
          participantId: 'PH-42',
          ecg: [1, 2, 3],
        },
        { streamID: 'unrelated_public_stream', UUID: 'other' },
        { streamID: 's6_beacon_not-a-valid-hint', UUID: 'spoof' },
      ],
      raw: { privateStatus: 'must-not-project' },
    })
    await microtask()

    const snapshot = receiver.snapshot()
    expect(snapshot.phase).toBe('listening')
    expect(snapshot.targets).toEqual([{
      hint: '000000000000000000000001',
      label: 'Study 6 WebXR 00000000',
    }])
    expect(Object.keys(snapshot.targets[0] ?? {}).sort()).toEqual(['hint', 'label'])
    expect(JSON.stringify(snapshot)).not.toMatch(/peer_one|pairingKey|secret|scopes|participant|ecg/iu)
    expect(sdk.calls.some(({ name }) => ['publish', 'announce', 'view', 'sendData', 'openChannel'].includes(name)))
      .toBe(false)

  })

  it('bounds listings, reconciles departures, and clears stale discovery state across reconnect', async () => {
    const sdk = new FakeBeaconSdk()
    const receiver = new Study6PublicBeaconReceiver({ sdkFactory: () => asSdk(sdk) })
    const changed = vi.fn()
    receiver.addEventListener('targetschange', changed)
    await receiver.start()

    sdk.emit('listing', {
      list: Array.from({ length: 140 }, (_, index) => ({
        streamID: streamId(index + 1),
        UUID: `peer_${index + 1}`,
      })),
    })
    await microtask()
    expect(receiver.snapshot().targets).toHaveLength(STUDY6_PUBLIC_BEACON_MAX_TARGETS)
    expect(changed).toHaveBeenCalledTimes(1)

    sdk.emit('userLeft', { UUID: 'peer_1' })
    await microtask()
    expect(receiver.snapshot().targets.some(({ hint }) => hint.endsWith('0001'))).toBe(false)

    sdk.emit('listing', {
      list: [{ streamID: streamId(7), UUID: 'peer_7' }],
    })
    await microtask()
    expect(receiver.snapshot().targets).toEqual([{
      hint: '000000000000000000000007',
      label: 'Study 6 WebXR 00000000',
    }])

    sdk.emit('disconnected', { willReconnect: true })
    await microtask()
    expect(receiver.snapshot()).toMatchObject({ phase: 'reconnecting', targets: [] })
    sdk.emit('reconnected')
    expect(receiver.snapshot().phase).toBe('listening')
    sdk.emit('videoaddedtoroom', { streamID: streamId(99), uuid: 'peer_99' })
    await microtask()
    expect(receiver.snapshot().targets).toHaveLength(1)

    await receiver.stop()
    sdk.emit('videoaddedtoroom', { streamID: streamId(100), uuid: 'late_peer' })
    await microtask()
    expect(receiver.snapshot()).toMatchObject({ phase: 'idle', targets: [] })
  })
})

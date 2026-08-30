import { describe, expect, it, vi } from 'vitest'

import {
  deriveStudy6PublicBeaconIdentity,
  Study6PublicBeaconBroadcaster,
  Study6PublicBeaconReceiver,
} from './public-beacon.ts'
import type { VdoNinjaSdk } from './vdo-sdk.ts'

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

class LifecycleSdk extends EventTarget {
  readonly connect = vi.fn<() => Promise<void>>(async () => undefined)
  readonly joinRoom = vi.fn(async () => undefined)
  readonly announce = vi.fn(async ({ streamID }: { streamID: string }) => streamID)
  readonly publish = vi.fn(async () => 'unused')
  readonly view = vi.fn(async () => null)
  readonly sendData = vi.fn(() => true)
  readonly disconnect = vi.fn(async () => undefined)
}

function asSdk(sdk: LifecycleSdk): VdoNinjaSdk {
  return sdk as unknown as VdoNinjaSdk
}

describe('public beacon lifecycle generation fencing', () => {
  it('disconnects a broadcaster SDK whose delayed factory resolves after Stop', async () => {
    const sdk = new LifecycleSdk()
    const factory = deferred<VdoNinjaSdk>()
    const identity = await deriveStudy6PublicBeaconIdentity('s6xr_public_lifecycle_target_1')
    const broadcaster = new Study6PublicBeaconBroadcaster(identity, {
      sdkFactory: () => factory.promise,
    })
    const starting = broadcaster.start()
    await vi.waitFor(() => expect(broadcaster.snapshot().phase).toBe('connecting'))

    await broadcaster.stop()
    factory.resolve(asSdk(sdk))
    await starting

    expect(sdk.disconnect).toHaveBeenCalledTimes(1)
    expect(sdk.connect).not.toHaveBeenCalled()
    expect(sdk.joinRoom).not.toHaveBeenCalled()
    expect(sdk.announce).not.toHaveBeenCalled()
    expect(broadcaster.snapshot().phase).toBe('idle')
  })

  it('disconnects a receiver SDK whose delayed factory resolves after Stop', async () => {
    const sdk = new LifecycleSdk()
    const factory = deferred<VdoNinjaSdk>()
    const receiver = new Study6PublicBeaconReceiver({
      sdkFactory: () => factory.promise,
    })
    const starting = receiver.start()
    await vi.waitFor(() => expect(receiver.snapshot().phase).toBe('connecting'))

    await receiver.stop()
    factory.resolve(asSdk(sdk))
    await starting

    expect(sdk.disconnect).toHaveBeenCalledTimes(1)
    expect(sdk.connect).not.toHaveBeenCalled()
    expect(sdk.joinRoom).not.toHaveBeenCalled()
    expect(receiver.snapshot()).toMatchObject({ phase: 'idle', targets: [] })
  })

  it('does not join or announce when Stop wins an in-flight broadcaster connect', async () => {
    const sdk = new LifecycleSdk()
    const connecting = deferred<void>()
    sdk.connect.mockImplementation(() => connecting.promise)
    const identity = await deriveStudy6PublicBeaconIdentity('s6xr_public_lifecycle_target_2')
    const broadcaster = new Study6PublicBeaconBroadcaster(identity, {
      sdkFactory: () => asSdk(sdk),
    })
    const starting = broadcaster.start()
    await vi.waitFor(() => expect(sdk.connect).toHaveBeenCalledTimes(1))

    await broadcaster.stop()
    connecting.resolve()
    await starting

    expect(sdk.disconnect).toHaveBeenCalledTimes(1)
    expect(sdk.joinRoom).not.toHaveBeenCalled()
    expect(sdk.announce).not.toHaveBeenCalled()
    expect(broadcaster.snapshot().phase).toBe('idle')
  })
})

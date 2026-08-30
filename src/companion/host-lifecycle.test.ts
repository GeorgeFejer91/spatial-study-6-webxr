import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CompanionHost } from './host.ts'

interface FakeSdkRecord {
  connect: ReturnType<typeof vi.fn<() => Promise<void>>>
  joinRoom: ReturnType<typeof vi.fn<() => Promise<void>>>
  announce: ReturnType<typeof vi.fn<() => Promise<string>>>
  disconnect: ReturnType<typeof vi.fn<() => Promise<void>>>
}

const lifecycleHarness = vi.hoisted(() => ({
  loadPromise: Promise.resolve(undefined) as Promise<unknown>,
  resolveLoad: (_value: unknown): void => undefined,
  sdk: null as FakeSdkRecord | null,
}))

vi.mock('./vdo-sdk.ts', () => {
  class FakeSdk extends EventTarget {
    readonly connect = vi.fn(async () => undefined)
    readonly joinRoom = vi.fn(async () => undefined)
    readonly announce = vi.fn(async () => 'stream')
    readonly publish = vi.fn(async () => 'stream')
    readonly view = vi.fn(async () => null)
    readonly sendData = vi.fn(() => true)
    readonly disconnect = vi.fn(async () => undefined)
  }

  return {
    eventDetail: (event: Event) => (event as CustomEvent<unknown>).detail ?? {},
    loadVdoNinjaSdk: vi.fn(() => lifecycleHarness.loadPromise),
    createVdoSdk: vi.fn(() => {
      const sdk = new FakeSdk()
      lifecycleHarness.sdk = sdk
      return sdk
    }),
  }
})

beforeEach(() => {
  lifecycleHarness.sdk = null
  lifecycleHarness.loadPromise = new Promise<unknown>((resolve) => {
    lifecycleHarness.resolveLoad = resolve
  })
})

afterEach(() => {
  lifecycleHarness.resolveLoad(undefined)
})

describe('companion host generation fencing', () => {
  it('does not resurrect an SDK after Stop wins a delayed first SDK load', async () => {
    const host = new CompanionHost({
      getStatus: () => ({ remoteControlEnabled: true }) as never,
      handleCommand: vi.fn() as never,
    })
    const starting = host.start(document.createElement('canvas'))
    await vi.waitFor(() => expect(host.snapshot().phase).toBe('connecting'))

    await host.stop()
    expect(host.snapshot()).toMatchObject({ phase: 'idle', pairingUrl: null })
    lifecycleHarness.resolveLoad(class DelayedSdk {})
    await starting

    const staleSdk = lifecycleHarness.sdk
    await host.stop()

    expect(staleSdk).toBeNull()
    expect(host.snapshot()).toMatchObject({ phase: 'idle', pairingUrl: null })
  })
})

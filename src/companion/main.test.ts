import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createPairingDescriptor,
  encodePairingDescriptor,
  type PairingDescriptor,
} from './protocol.ts'
import {
  loadTrustedPairing,
  saveTrustedPairing,
} from './trusted-pairing.ts'
import { deriveStudy6PublicPairingDescriptor } from './public-beacon.ts'

const viewerHarness = vi.hoisted(() => ({
  connectDescriptors: [] as PairingDescriptor[],
  connectionStatesAtConnect: [] as string[],
  stopCalls: 0,
  mode: 'success' as 'success' | 'error',
}))

const beaconHarness = vi.hoisted(() => ({
  startCalls: 0,
  stopCalls: 0,
  receivers: [] as Array<{
    emitTargets: (targets: Array<{ hint: string; label: string }>) => void
  }>,
}))

vi.mock('./public-beacon.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./public-beacon.ts')>()

  interface MockBeaconSnapshot {
    phase: 'idle' | 'connecting' | 'listening' | 'reconnecting' | 'error'
    targets: Array<{ hint: string; label: string }>
    message: string
  }

  class Study6PublicBeaconReceiver extends EventTarget {
    private currentSnapshot: MockBeaconSnapshot = {
      phase: 'idle',
      targets: [],
      message: '',
    }

    constructor() {
      super()
      beaconHarness.receivers.push(this)
    }

    snapshot(): MockBeaconSnapshot {
      return {
        ...this.currentSnapshot,
        targets: this.currentSnapshot.targets.map((target) => ({ ...target })),
      }
    }

    async start(): Promise<MockBeaconSnapshot> {
      beaconHarness.startCalls += 1
      this.currentSnapshot = {
        phase: 'listening',
        targets: [],
        message: 'Public Study 6 target discovery is active.',
      }
      this.dispatchEvent(new CustomEvent('statechange', { detail: this.snapshot() }))
      return this.snapshot()
    }

    async stop(): Promise<void> {
      beaconHarness.stopCalls += 1
      this.currentSnapshot = { phase: 'idle', targets: [], message: '' }
      this.dispatchEvent(new CustomEvent('statechange', { detail: this.snapshot() }))
    }

    emitTargets(targets: Array<{ hint: string; label: string }>): void {
      this.currentSnapshot = {
        phase: 'listening',
        targets: targets.map((target) => ({ ...target })),
        message: 'Public Study 6 target discovery is active.',
      }
      this.dispatchEvent(new CustomEvent('targetschange', { detail: this.snapshot() }))
    }
  }

  return { ...actual, Study6PublicBeaconReceiver }
})

vi.mock('./viewer', () => {
  interface MockViewerSnapshot {
    phase: 'idle' | 'connecting' | 'connected' | 'error'
    message: string
    peerConnected: boolean
    controlProtocol: 'brsp/1'
    acceptedScopes: string[]
    stateStale: boolean
    commandGateBlocked: boolean
  }

  const idleSnapshot: MockViewerSnapshot = {
    phase: 'idle',
    message: '',
    peerConnected: false,
    controlProtocol: 'brsp/1' as const,
    acceptedScopes: [] as string[],
    stateStale: false,
    commandGateBlocked: true,
  }

  class CompanionViewer extends EventTarget {
    private readonly descriptor: PairingDescriptor
    private currentSnapshot: MockViewerSnapshot = idleSnapshot

    constructor(descriptor: PairingDescriptor) {
      super()
      this.descriptor = descriptor
    }

    snapshot() {
      return this.currentSnapshot
    }

    async connect(): Promise<void> {
      viewerHarness.connectDescriptors.push(this.descriptor)
      viewerHarness.connectionStatesAtConnect.push(
        document.querySelector<HTMLElement>('#connection-state')?.textContent ?? '',
      )
      if (viewerHarness.mode === 'error') {
        this.currentSnapshot = {
          ...idleSnapshot,
          phase: 'error',
          message: 'Headset target is offline.',
        }
        this.dispatchEvent(new CustomEvent('statechange', { detail: this.currentSnapshot }))
        throw new Error('Headset target is offline.')
      }
      this.currentSnapshot = {
        ...idleSnapshot,
        phase: 'connected',
        message: 'BRSP mutual proof verified.',
        peerConnected: true,
        acceptedScopes: ['study.status.read', 'study.experiment.control'],
      }
      this.dispatchEvent(new CustomEvent('statechange', { detail: this.currentSnapshot }))
    }

    async stop(): Promise<void> {
      viewerHarness.stopCalls += 1
      this.currentSnapshot = idleSnapshot
      this.dispatchEvent(new CustomEvent('statechange', { detail: this.currentSnapshot }))
    }

    async sendCommand(): Promise<string> {
      return 'command-test'
    }
  }

  return { CompanionViewer }
})

function installCompanionDom(): void {
  document.body.innerHTML = `
    <p id="pairing-summary"></p>
    <input id="pair-input" type="password" />
    <button id="apply-pair" type="button">Apply / replace</button>
    <button id="connect" type="button" disabled>Connect</button>
    <button id="disconnect" type="button" disabled>Cancel / disconnect</button>
    <button id="forget-pairing" type="button" disabled>Forget pairing</button>
    <p id="connection-state"></p>
    <span id="public-discovery-badge"></span>
    <p id="public-discovery-state"></p>
    <ul id="public-target-list"></ul>
    <section data-monitoring hidden></section>
    <video id="spectator-video"></video>
    <p id="video-placeholder"></p>
    <span id="route-badge"></span>
    <p id="command-result"></p>
    <button data-command="request_status" type="button" disabled></button>
    <select id="setup-variant"><option value="DHS">DHS</option><option value="SHD">SHD</option></select>
    <select id="setup-language"><option value="en">en</option><option value="de">de</option></select>
    <select id="setup-timing"><option value="full">full</option><option value="clipped">clipped</option></select>
    <button id="apply-configuration" type="button" disabled></button>
    <input id="participant-id" />
    <button id="start-participant" type="button" disabled></button>
    <span id="participant-hint"></span>
    <span data-field="scopes"></span>
  `
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

function emitPublicTargets(targets: Array<{ hint: string; label: string }>): void {
  const receiver = beaconHarness.receivers[0]
  if (!receiver) throw new Error('Expected the public beacon receiver to be constructed.')
  receiver.emitTargets(targets)
}

beforeEach(() => {
  vi.resetModules()
  vi.useRealTimers()
  viewerHarness.connectDescriptors.length = 0
  viewerHarness.connectionStatesAtConnect.length = 0
  viewerHarness.stopCalls = 0
  viewerHarness.mode = 'success'
  beaconHarness.startCalls = 0
  beaconHarness.stopCalls = 0
  beaconHarness.receivers.length = 0
  localStorage.clear()
  history.replaceState(null, '', '/spatial-study-6-webxr/companion.html')
  installCompanionDom()
})

afterEach(async () => {
  window.dispatchEvent(new Event('pagehide'))
  await flushMicrotasks()
  vi.useRealTimers()
  localStorage.clear()
  document.body.replaceChildren()
})

describe('companion trusted-link bootstrap', () => {
  it('scrubs, saves, and auto-connects a valid fragment without printing its secret', async () => {
    const descriptor = createPairingDescriptor(false, undefined, false)
    const invitation = encodePairingDescriptor(descriptor)
    history.replaceState(
      null,
      '',
      `/spatial-study-6-webxr/companion.html#pair=${invitation}`,
    )

    await import('./main.ts')
    await vi.waitFor(() => expect(viewerHarness.connectDescriptors).toHaveLength(1))

    expect(location.hash).toBe('')
    expect(viewerHarness.connectDescriptors[0]).toEqual(descriptor)
    expect(loadTrustedPairing()).toEqual(descriptor)
    expect(viewerHarness.connectionStatesAtConnect[0]).toContain('Connecting automatically')
    expect(document.body.textContent).not.toContain(descriptor.key)
    expect(document.querySelector<HTMLInputElement>('#pair-input')?.value).toBe('')
  })

  it('auto-connects a remembered pairing from the bare GitHub Pages route', async () => {
    const descriptor = createPairingDescriptor(true)
    expect(saveTrustedPairing(descriptor)).toBe(true)

    await import('./main.ts')
    await vi.waitFor(() => expect(viewerHarness.connectDescriptors).toEqual([descriptor]))

    expect(location.hash).toBe('')
    expect(document.querySelector<HTMLButtonElement>('#forget-pairing')?.disabled).toBe(false)
    expect(document.body.textContent).not.toContain(descriptor.key)
  })

  it('starts public discovery on a bare visit and auto-connects the first listed headset', async () => {
    const target = {
      hint: '0123456789abcdef01234567',
      label: 'Study 6 WebXR 01234567',
    }
    const expectedDescriptor = await deriveStudy6PublicPairingDescriptor(target.hint)

    await import('./main.ts')
    expect(beaconHarness.startCalls).toBe(1)
    expect(document.querySelector('#public-discovery-badge')?.textContent).toBe('Listening')

    emitPublicTargets([target])
    await vi.waitFor(() => expect(viewerHarness.connectDescriptors).toEqual([expectedDescriptor]))

    expect(loadTrustedPairing()).toBeNull()
    expect(document.querySelector('#public-discovery-badge')?.textContent).toBe('Connected')
    expect(document.querySelector('#public-discovery-state')?.textContent).toContain('BRSP connected')
    expect(document.querySelector('#public-target-list')?.textContent).toContain('connected')
    expect(document.querySelector('#pairing-summary')?.textContent).toContain('open prototype')
    expect(document.body.textContent).not.toContain(expectedDescriptor.key)
  })

  it('selects the lowest public hint deterministically when several headsets are listed', async () => {
    const higher = {
      hint: 'ffffffffffffffffffffffff',
      label: 'Study 6 WebXR FFFFFFFF',
    }
    const lower = {
      hint: '000000000000000000000001',
      label: 'Study 6 WebXR 00000000',
    }
    const expectedDescriptor = await deriveStudy6PublicPairingDescriptor(lower.hint)

    await import('./main.ts')
    emitPublicTargets([higher, lower])
    await vi.waitFor(() => expect(viewerHarness.connectDescriptors).toEqual([expectedDescriptor]))

    const listed = Array.from(document.querySelectorAll('#public-target-list li'))
      .map((item) => item.textContent)
    expect(listed[0]).toContain(lower.label)
    expect(listed[1]).toContain(higher.label)
  })

  it('replaces an unmatched stale saved descriptor with the first online public target', async () => {
    const stale = createPairingDescriptor()
    expect(saveTrustedPairing(stale)).toBe(true)
    const target = {
      hint: '111111111111111111111111',
      label: 'Study 6 WebXR 11111111',
    }
    const expectedDescriptor = await deriveStudy6PublicPairingDescriptor(target.hint)

    await import('./main.ts')
    await vi.waitFor(() => expect(viewerHarness.connectDescriptors).toEqual([stale]))
    emitPublicTargets([target])
    await vi.waitFor(() => expect(viewerHarness.connectDescriptors).toEqual([stale, expectedDescriptor]))

    expect(loadTrustedPairing()).toBeNull()
    expect(document.querySelector('#public-discovery-state')?.textContent).toContain('BRSP connected')
  })

  it('keeps Cancel authoritative over later public listings until reload', async () => {
    const first = {
      hint: '222222222222222222222222',
      label: 'Study 6 WebXR 22222222',
    }
    const second = {
      hint: '333333333333333333333333',
      label: 'Study 6 WebXR 33333333',
    }

    await import('./main.ts')
    emitPublicTargets([first])
    await vi.waitFor(() => expect(viewerHarness.connectDescriptors).toHaveLength(1))
    document.querySelector<HTMLButtonElement>('#disconnect')!.click()
    await vi.waitFor(() => {
      expect(document.querySelector('#connection-state')?.textContent).toContain('until reload')
    })

    emitPublicTargets([second])
    await flushMicrotasks()
    expect(viewerHarness.connectDescriptors).toHaveLength(1)
    expect(document.querySelector('#public-discovery-badge')?.textContent).toBe('Canceled')
    expect(document.querySelector('#public-discovery-state')?.textContent).toContain('Reload or select Connect')

    document.querySelector<HTMLButtonElement>('#connect')!.click()
    await vi.waitFor(() => expect(viewerHarness.connectDescriptors).toHaveLength(2))
    expect(document.querySelector('#public-discovery-badge')?.textContent).toBe('Connected')
  })

  it('keeps an invalid fragment offline and exposes the manual replacement fallback', async () => {
    history.replaceState(
      null,
      '',
      '/spatial-study-6-webxr/companion.html#pair=invalid-private-value',
    )

    await import('./main.ts')
    await flushMicrotasks()

    expect(location.hash).toBe('')
    expect(viewerHarness.connectDescriptors).toHaveLength(0)
    expect(document.querySelector('#pairing-summary')?.textContent).toContain('missing or invalid')
    expect(document.body.textContent).not.toContain('invalid-private-value')
    expect(document.querySelector<HTMLInputElement>('#pair-input')?.disabled).toBe(false)
  })

  it('uses Apply / replace as a one-action manual save and connection fallback', async () => {
    const descriptor = createPairingDescriptor()
    await import('./main.ts')
    const input = document.querySelector<HTMLInputElement>('#pair-input')!
    input.value = `https://example.invalid/companion.html#pair=${encodePairingDescriptor(descriptor)}`

    document.querySelector<HTMLButtonElement>('#apply-pair')!.click()
    await vi.waitFor(() => expect(viewerHarness.connectDescriptors).toEqual([descriptor]))

    expect(input.value).toBe('')
    expect(loadTrustedPairing()).toEqual(descriptor)
    expect(document.body.textContent).not.toContain(descriptor.key)
  })

  it('forgets the saved credential before stopping the active peer', async () => {
    const descriptor = createPairingDescriptor()
    expect(saveTrustedPairing(descriptor)).toBe(true)
    await import('./main.ts')
    await vi.waitFor(() => expect(viewerHarness.connectDescriptors).toHaveLength(1))

    document.querySelector<HTMLButtonElement>('#forget-pairing')!.click()
    await vi.waitFor(() => {
      expect(loadTrustedPairing()).toBeNull()
      expect(document.querySelector('#connection-state')?.textContent).toContain(
        'saved credential was removed',
      )
    })

    expect(document.querySelector<HTMLButtonElement>('#connect')?.disabled).toBe(true)
  })

  it('retries an offline target with capped backoff and cancels without another attempt', async () => {
    vi.useFakeTimers()
    viewerHarness.mode = 'error'
    const descriptor = createPairingDescriptor()
    expect(saveTrustedPairing(descriptor)).toBe(true)

    await import('./main.ts')
    await flushMicrotasks()
    expect(viewerHarness.connectDescriptors).toHaveLength(1)
    const delays = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 30_000]
    for (const [index, delayMs] of delays.entries()) {
      expect(document.querySelector('#connection-state')?.textContent).toContain(
        `Retrying automatically in ${delayMs / 1_000} s`,
      )
      await vi.advanceTimersByTimeAsync(delayMs)
      await flushMicrotasks()
      expect(viewerHarness.connectDescriptors).toHaveLength(index + 2)
    }

    document.querySelector<HTMLButtonElement>('#disconnect')!.click()
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(viewerHarness.connectDescriptors).toHaveLength(delays.length + 1)
    expect(document.querySelector('#connection-state')?.textContent).toContain('Disconnected')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createPairingDescriptor,
  type PairingDescriptor,
} from '../companion/protocol.ts'
import {
  loadTrustedPairing,
  saveTrustedPairing,
} from '../companion/trusted-pairing.ts'
import { CompanionControls } from './companion-controls.ts'

interface HostSnapshot {
  phase: 'idle' | 'connecting' | 'broadcasting' | 'error'
  viewerCount: number
  pairingUrl: string | null
  message: string
  controlProtocol: 'brsp/1'
  acceptedScopes: string[]
}

interface StartCall {
  canvas: HTMLCanvasElement
  forceTurn: boolean
  descriptor: PairingDescriptor
  remoteControlEnabled: boolean | undefined
}

interface HostOptions {
  getStatus: () => { remoteControlEnabled?: boolean }
}

type StartBehavior = (call: StartCall) => Promise<HostSnapshot>
type StopBehavior = () => Promise<void>

interface PublicIdentity {
  hint: string
  label: string
  announcementStreamId: string
}

const hostHarness = vi.hoisted(() => ({
  instances: [] as Array<EventTarget & {
    emit(snapshot: HostSnapshot): void
  }>,
  starts: [] as StartCall[],
  startBehaviors: [] as StartBehavior[],
  stopBehaviors: [] as StopBehavior[],
  stopCalls: 0,
  events: [] as string[],
}))

vi.mock('../companion/host.ts', () => {
  class CompanionHost extends EventTarget {
    private readonly options: HostOptions

    constructor(options: HostOptions) {
      super()
      this.options = options
      hostHarness.events.push('host:constructed')
      hostHarness.instances.push(this)
    }

    async start(
      canvas: HTMLCanvasElement,
      forceTurn: boolean,
      descriptor: PairingDescriptor,
    ): Promise<HostSnapshot> {
      const call = {
        canvas,
        forceTurn,
        descriptor: structuredClone(descriptor),
        remoteControlEnabled: this.options.getStatus().remoteControlEnabled,
      }
      hostHarness.starts.push(call)
      hostHarness.events.push('host:start')
      const behavior = hostHarness.startBehaviors.shift()
      if (behavior) return behavior(call)
      const snapshot = broadcastingSnapshot(descriptor)
      this.emit(snapshot)
      return snapshot
    }

    async stop(): Promise<void> {
      hostHarness.stopCalls += 1
      hostHarness.events.push('host:stop')
      await hostHarness.stopBehaviors.shift()?.()
    }

    emit(snapshot: HostSnapshot): void {
      this.dispatchEvent(new CustomEvent('statechange', { detail: snapshot }))
    }
  }

  return { CompanionHost }
})

const publicHarness = vi.hoisted(() => ({
  identities: [] as PublicIdentity[],
  descriptorHints: [] as string[],
  startCalls: [] as PublicIdentity[],
  stopCalls: 0,
}))

vi.mock('../companion/public-beacon.ts', () => {
  class Study6PublicBeaconBroadcaster extends EventTarget {
    private readonly identity: PublicIdentity

    constructor(identity: PublicIdentity) {
      super()
      this.identity = structuredClone(identity)
      publicHarness.identities.push(this.identity)
    }

    async start(): Promise<void> {
      publicHarness.startCalls.push(this.identity)
      hostHarness.events.push('public:start')
    }

    async stop(): Promise<void> {
      publicHarness.stopCalls += 1
      hostHarness.events.push('public:stop')
    }
  }

  return {
    deriveStudy6PublicBeaconIdentity: vi.fn(async (sourceHint: string) => (
      mockPublicIdentity(sourceHint)
    )),
    deriveStudy6PublicPairingDescriptor: vi.fn(async (hint: string) => {
      publicHarness.descriptorHints.push(hint)
      return mockPublicDescriptor(hint)
    }),
    Study6PublicBeaconBroadcaster,
  }
})

const qrHarness = vi.hoisted(() => ({
  values: [] as string[],
  behaviors: [] as Array<(value: string) => Promise<string>>,
}))

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn(async (value: string) => {
      qrHarness.values.push(value)
      const behavior = qrHarness.behaviors.shift()
      if (behavior) return behavior(value)
      return 'data:image/png;base64,dHJ1c3RlZC1wYWlyaW5n'
    }),
  },
}))

function broadcastingSnapshot(descriptor: PairingDescriptor): HostSnapshot {
  return {
    phase: 'broadcasting',
    viewerCount: 0,
    pairingUrl: `https://study.example/companion.html#pair=${descriptor.key}`,
    message: 'Pairing is ready; waiting for one authenticated BRSP controller.',
    controlProtocol: 'brsp/1',
    acceptedScopes: [],
  }
}

function mockPublicIdentity(sourceHint: string): PublicIdentity {
  const hint = sourceHint.slice(-24).padStart(24, '0')
  return {
    hint,
    label: `Study 6 WebXR ${hint.slice(0, 8).toUpperCase()}`,
    announcementStreamId: `s6_beacon_${hint}`,
  }
}

function mockPublicDescriptor(hint: string): PairingDescriptor {
  const expanded = `${hint}${hint}`
  return {
    version: 2,
    controlProtocol: 'brsp/1',
    room: `s6pub_room_${expanded.slice(0, 32)}`,
    streamId: `s6pub_target_${expanded.slice(4, 36)}`,
    key: expanded.slice(0, 43),
    forceTurn: false,
    spectatorMedia: false,
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
} {
  let resolvePromise: (value: T) => void = () => undefined
  let rejectPromise: (error: unknown) => void = () => undefined
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}

interface CreatedControls {
  controls: CompanionControls
  canvas: HTMLCanvasElement
  enabled: boolean[]
  dialog: HTMLDialogElement
}

const createdControls: CompanionControls[] = []

function createControls(): CreatedControls {
  let remoteControlEnabled = false
  const enabled: boolean[] = []
  const canvas = document.createElement('canvas')
  const slot = document.createElement('div')
  document.body.append(slot)
  const controls = new CompanionControls({
    slot,
    canvas,
    getStatus: () => ({ remoteControlEnabled }) as never,
    handleCommand: vi.fn() as never,
    onControlEnabledChange: (value) => {
      remoteControlEnabled = value
      enabled.push(value)
      hostHarness.events.push(`control:${String(value)}`)
    },
  })
  createdControls.push(controls)
  return {
    controls,
    canvas,
    enabled,
    dialog: Reflect.get(controls, 'dialog') as HTMLDialogElement,
  }
}

function actionButton(dialog: HTMLDialogElement, label: string): HTMLButtonElement {
  const result = Array.from(dialog.querySelectorAll<HTMLButtonElement>('[data-actions] button'))
    .find((candidate) => candidate.textContent === label)
  if (!result) throw new Error(`Missing action button: ${label}`)
  return result
}

beforeEach(() => {
  vi.useRealTimers()
  hostHarness.instances.length = 0
  hostHarness.starts.length = 0
  hostHarness.startBehaviors.length = 0
  hostHarness.stopBehaviors.length = 0
  hostHarness.stopCalls = 0
  hostHarness.events.length = 0
  qrHarness.values.length = 0
  qrHarness.behaviors.length = 0
  publicHarness.identities.length = 0
  publicHarness.descriptorHints.length = 0
  publicHarness.startCalls.length = 0
  publicHarness.stopCalls = 0
  localStorage.clear()
  document.body.replaceChildren()
})

afterEach(async () => {
  for (const controls of createdControls.splice(0)) controls.destroy()
  window.dispatchEvent(new Event('pagehide'))
  await flushMicrotasks()
  vi.useRealTimers()
  vi.restoreAllMocks()
  localStorage.clear()
  document.body.replaceChildren()
})

describe('zero-interruption public companion target', () => {
  it('enables full control before automatically starting the host without opening the dialog', async () => {
    const { dialog, enabled } = createControls()

    expect(enabled).toEqual([true])
    await vi.waitFor(() => expect(hostHarness.starts).toHaveLength(1))

    expect(hostHarness.events.slice(0, 3)).toEqual([
      'control:true',
      'host:constructed',
      'host:start',
    ])
    expect(hostHarness.starts[0]).toMatchObject({ remoteControlEnabled: true })
    expect(dialog.open).toBe(false)
    expect(dialog.hasAttribute('open')).toBe(false)
  })

  it('reuses the stored target seed and exact derived public descriptor on resume', async () => {
    const seed = createPairingDescriptor(true, undefined, false)
    expect(saveTrustedPairing(seed)).toBe(true)
    const { dialog } = createControls()

    await vi.waitFor(() => expect(hostHarness.starts).toHaveLength(1))
    const expectedPublic = mockPublicDescriptor(mockPublicIdentity(seed.streamId).hint)
    expect(hostHarness.starts[0]).toMatchObject({
      forceTurn: false,
      descriptor: expectedPublic,
    })
    expect(publicHarness.startCalls).toHaveLength(1)
    expect(hostHarness.events.indexOf('public:start')).toBeGreaterThan(
      hostHarness.events.indexOf('host:start'),
    )

    actionButton(dialog, 'Pause automatic pairing').click()
    await vi.waitFor(() => {
      expect(actionButton(dialog, 'Resume automatic pairing').disabled).toBe(false)
    })
    actionButton(dialog, 'Resume automatic pairing').click()
    await vi.waitFor(() => expect(hostHarness.starts).toHaveLength(2))

    expect(hostHarness.starts[1]?.descriptor).toEqual(expectedPublic)
    expect(loadTrustedPairing()).toEqual(seed)
    expect(publicHarness.startCalls).toHaveLength(2)
  })

  it('keeps the public link and stored identity seed while Pause stops both planes', async () => {
    const { dialog, enabled } = createControls()
    await vi.waitFor(() => expect(hostHarness.starts).toHaveLength(1))
    const publicDescriptor = hostHarness.starts[0]!.descriptor
    const seed = loadTrustedPairing()
    const link = dialog.querySelector<HTMLTextAreaElement>('[data-link]')!
    await vi.waitFor(() => expect(link.value).toContain(publicDescriptor.key))

    const stopping = deferred<void>()
    hostHarness.stopBehaviors.push(() => stopping.promise)
    actionButton(dialog, 'Pause automatic pairing').click()

    expect(link.value).toContain(publicDescriptor.key)
    expect(loadTrustedPairing()).toEqual(seed)
    expect(enabled.at(-1)).toBe(false)
    expect(publicHarness.stopCalls).toBeGreaterThanOrEqual(1)
    stopping.resolve()
    await vi.waitFor(() => {
      expect(actionButton(dialog, 'Resume automatic pairing').disabled).toBe(false)
    })
  })

  it('projects incoming state and late post-destroy state without opening/focusing UI or touching XR', async () => {
    const { controls, canvas, dialog } = createControls()
    await vi.waitFor(() => expect(hostHarness.instances).toHaveLength(1))

    const showModal = vi.fn()
    Object.defineProperty(dialog, 'showModal', { configurable: true, value: showModal })
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const requestFullscreen = vi.fn()
    Object.defineProperty(canvas, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    })
    const requestSession = vi.fn()
    const previousXr = Object.getOwnPropertyDescriptor(navigator, 'xr')
    Object.defineProperty(navigator, 'xr', {
      configurable: true,
      value: { requestSession },
    })
    const focusedBefore = document.activeElement
    const host = hostHarness.instances[0]!
    const incoming: HostSnapshot = {
      phase: 'broadcasting',
      viewerCount: 1,
      pairingUrl: null,
      message: 'BRSP mutual proof verified.',
      controlProtocol: 'brsp/1',
      acceptedScopes: ['study.experiment.control'],
    }

    host.emit(incoming)
    controls.destroy()
    host.emit(incoming)

    expect(dialog.isConnected).toBe(false)
    expect(dialog.open).toBe(false)
    expect(showModal).not.toHaveBeenCalled()
    expect(focus).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(focusedBefore)
    expect(requestFullscreen).not.toHaveBeenCalled()
    expect(requestSession).not.toHaveBeenCalled()

    if (previousXr) Object.defineProperty(navigator, 'xr', previousXr)
    else Reflect.deleteProperty(navigator, 'xr')
  })

  it('cancels scheduled retries while paused and resumes automatic hosting explicitly', async () => {
    const { dialog, enabled } = createControls()
    await vi.waitFor(() => expect(hostHarness.starts).toHaveLength(1))
    actionButton(dialog, 'Pause automatic pairing').click()
    await vi.waitFor(() => {
      expect(actionButton(dialog, 'Resume automatic pairing').disabled).toBe(false)
    })
    hostHarness.startBehaviors.push(async () => {
      throw new Error('temporary signaling outage')
    })
    vi.useFakeTimers()
    actionButton(dialog, 'Resume automatic pairing').click()
    await vi.advanceTimersByTimeAsync(0)
    await flushMicrotasks()

    expect(hostHarness.starts).toHaveLength(2)
    expect(dialog.querySelector<HTMLElement>('[data-state]')?.textContent).toContain(
      'retrying automatically in 1 s',
    )
    actionButton(dialog, 'Pause automatic pairing').click()
    await flushMicrotasks()
    expect(enabled.at(-1)).toBe(false)
    expect(hostHarness.stopCalls).toBeGreaterThanOrEqual(1)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(hostHarness.starts).toHaveLength(2)

    actionButton(dialog, 'Resume automatic pairing').click()
    await vi.advanceTimersByTimeAsync(0)
    await flushMicrotasks()
    expect(hostHarness.starts).toHaveLength(3)
    expect(enabled.at(-1)).toBe(true)
  })

  it('clears the old public link and seed before Rotate waits for signaling shutdown', async () => {
    const { dialog } = createControls()
    await vi.waitFor(() => expect(hostHarness.starts).toHaveLength(1))
    const oldDescriptor = hostHarness.starts[0]!.descriptor
    const oldSeed = loadTrustedPairing()
    const link = dialog.querySelector<HTMLTextAreaElement>('[data-link]')!
    const qr = dialog.querySelector<HTMLImageElement>('[data-qr]')!
    const pair = dialog.querySelector<HTMLElement>('[data-pair]')!
    await vi.waitFor(() => expect(link.value).toContain(oldDescriptor.key))
    expect(qr.hasAttribute('src')).toBe(true)
    expect(pair.hidden).toBe(false)

    const stopping = deferred<void>()
    hostHarness.stopBehaviors.push(() => stopping.promise)
    actionButton(dialog, 'Rotate public identity').click()

    expect(link.value).toBe('')
    expect(qr.hasAttribute('src')).toBe(false)
    expect(pair.hidden).toBe(true)
    expect(loadTrustedPairing()).toBeNull()

    stopping.resolve()
    await vi.waitFor(() => expect(hostHarness.starts).toHaveLength(2))
    const replacement = hostHarness.starts[1]!.descriptor
    expect(replacement.key).not.toBe(oldDescriptor.key)
    expect(replacement.room).not.toBe(oldDescriptor.room)
    expect(replacement.streamId).not.toBe(oldDescriptor.streamId)
    const replacementSeed = loadTrustedPairing()
    expect(replacementSeed).not.toBeNull()
    expect(replacementSeed).not.toEqual(oldSeed)
    expect(replacement).toEqual(mockPublicDescriptor(
      mockPublicIdentity(replacementSeed!.streamId).hint,
    ))
  })

  it('fences an old async start so it cannot publish its link after rotation', async () => {
    const oldStart = deferred<HostSnapshot>()
    const newStart = deferred<HostSnapshot>()
    hostHarness.startBehaviors.push(
      () => oldStart.promise,
      () => newStart.promise,
    )
    const { controls, dialog } = createControls()
    await vi.waitFor(() => expect(hostHarness.starts).toHaveLength(1))
    const oldDescriptor = hostHarness.starts[0]!.descriptor

    void (Reflect.get(controls, 'rotate') as () => Promise<void>).call(controls)
    await flushMicrotasks()
    expect(hostHarness.starts).toHaveLength(1)

    oldStart.resolve(broadcastingSnapshot(oldDescriptor))
    await vi.waitFor(() => expect(hostHarness.starts).toHaveLength(2))
    const replacement = hostHarness.starts[1]!.descriptor
    const link = dialog.querySelector<HTMLTextAreaElement>('[data-link]')!
    expect(link.value).not.toContain(oldDescriptor.key)

    newStart.resolve(broadcastingSnapshot(replacement))
    await vi.waitFor(() => expect(link.value).toContain(replacement.key))
    expect(link.value).not.toContain(oldDescriptor.key)
    expect(hostHarness.stopCalls).toBeGreaterThanOrEqual(2)
  })

  it('does not restore a revoked QR when an old QR render completes after rotation', async () => {
    const oldQr = deferred<string>()
    const replacementStart = deferred<HostSnapshot>()
    hostHarness.startBehaviors.push(
      async (call) => broadcastingSnapshot(call.descriptor),
      () => replacementStart.promise,
    )
    qrHarness.behaviors.push(() => oldQr.promise)
    const { controls, dialog } = createControls()
    await vi.waitFor(() => expect(qrHarness.values).toHaveLength(1))
    const oldDescriptor = hostHarness.starts[0]!.descriptor
    const qr = dialog.querySelector<HTMLImageElement>('[data-qr]')!
    const pair = dialog.querySelector<HTMLElement>('[data-pair]')!

    void (Reflect.get(controls, 'rotate') as () => Promise<void>).call(controls)
    expect(qr.hasAttribute('src')).toBe(false)
    expect(pair.hidden).toBe(true)

    oldQr.resolve(`data:image/png;base64,revoked-${oldDescriptor.key}`)
    await vi.waitFor(() => expect(hostHarness.starts).toHaveLength(2))
    const staleQr = qr.getAttribute('src')
    const stalePairVisible = !pair.hidden

    replacementStart.resolve(broadcastingSnapshot(hostHarness.starts[1]!.descriptor))
    await flushMicrotasks()
    expect(staleQr).toBeNull()
    expect(stalePairVisible).toBe(false)
  })

  it('never writes either the active or rotated bearer secret to console output', async () => {
    const consoleSpies = [
      vi.spyOn(console, 'debug').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
    ]
    const { dialog } = createControls()
    await vi.waitFor(() => expect(hostHarness.starts).toHaveLength(1))
    const firstKey = hostHarness.starts[0]!.descriptor.key
    const firstSeedKey = loadTrustedPairing()!.key
    actionButton(dialog, 'Rotate public identity').click()
    await vi.waitFor(() => expect(hostHarness.starts).toHaveLength(2))
    const secondKey = hostHarness.starts[1]!.descriptor.key
    const secondSeedKey = loadTrustedPairing()!.key

    const renderedLog = consoleSpies
      .flatMap((spy) => spy.mock.calls)
      .map((args) => args.map((value) => {
        try {
          return typeof value === 'string' ? value : JSON.stringify(value)
        } catch {
          return String(value)
        }
      }).join(' '))
      .join('\n')
    expect(renderedLog).not.toContain(firstKey)
    expect(renderedLog).not.toContain(secondKey)
    expect(renderedLog).not.toContain(firstSeedKey)
    expect(renderedLog).not.toContain(secondSeedKey)
  })
})

import type {
  CompanionHost,
  CompanionHostSnapshot,
  CommandDecision,
} from '../companion/host.ts'
import {
  createPairingDescriptor,
  type CompanionStatus,
  type PairingDescriptor,
  type RemoteMutationCommandRequest,
} from '../companion/protocol.ts'
import {
  deriveStudy6PublicBeaconIdentity,
  deriveStudy6PublicPairingDescriptor,
  Study6PublicBeaconBroadcaster,
} from '../companion/public-beacon.ts'
import {
  forgetTrustedPairing,
  loadTrustedPairing,
  saveTrustedPairing,
} from '../companion/trusted-pairing.ts'

export interface CompanionControlsOptions {
  slot: HTMLElement
  canvas: HTMLCanvasElement
  getStatus: () => CompanionStatus
  handleCommand: (
    request: RemoteMutationCommandRequest,
    expectedRevision: number,
  ) => CommandDecision | Promise<CommandDecision>
  onControlEnabledChange?: (enabled: boolean) => void
}

const HOST_RETRY_DELAYS_MS = [1_000, 3_000, 10_000, 30_000] as const

function button(label: string, className = 'study6-shell__button'): HTMLButtonElement {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = className
  element.textContent = label
  return element
}

function usableTrustedDescriptor(value: PairingDescriptor | null): PairingDescriptor | null {
  return value?.spectatorMedia === false ? value : null
}

/**
 * The WebXR page continuously hosts one public, data-only BRSP beacon. Any
 * companion visitor can derive its connection transcript key from the public
 * beacon handle; no dialog is opened and immersive presentation is untouched.
 */
export class CompanionControls {
  private readonly options: CompanionControlsOptions
  private readonly enableButton: HTMLButtonElement
  private readonly dialog: HTMLDialogElement
  private readonly state: HTMLElement
  private readonly qr: HTMLImageElement
  private readonly link: HTMLTextAreaElement
  private readonly startButton: HTMLButtonElement
  private readonly stopButton: HTMLButtonElement
  private readonly rotateButton: HTMLButtonElement
  private host: CompanionHost | null = null
  /** Random persisted seed; its key is never used for the public control plane. */
  private beaconSeedDescriptor: PairingDescriptor
  private publicBeacon: Study6PublicBeaconBroadcaster | null = null
  private startInFlight: Promise<void> | null = null
  private retryTimer: number | undefined
  private retryAttempt = 0
  private lifecycleGeneration = 0
  private operatorStopped = false
  private stopping = false
  private destroyed = false

  constructor(options: CompanionControlsOptions) {
    this.options = options
    const stored = usableTrustedDescriptor(loadTrustedPairing())
    if (!stored) forgetTrustedPairing()
    this.beaconSeedDescriptor = stored ?? createPairingDescriptor(false, undefined, false)
    const persisted = saveTrustedPairing(this.beaconSeedDescriptor)

    this.enableButton = button('Companion · starting')
    this.enableButton.title = 'Show public full-operator beacon and connection status'
    options.slot.append(this.enableButton)

    this.dialog = document.createElement('dialog')
    this.dialog.className = 'study6-companion-dialog'
    this.dialog.innerHTML = `
      <div class="study6-companion-dialog__heading">
        <div><span>PUBLIC BROWSER BEACON</span><h2>Browser companion</h2></div>
        <button type="button" data-close aria-label="Close">×</button>
      </div>
      <p>The data-only BRSP host and public discovery beacon start automatically and remain available while WebXR is immersive. Visiting the public companion website discovers this headset and connects without another headset prompt.</p>
      <p><strong>Full bounded operator access is enabled.</strong> This grants every defined Study 6 operator scope, but never arbitrary scripts, questionnaire answers, consent, raw ECG transfer, record deletion, or immersive-VR admission.</p>
      <div class="study6-companion-dialog__actions" data-actions></div>
      <p class="study6-companion-dialog__state" data-state role="status">Starting the public browser beacon…</p>
      <div class="study6-companion-dialog__pair" data-pair hidden>
        <img data-qr alt="Public full-operator companion QR code" />
        <div>
          <label for="study6-companion-link">Direct public operator link</label>
          <textarea id="study6-companion-link" data-link readonly rows="5"></textarea>
          <button type="button" data-copy>Copy direct link</button>
          <p>${persisted
            ? 'This public target identity is remembered on this headset browser until Rotate is selected.'
            : 'Browser storage is unavailable; this public target identity lasts only for the current page.'}</p>
          <p>This prototype intentionally permits any visitor to the public companion page to request the full bounded operator profile. Rotate to publish a new public target identity.</p>
        </div>
      </div>
    `
    document.body.append(this.dialog)

    this.state = this.dialog.querySelector<HTMLElement>('[data-state]')!
    this.qr = this.dialog.querySelector<HTMLImageElement>('[data-qr]')!
    this.link = this.dialog.querySelector<HTMLTextAreaElement>('[data-link]')!
    const actionSlot = this.dialog.querySelector<HTMLElement>('[data-actions]')!
    this.startButton = button('Resume automatic pairing', 'study6-companion-dialog__primary')
    this.stopButton = button('Pause automatic pairing')
    this.rotateButton = button('Rotate public identity')
    this.startButton.disabled = true
    actionSlot.append(this.startButton, this.stopButton, this.rotateButton)

    this.enableButton.addEventListener('click', () => this.dialog.showModal())
    this.dialog.querySelector<HTMLButtonElement>('[data-close]')!.addEventListener('click', () => this.dialog.close())
    this.startButton.addEventListener('click', () => this.resume())
    this.stopButton.addEventListener('click', () => void this.pause())
    this.rotateButton.addEventListener('click', () => void this.rotate())
    this.dialog.querySelector<HTMLButtonElement>('[data-copy]')!.addEventListener('click', () => void this.copyLink())
    window.addEventListener('pagehide', () => void this.shutdown(), { once: true })

    options.onControlEnabledChange?.(true)
    void this.start()
  }

  async stop(): Promise<void> {
    await this.pause()
  }

  destroy(): void {
    this.destroyed = true
    void this.shutdown()
    this.enableButton.remove()
    this.dialog.remove()
  }

  private resume(): void {
    if (this.destroyed || this.stopping) return
    this.operatorStopped = false
    this.options.onControlEnabledChange?.(true)
    void this.start()
  }

  private async pause(): Promise<void> {
    this.operatorStopped = true
    this.stopping = true
    this.lifecycleGeneration += 1
    this.clearRetry()
    this.options.onControlEnabledChange?.(false)
    this.startButton.disabled = true
    this.stopButton.disabled = true
    this.enableButton.textContent = 'Companion · paused'
    const pending = this.startInFlight
    const publicBeacon = this.publicBeacon
    this.publicBeacon = null
    await Promise.all([
      this.host?.stop(),
      publicBeacon?.stop(),
      pending?.catch(() => undefined),
    ])
    this.stopping = false
    if (this.destroyed) return
    this.startButton.disabled = false
    this.state.textContent = 'Automatic pairing is paused. The experiment and ECG acquisition continue locally.'
  }

  private async rotate(): Promise<void> {
    if (this.destroyed) return
    this.operatorStopped = true
    this.stopping = true
    this.lifecycleGeneration += 1
    this.clearRetry()
    this.options.onControlEnabledChange?.(false)
    this.startButton.disabled = true
    this.stopButton.disabled = true
    this.rotateButton.disabled = true
    this.enableButton.textContent = 'Companion · rotating'
    this.state.textContent = 'The old public target identity is removed. Closing its connection…'
    this.link.value = ''
    this.qr.removeAttribute('src')
    this.dialog.querySelector<HTMLElement>('[data-pair]')!.hidden = true
    forgetTrustedPairing()
    const pending = this.startInFlight
    const publicBeacon = this.publicBeacon
    this.publicBeacon = null
    await Promise.all([
      this.host?.stop(),
      publicBeacon?.stop(),
      pending?.catch(() => undefined),
    ])
    if (this.destroyed) return
    this.beaconSeedDescriptor = createPairingDescriptor(false, undefined, false)
    saveTrustedPairing(this.beaconSeedDescriptor)
    this.operatorStopped = false
    this.stopping = false
    this.options.onControlEnabledChange?.(true)
    this.state.textContent = 'Starting the replacement public target identity…'
    void this.start()
  }

  private start(): Promise<void> {
    if (this.destroyed || this.operatorStopped || this.stopping) return Promise.resolve()
    if (this.startInFlight) return this.startInFlight
    const operation = this.startInternal()
    const tracked = operation.finally(() => {
      if (this.startInFlight === tracked) this.startInFlight = null
    })
    this.startInFlight = tracked
    return tracked
  }

  private async startInternal(): Promise<void> {
    this.clearRetry()
    const generation = ++this.lifecycleGeneration
    this.startButton.disabled = true
    this.stopButton.disabled = false
    this.rotateButton.disabled = true
    this.state.textContent = 'Starting the public full-operator browser beacon…'
    this.enableButton.textContent = 'Companion · starting'
    try {
      const identity = await deriveStudy6PublicBeaconIdentity(
        this.beaconSeedDescriptor.streamId,
      )
      const publicDescriptor = await deriveStudy6PublicPairingDescriptor(identity.hint)
      if (
        generation !== this.lifecycleGeneration
        || this.operatorStopped
        || this.stopping
        || this.destroyed
      ) return
      const [host, qrCodeModule] = await Promise.all([
        this.getHost(),
        import('qrcode'),
      ])
      const snapshot = await host.start(
        this.options.canvas,
        false,
        publicDescriptor,
      )
      if (generation !== this.lifecycleGeneration || this.operatorStopped || this.destroyed) {
        await host.stop()
        return
      }
      if (!snapshot.pairingUrl) throw new Error('The public companion link was not created.')
      const publicBeacon = new Study6PublicBeaconBroadcaster(identity)
      this.publicBeacon = publicBeacon
      await publicBeacon.start()
      if (
        generation !== this.lifecycleGeneration
        || this.operatorStopped
        || this.stopping
        || this.destroyed
      ) {
        await publicBeacon.stop()
        await host.stop()
        return
      }
      const pairingUrl = snapshot.pairingUrl
      const qrDataUrl = await qrCodeModule.default.toDataURL(pairingUrl, {
        width: 320,
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#080b10', light: '#ffffff' },
      })
      if (
        generation !== this.lifecycleGeneration
        || this.operatorStopped
        || this.stopping
        || this.destroyed
      ) {
        await host.stop()
        return
      }
      this.link.value = pairingUrl
      this.qr.src = qrDataUrl
      this.dialog.querySelector<HTMLElement>('[data-pair]')!.hidden = false
      this.retryAttempt = 0
      this.state.textContent = 'Public discovery and full bounded browser control are online.'
    } catch (error) {
      if (generation !== this.lifecycleGeneration || this.operatorStopped || this.destroyed) return
      const publicBeacon = this.publicBeacon
      this.publicBeacon = null
      await publicBeacon?.stop()
      await this.host?.stop()
      this.state.textContent = error instanceof Error ? error.message : String(error)
      this.scheduleRetry()
    } finally {
      if (generation === this.lifecycleGeneration) this.rotateButton.disabled = false
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== undefined || this.operatorStopped || this.destroyed) return
    const index = Math.min(this.retryAttempt, HOST_RETRY_DELAYS_MS.length - 1)
    const delay = HOST_RETRY_DELAYS_MS[index]
    this.retryAttempt += 1
    this.state.textContent = `Public browser beacon unavailable; retrying automatically in ${Math.round(delay / 1_000)} s.`
    this.enableButton.textContent = 'Companion · retrying'
    this.startButton.disabled = false
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = undefined
      void this.start()
    }, delay)
  }

  private clearRetry(): void {
    if (this.retryTimer !== undefined) window.clearTimeout(this.retryTimer)
    this.retryTimer = undefined
  }

  private async shutdown(): Promise<void> {
    this.stopping = true
    this.lifecycleGeneration += 1
    this.clearRetry()
    this.options.onControlEnabledChange?.(false)
    const pending = this.startInFlight
    const publicBeacon = this.publicBeacon
    this.publicBeacon = null
    await Promise.all([
      this.host?.stop(),
      publicBeacon?.stop(),
      pending?.catch(() => undefined),
    ])
  }

  private async getHost(): Promise<CompanionHost> {
    if (this.host) return this.host
    const { CompanionHost } = await import('../companion/host.ts')
    const host = new CompanionHost({
      getStatus: this.options.getStatus,
      handleCommand: this.options.handleCommand,
      frameRate: 15,
      spectatorMedia: false,
    })
    host.addEventListener('statechange', (event) => {
      const snapshot = (event as CustomEvent<CompanionHostSnapshot>).detail
      this.state.textContent = snapshot.message || snapshot.phase
      this.enableButton.textContent = snapshot.phase === 'broadcasting'
        ? `Companion ready · ${snapshot.viewerCount}`
        : snapshot.phase === 'connecting'
          ? 'Companion · starting'
          : this.operatorStopped ? 'Companion · paused' : 'Companion'
      this.startButton.disabled = this.stopping
        || snapshot.phase === 'connecting'
        || snapshot.phase === 'broadcasting'
      this.stopButton.disabled = snapshot.phase === 'idle' && this.retryTimer === undefined
      if (snapshot.phase === 'broadcasting') this.retryAttempt = 0
    })
    this.host = host
    return host
  }

  private async copyLink(): Promise<void> {
    if (!this.link.value) return
    try {
      await navigator.clipboard.writeText(this.link.value)
      this.state.textContent = 'Direct public operator link copied.'
    } catch {
      this.link.focus()
      this.link.select()
      this.state.textContent = 'Select and copy the direct operator link manually.'
    }
  }
}

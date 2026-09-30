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
 * The WebXR page continuously hosts one private, data-only BRSP target and a
 * separate public availability beacon. The beacon contains no derivation path
 * to the private bearer credential. A phone pairs once through the fragment
 * link/QR and can then reconnect from its locally retained descriptor.
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
  /** Random persisted bearer credential used only by the private BRSP target. */
  private trustedDescriptor: PairingDescriptor
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
    this.trustedDescriptor = stored ?? createPairingDescriptor(false, undefined, false)
    const persisted = saveTrustedPairing(this.trustedDescriptor)

    this.enableButton = button('Companion · starting')
    this.enableButton.title = 'Show trusted companion pairing and connection status'
    options.slot.append(this.enableButton)

    this.dialog = document.createElement('dialog')
    this.dialog.className = 'study6-companion-dialog'
    this.dialog.innerHTML = `
      <div class="study6-companion-dialog__heading">
        <div><span>TRUSTED BROWSER PAIRING</span><h2>Browser companion</h2></div>
        <button type="button" data-close aria-label="Close">×</button>
      </div>
      <p>The private data-only BRSP host and a discovery-only public availability beacon start automatically and remain available while WebXR is immersive. The beacon cannot reveal or derive the private control credential.</p>
      <p><strong>Full bounded operator access requires this trusted link.</strong> Pair a phone once by opening or scanning it; that browser can retain the credential for later automatic reconnects. The protocol never grants arbitrary scripts, questionnaire answers, consent, raw ECG transfer, record deletion, or immersive-VR admission.</p>
      <div class="study6-companion-dialog__actions" data-actions></div>
      <p class="study6-companion-dialog__state" data-state role="status">Starting private companion control and public availability…</p>
      <div class="study6-companion-dialog__pair" data-pair hidden>
        <img data-qr alt="Private trusted-operator companion QR code" />
        <div>
          <label for="study6-companion-link">Private trusted-operator link</label>
          <textarea id="study6-companion-link" data-link readonly rows="5"></textarea>
          <button type="button" data-copy>Copy direct link</button>
          <p>${persisted
            ? 'This private target credential is remembered on this headset browser until Rotate is selected.'
            : 'Browser storage is unavailable; this private credential lasts only for the current page.'}</p>
          <p>Public discovery reveals only that an opaque Study 6 target is online. Rotate immediately revokes the old bearer credential and publishes a new unrelated availability handle.</p>
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
    this.rotateButton = button('Rotate trusted credential')
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
    this.state.textContent = 'Revoking the old trusted credential and closing its connection…'
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
    this.trustedDescriptor = createPairingDescriptor(false, undefined, false)
    saveTrustedPairing(this.trustedDescriptor)
    this.operatorStopped = false
    this.stopping = false
    this.options.onControlEnabledChange?.(true)
    this.state.textContent = 'Starting the replacement trusted companion target…'
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
    this.state.textContent = 'Starting private companion control and public availability…'
    this.enableButton.textContent = 'Companion · starting'
    try {
      const identity = await deriveStudy6PublicBeaconIdentity(
        this.trustedDescriptor.streamId,
      )
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
        this.trustedDescriptor,
      )
      if (generation !== this.lifecycleGeneration || this.operatorStopped || this.destroyed) {
        await host.stop()
        return
      }
      if (!snapshot.pairingUrl) throw new Error('The private companion link was not created.')
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
      this.state.textContent = 'Public availability and private bounded browser control are online.'
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
    this.state.textContent = `Trusted companion service unavailable; retrying automatically in ${Math.round(delay / 1_000)} s.`
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
      if (
        snapshot.phase === 'error'
        && !this.operatorStopped
        && !this.stopping
        && !this.destroyed
      ) {
        this.scheduleRetry()
      }
    })
    this.host = host
    return host
  }

  private async copyLink(): Promise<void> {
    if (!this.link.value) return
    try {
      await navigator.clipboard.writeText(this.link.value)
      this.state.textContent = 'Private trusted-operator link copied.'
    } catch {
      this.link.focus()
      this.link.select()
      this.state.textContent = 'Select and copy the direct operator link manually.'
    }
  }
}

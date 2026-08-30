import type {
  CompanionHost,
  CompanionHostSnapshot,
  CommandDecision,
} from '../companion/host.ts'
import type { CompanionStatus, RemoteCommandName } from '../companion/protocol.ts'

export interface CompanionControlsOptions {
  slot: HTMLElement
  canvas: HTMLCanvasElement
  getStatus: () => CompanionStatus
  handleCommand: (
    name: Exclude<RemoteCommandName, 'request_status'>,
    expectedRevision: number,
  ) => CommandDecision | Promise<CommandDecision>
  onControlEnabledChange?: (enabled: boolean) => void
}

function button(label: string, className = 'study6-shell__button'): HTMLButtonElement {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = className
  element.textContent = label
  return element
}

export class CompanionControls {
  private readonly options: CompanionControlsOptions
  private readonly enableButton: HTMLButtonElement
  private readonly dialog: HTMLDialogElement
  private readonly state: HTMLElement
  private readonly qr: HTMLImageElement
  private readonly link: HTMLTextAreaElement
  private readonly startButton: HTMLButtonElement
  private readonly stopButton: HTMLButtonElement
  private readonly controlCheckbox: HTMLInputElement
  private readonly forceTurnCheckbox: HTMLInputElement
  private host: CompanionHost | null = null

  constructor(options: CompanionControlsOptions) {
    this.options = options
    this.enableButton = button('Companion')
    this.enableButton.title = 'Pair a private spectator/control companion'
    options.slot.append(this.enableButton)

    this.dialog = document.createElement('dialog')
    this.dialog.className = 'study6-companion-dialog'
    this.dialog.innerHTML = `
      <div class="study6-companion-dialog__heading">
        <div><span>VOLATILE PEER SESSION</span><h2>Browser companion</h2></div>
        <button type="button" data-close aria-label="Close">×</button>
      </div>
      <p>Enable pairing only while an authorized operator is present. BRSP performs mutual pairing-secret proof and scopes every command over VDO.Ninja WebRTC. Public signaling/STUN/TURN is still used, and a direct route can disclose peer IP addresses. The app does not record the mirror.</p>
      <label class="study6-companion-dialog__option"><input type="checkbox" data-force-turn /> Request TURN relay instead of a direct route</label>
      <div class="study6-companion-dialog__actions" data-start-actions></div>
      <p class="study6-companion-dialog__state" data-state role="status">Pairing is off.</p>
      <div class="study6-companion-dialog__pair" data-pair hidden>
        <img data-qr alt="Companion session pairing QR code" />
        <div>
          <label for="study6-companion-link">Session companion link</label>
          <textarea id="study6-companion-link" data-link readonly rows="5"></textarea>
          <button type="button" data-copy>Copy link</button>
          <label class="study6-companion-dialog__option"><input type="checkbox" data-control /> Allow scoped BRSP remote commands</label>
          <p>Remote control never permits participant entry, questionnaire answers, consent, immersive-VR admission, data deletion, or record transfer. WebXR remains the experiment authority and may request an APK-local sensor export when the recorder is connected.</p>
        </div>
      </div>
    `
    document.body.append(this.dialog)

    this.state = this.dialog.querySelector<HTMLElement>('[data-state]')!
    this.qr = this.dialog.querySelector<HTMLImageElement>('[data-qr]')!
    this.link = this.dialog.querySelector<HTMLTextAreaElement>('[data-link]')!
    this.controlCheckbox = this.dialog.querySelector<HTMLInputElement>('[data-control]')!
    this.forceTurnCheckbox = this.dialog.querySelector<HTMLInputElement>('[data-force-turn]')!
    const actionSlot = this.dialog.querySelector<HTMLElement>('[data-start-actions]')!
    this.startButton = button('Enable pairing session', 'study6-companion-dialog__primary')
    this.stopButton = button('Stop pairing')
    this.stopButton.disabled = true
    actionSlot.append(this.startButton, this.stopButton)

    this.enableButton.addEventListener('click', () => this.dialog.showModal())
    this.dialog.querySelector<HTMLButtonElement>('[data-close]')!.addEventListener('click', () => this.dialog.close())
    this.startButton.addEventListener('click', () => void this.start())
    this.stopButton.addEventListener('click', () => void this.stop())
    this.dialog.querySelector<HTMLButtonElement>('[data-copy]')!.addEventListener('click', () => void this.copyLink())
    this.controlCheckbox.addEventListener('change', () => {
      options.onControlEnabledChange?.(this.controlCheckbox.checked)
    })
    window.addEventListener('pagehide', () => void this.host?.stop(), { once: true })
  }

  async stop(): Promise<void> {
    this.controlCheckbox.checked = false
    this.options.onControlEnabledChange?.(false)
    await this.host?.stop()
    this.link.value = ''
    this.qr.removeAttribute('src')
    this.dialog.querySelector<HTMLElement>('[data-pair]')!.hidden = true
  }

  destroy(): void {
    void this.stop()
    this.enableButton.remove()
    this.dialog.remove()
  }

  private async start(): Promise<void> {
    this.startButton.disabled = true
    this.forceTurnCheckbox.disabled = true
    this.state.textContent = 'Creating a reconnectable pairing session…'
    try {
      const [host, qrCodeModule] = await Promise.all([
        this.getHost(),
        import('qrcode'),
      ])
      const snapshot = await host.start(this.options.canvas, this.forceTurnCheckbox.checked)
      if (!snapshot.pairingUrl) throw new Error('The companion link was not created.')
      this.link.value = snapshot.pairingUrl
      this.qr.src = await qrCodeModule.default.toDataURL(snapshot.pairingUrl, {
        width: 320,
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#080b10', light: '#ffffff' },
      })
      this.dialog.querySelector<HTMLElement>('[data-pair]')!.hidden = false
    } catch (error) {
      this.state.textContent = error instanceof Error ? error.message : String(error)
      this.startButton.disabled = false
    } finally {
      this.forceTurnCheckbox.disabled = false
    }
  }

  private async getHost(): Promise<CompanionHost> {
    if (this.host) return this.host
    const { CompanionHost } = await import('../companion/host.ts')
    const host = new CompanionHost({
      getStatus: this.options.getStatus,
      handleCommand: this.options.handleCommand,
      frameRate: 15,
    })
    host.addEventListener('statechange', (event) => {
      const snapshot = (event as CustomEvent<CompanionHostSnapshot>).detail
      this.state.textContent = snapshot.message || snapshot.phase
      this.enableButton.textContent = snapshot.phase === 'broadcasting'
        ? `Companion · ${snapshot.viewerCount}`
        : 'Companion'
      this.startButton.disabled = snapshot.phase === 'connecting' || snapshot.phase === 'broadcasting'
      this.stopButton.disabled = snapshot.phase === 'idle'
    })
    this.host = host
    return host
  }

  private async copyLink(): Promise<void> {
    if (!this.link.value) return
    try {
      await navigator.clipboard.writeText(this.link.value)
      this.state.textContent = 'One-time link copied.'
    } catch {
      this.link.focus()
      this.link.select()
      this.state.textContent = 'Select and copy the session link manually.'
    }
  }
}

import './browser-shell.css'

export interface BrowserShellCopy {
  title: string
  interactiveView: string
  testOnly: string
  enterVR: string
  exitVR: string
  recenter: string
  vrUnavailable: string
  ready: string
  pauseMedia: string
  resumeMedia: string
}

export interface BrowserStudyShell {
  readonly root: HTMLElement
  readonly canvas: HTMLCanvasElement
  readonly overlay: HTMLElement
  readonly controls: HTMLElement
  readonly companionSlot: HTMLElement
  readonly enterVRButton: HTMLButtonElement
  readonly recenterButton: HTMLButtonElement
  readonly mediaButton: HTMLButtonElement
  setStatus(message: string): void
  setXRAvailability(available: boolean): void
  setXRPresenting(presenting: boolean): void
  setMediaControl(options: {
    visible: boolean
    paused: boolean
    pauseLabel?: string
    resumeLabel?: string
  }): void
  destroy(): void
}

const defaultCopy: BrowserShellCopy = {
  title: 'Spatial Study 6',
  interactiveView: 'Spatial Study 6 interactive view',
  testOnly: 'WEBXR · TEST ONLY',
  enterVR: 'Enter VR',
  exitVR: 'Exit VR',
  recenter: 'Recenter panel',
  vrUnavailable: 'Immersive VR is not available in this browser.',
  ready: 'Ready',
  pauseMedia: 'Pause media',
  resumeMedia: 'Resume media',
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag)
  result.className = className
  if (text !== undefined) result.textContent = text
  return result
}

export function createBrowserStudyShell(
  host: HTMLElement = document.body,
  copy: Partial<BrowserShellCopy> = {},
): BrowserStudyShell {
  const labels = { ...defaultCopy, ...copy }
  const root = element('main', 'study6-shell')

  const topbar = element('header', 'study6-shell__topbar')
  const brand = element('div', 'study6-shell__brand', labels.title)
  const badge = element('div', 'study6-shell__badge', labels.testOnly)
  topbar.append(brand, badge)

  const stage = element('section', 'study6-shell__stage')
  stage.setAttribute('aria-label', labels.title)
  const canvas = element('canvas', 'study6-shell__canvas')
  canvas.tabIndex = 0
  canvas.setAttribute('aria-label', labels.interactiveView)
  const overlay = element('div', 'study6-shell__overlay')
  overlay.setAttribute('aria-hidden', 'true')
  stage.append(canvas, overlay)

  const bottomBar = element('footer', 'study6-shell__bottom-bar')
  const status = element('div', 'study6-shell__status', labels.ready)
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')

  const controls = element('div', 'study6-shell__controls')
  const companionSlot = element('div', 'study6-shell__companion-slot')
  const mediaButton = element('button', 'study6-shell__button', labels.resumeMedia)
  mediaButton.type = 'button'
  mediaButton.hidden = true
  const recenterButton = element('button', 'study6-shell__button', labels.recenter)
  recenterButton.type = 'button'
  recenterButton.disabled = true
  const enterVRButton = element(
    'button',
    'study6-shell__button study6-shell__button--primary',
    labels.enterVR,
  )
  enterVRButton.type = 'button'
  enterVRButton.disabled = true
  controls.append(companionSlot, mediaButton, recenterButton, enterVRButton)
  bottomBar.append(status, controls)

  root.append(topbar, stage, bottomBar)
  host.append(root)

  return {
    root,
    canvas,
    overlay,
    controls,
    companionSlot,
    enterVRButton,
    recenterButton,
    mediaButton,
    setStatus: (message: string) => {
      status.textContent = message
    },
    setXRAvailability: (available: boolean) => {
      enterVRButton.disabled = !available
      enterVRButton.title = available ? '' : labels.vrUnavailable
    },
    setXRPresenting: (presenting: boolean) => {
      enterVRButton.textContent = presenting ? labels.exitVR : labels.enterVR
      recenterButton.disabled = !presenting
      root.dataset.xrPresenting = presenting ? 'true' : 'false'
    },
    setMediaControl: ({
      visible,
      paused,
      pauseLabel = labels.pauseMedia,
      resumeLabel = labels.resumeMedia,
    }) => {
      mediaButton.hidden = !visible
      mediaButton.textContent = paused ? resumeLabel : pauseLabel
      mediaButton.setAttribute('aria-pressed', paused ? 'true' : 'false')
    },
    destroy: () => root.remove(),
  }
}

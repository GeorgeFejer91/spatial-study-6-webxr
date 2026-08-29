import './style.css'

import {
  decodePairingDescriptor,
  type CompanionStatus,
  type PairingDescriptor,
  type RemoteCommandName,
} from './protocol'
import {
  CompanionViewer,
  type CommandAcknowledgement,
  type CompanionViewerSnapshot,
} from './viewer'

if (window.top !== window.self) {
  document.body.replaceChildren('This operator companion must be opened as a top-level page.')
  throw new Error('The companion page cannot run inside a frame.')
}
document.body.inert = false

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error(`Missing companion element: ${selector}`)
  return found
}

const pairInput = element<HTMLInputElement>('#pair-input')
const applyPairButton = element<HTMLButtonElement>('#apply-pair')
const connectButton = element<HTMLButtonElement>('#connect')
const disconnectButton = element<HTMLButtonElement>('#disconnect')
const connectionState = element<HTMLElement>('#connection-state')
const pairingSummary = element<HTMLElement>('#pairing-summary')
const video = element<HTMLVideoElement>('#spectator-video')
const videoPlaceholder = element<HTMLElement>('#video-placeholder')
const routeBadge = element<HTMLElement>('#route-badge')
const commandResult = element<HTMLElement>('#command-result')
const commandButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-command]'))

let descriptor: PairingDescriptor | null = null
let viewer: CompanionViewer | null = null
let latestStatus: CompanionStatus | null = null

function fragmentFromInput(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    return url.hash
  } catch {
    return trimmed.startsWith('#') ? trimmed : `#pair=${trimmed.replace(/^pair=/u, '')}`
  }
}

function applyDescriptor(fragment: string): boolean {
  try {
    descriptor = decodePairingDescriptor(fragment)
    pairInput.value = ''
    pairingSummary.textContent = `One-time session ${descriptor.streamId.slice(-8).toUpperCase()} is ready to connect${descriptor.forceTurn ? ' through a requested relay route' : ''}.`
    connectionState.textContent = 'Pairing accepted. Connection has not started.'
    connectButton.disabled = false
    return true
  } catch {
    descriptor = null
    pairingSummary.textContent = 'The one-time pairing value is missing or invalid.'
    connectionState.textContent = 'Not paired.'
    connectButton.disabled = true
    return false
  }
}

function renderCommandAvailability(): void {
  const peerConnected = viewer?.snapshot().peerConnected === true
  for (const button of commandButtons) {
    const name = button.dataset.command as RemoteCommandName
    let enabled = peerConnected
    if (name !== 'request_status' && latestStatus === null) enabled = false
    if (name === 'start_block') enabled = enabled && latestStatus?.remoteStartAllowed === true
    if (name === 'pause_media') {
      enabled = enabled && latestStatus?.mediaElapsedSeconds !== null && latestStatus?.mediaPaused === false
    }
    if (name === 'resume_media') enabled = enabled && latestStatus?.mediaPaused === true
    if (name === 'advance') enabled = enabled && latestStatus?.remoteAdvanceAllowed === true
    if (name === 'back') enabled = enabled && latestStatus?.remoteBackAllowed === true
    button.disabled = !enabled
  }
}

function renderConnection(snapshot: CompanionViewerSnapshot): void {
  connectionState.textContent = snapshot.message || (snapshot.phase === 'idle' ? 'Disconnected.' : snapshot.phase)
  const connected = snapshot.peerConnected
  renderCommandAvailability()
  connectButton.disabled = snapshot.phase === 'connecting' || descriptor === null
  disconnectButton.disabled = snapshot.phase === 'idle'
  routeBadge.textContent = connected ? 'Peer connected' : snapshot.phase === 'connecting' ? 'Connecting' : 'Offline'
}

function renderStatus(status: CompanionStatus): void {
  latestStatus = status
  const set = (name: string, value: string) => {
    const target = document.querySelector<HTMLElement>(`[data-field="${name}"]`)
    if (target) target.textContent = value
  }
  set('phase', status.phase)
  set('route', status.route === 'immersive-vr' ? 'Immersive VR' : 'Browser')
  set('block', status.blockOrdinal === null ? '—' : `${status.blockOrdinal} / 4`)
  set('condition', status.condition ?? '—')
  const elapsed = status.mediaElapsedSeconds === null ? '—' : `${Math.round(status.mediaElapsedSeconds)} s`
  const duration = status.mediaDurationSeconds === null ? '' : ` / ${Math.round(status.mediaDurationSeconds)} s`
  set('media', `${elapsed}${duration}${status.mediaPaused ? ' · paused' : ''}`)
  set('storage', status.storageHealthy ? 'Healthy' : 'Attention required')

  renderCommandAvailability()
}

async function connect(): Promise<void> {
  if (!descriptor) return
  await viewer?.stop()
  viewer = new CompanionViewer(descriptor)
  viewer.addEventListener('statechange', (event) => {
    renderConnection((event as CustomEvent<CompanionViewerSnapshot>).detail)
  })
  viewer.addEventListener('stream', (event) => {
    video.srcObject = (event as CustomEvent<MediaStream>).detail
    videoPlaceholder.hidden = true
    void video.play().catch(() => {
      connectionState.textContent = 'Video is ready; select the video area if autoplay was blocked.'
    })
  })
  viewer.addEventListener('status', (event) => {
    renderStatus((event as CustomEvent<CompanionStatus>).detail)
  })
  viewer.addEventListener('ack', (event) => {
    const acknowledgement = (event as CustomEvent<CommandAcknowledgement>).detail
    commandResult.textContent = `${acknowledgement.accepted ? 'Accepted' : 'Rejected'}: ${acknowledgement.message}`
    commandResult.dataset.accepted = String(acknowledgement.accepted)
  })
  try {
    await viewer.connect()
  } catch {
    // The state event already exposes a bounded user-facing error.
  }
}

async function disconnect(): Promise<void> {
  const currentViewer = viewer
  viewer = null
  latestStatus = null
  await currentViewer?.stop()
  video.srcObject = null
  videoPlaceholder.hidden = false
  renderCommandAvailability()
  disconnectButton.disabled = true
}

async function applyInputPairing(): Promise<void> {
  await disconnect()
  applyDescriptor(fragmentFromInput(pairInput.value))
}

applyPairButton.addEventListener('click', () => void applyInputPairing())
pairInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') void applyInputPairing()
})
connectButton.addEventListener('click', () => void connect())
disconnectButton.addEventListener('click', () => void disconnect())

for (const button of commandButtons) {
  button.addEventListener('click', async () => {
    const name = button.dataset.command as RemoteCommandName
    try {
      const commandId = await viewer?.sendCommand(name)
      commandResult.textContent = commandId ? `Command ${name.replaceAll('_', ' ')} sent; waiting for acknowledgement…` : 'Command was not sent.'
    } catch (error) {
      commandResult.textContent = error instanceof Error ? error.message : String(error)
    }
  })
}

if (location.hash && applyDescriptor(location.hash)) {
  history.replaceState(null, '', `${location.pathname}${location.search}`)
}

window.addEventListener('pagehide', () => void viewer?.stop(), { once: true })

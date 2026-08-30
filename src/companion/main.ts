import './style.css'

import {
  decodePairingDescriptor,
  RemoteCommandRequestSchema,
  type CompanionStatus,
  type PairingDescriptor,
  type RemoteCommandRequest,
  type SimpleRemoteCommandName,
} from './protocol'
import {
  CompanionViewer,
  type CommandAcknowledgement,
  type CompanionViewerSnapshot,
} from './viewer'
import { companionCommandAllowed } from './availability'
import {
  forgetTrustedPairing,
  loadTrustedPairing,
  saveTrustedPairing,
} from './trusted-pairing.ts'
import {
  deriveStudy6PublicPairingDescriptor,
  Study6PublicBeaconReceiver,
  type Study6PublicBeaconReceiverSnapshot,
  type Study6PublicBeaconTarget,
} from './public-beacon.ts'

if (window.top !== window.self) {
  document.body.replaceChildren('This operator companion must be opened as a top-level page.')
  throw new Error('The companion page cannot run inside a frame.')
}
document.body.inert = false

// A pairing descriptor is a bearer credential. Capture it in memory and scrub
// the fragment before parsing, rendering, storage, or any network operation.
const launchPairingFragment = location.hash
if (launchPairingFragment) {
  history.replaceState(null, '', `${location.pathname}${location.search}`)
}

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000] as const

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error(`Missing companion element: ${selector}`)
  return found
}

const pairInput = element<HTMLInputElement>('#pair-input')
const applyPairButton = element<HTMLButtonElement>('#apply-pair')
const connectButton = element<HTMLButtonElement>('#connect')
const disconnectButton = element<HTMLButtonElement>('#disconnect')
const forgetPairingButton = element<HTMLButtonElement>('#forget-pairing')
const connectionState = element<HTMLElement>('#connection-state')
const pairingSummary = element<HTMLElement>('#pairing-summary')
const publicDiscoveryBadge = element<HTMLElement>('#public-discovery-badge')
const publicDiscoveryState = element<HTMLElement>('#public-discovery-state')
const publicTargetList = element<HTMLUListElement>('#public-target-list')
const video = element<HTMLVideoElement>('#spectator-video')
const videoPlaceholder = element<HTMLElement>('#video-placeholder')
const monitoringSection = element<HTMLElement>('[data-monitoring]')
const routeBadge = element<HTMLElement>('#route-badge')
const commandResult = element<HTMLElement>('#command-result')
const commandButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-command]'))
const setupVariant = element<HTMLSelectElement>('#setup-variant')
const setupLanguage = element<HTMLSelectElement>('#setup-language')
const setupTiming = element<HTMLSelectElement>('#setup-timing')
const applyConfigurationButton = element<HTMLButtonElement>('#apply-configuration')
const participantInput = element<HTMLInputElement>('#participant-id')
const startParticipantButton = element<HTMLButtonElement>('#start-participant')
const participantHint = element<HTMLElement>('#participant-hint')

let descriptor: PairingDescriptor | null = null
let descriptorSource: PairingSource | null = null
let viewer: CompanionViewer | null = null
let latestStatus: CompanionStatus | null = null
let autoReconnectEnabled = false
let retryTimer: number | undefined
let retryAttempt = 0
let connectionGeneration = 0
let connectInFlightGeneration: number | null = null
const publicBeaconReceiver = new Study6PublicBeaconReceiver()
let latestPublicDiscovery = publicBeaconReceiver.snapshot()
let selectedPublicHint: string | null = null
let publicAutoConnectSuppressed = false
let publicSelectionGeneration = 0

function clearRetryTimer(): void {
  if (retryTimer !== undefined) window.clearTimeout(retryTimer)
  retryTimer = undefined
}

function stopAutomaticReconnect(): void {
  autoReconnectEnabled = false
  retryAttempt = 0
  clearRetryTimer()
}

function removeSavedDescriptor(): void {
  forgetTrustedPairing()
  forgetPairingButton.disabled = true
}

function persistDescriptor(value: PairingDescriptor): boolean {
  if (saveTrustedPairing(value)) {
    forgetPairingButton.disabled = false
    return true
  }
  forgetPairingButton.disabled = true
  return false
}

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

type PairingSource = 'link' | 'manual' | 'saved' | 'public'

function acceptDescriptor(nextDescriptor: PairingDescriptor, source: PairingSource): boolean {
  descriptor = nextDescriptor
  descriptorSource = source
  pairInput.value = ''
  if (source !== 'saved') forgetTrustedPairing()
  const persisted = source === 'saved'
    || (source !== 'public' && persistDescriptor(nextDescriptor))
  forgetPairingButton.disabled = !persisted
  pairingSummary.textContent = source === 'public'
    ? `Public target ${selectedPublicHint?.slice(0, 8).toUpperCase() ?? 'UNKNOWN'} is selected. This open prototype derives its data-only BRSP session from the public beacon and requests the existing bounded Study 6 operator scopes automatically.`
    : `BRSP pairing session ${nextDescriptor.streamId.slice(-8).toUpperCase()} is ready${nextDescriptor.forceTurn ? ' with TURN requested' : ''}. ${nextDescriptor.spectatorMedia ? 'Optional spectator monitoring is enabled.' : 'This is a data-only session.'} Full requested Study 6 operator scopes still require mutual proof and the headset grant. ${persisted ? 'This browser will remember the pairing until you select Forget pairing.' : 'Local storage is unavailable, so this pairing lasts only for the current page.'}`
  monitoringSection.hidden = !nextDescriptor.spectatorMedia
  connectionState.textContent = source === 'public'
    ? 'Public headset selected. Connecting automatically; select Cancel / disconnect to stop for this page.'
    : source === 'manual'
      ? 'Pairing accepted. Connecting automatically; select Cancel / disconnect to stop.'
      : 'Authenticated pairing request accepted. Connecting automatically; select Cancel / disconnect to stop.'
  connectButton.disabled = false
  disconnectButton.disabled = false
  return true
}

function applyDescriptor(fragment: string, source: Exclude<PairingSource, 'saved'>): boolean {
  try {
    return acceptDescriptor(decodePairingDescriptor(fragment), source)
  } catch {
    descriptor = null
    descriptorSource = null
    pairingSummary.textContent = 'The session pairing value is missing or invalid. Paste a fresh headset link below to replace it.'
    connectionState.textContent = 'Not paired; no connection was started.'
    connectButton.disabled = true
    disconnectButton.disabled = true
    return false
  }
}

function orderedPublicTargets(
  targets: readonly Study6PublicBeaconTarget[],
): Study6PublicBeaconTarget[] {
  return [...targets].sort((left, right) => left.hint.localeCompare(right.hint))
}

function renderPublicDiscovery(snapshot = latestPublicDiscovery): void {
  latestPublicDiscovery = snapshot
  const targets = orderedPublicTargets(snapshot.targets)
  const peerConnected = viewer?.snapshot().peerConnected === true
  publicDiscoveryBadge.textContent = peerConnected && selectedPublicHint
    ? 'Connected'
    : publicAutoConnectSuppressed
      ? 'Canceled'
      : snapshot.phase === 'listening'
        ? targets.length > 0 ? `${targets.length} online` : 'Listening'
        : snapshot.phase === 'reconnecting'
          ? 'Reconnecting'
          : snapshot.phase === 'error' ? 'Unavailable' : 'Discovering'

  if (peerConnected && selectedPublicHint) {
    const selected = targets.find(({ hint }) => hint === selectedPublicHint)
    publicDiscoveryState.textContent = `${selected?.label ?? 'Public Study 6 headset'} is BRSP connected.`
  } else if (publicAutoConnectSuppressed) {
    publicDiscoveryState.textContent = 'Automatic public connection is canceled for this page. Reload or select Connect to resume.'
  } else if (selectedPublicHint) {
    const selected = targets.find(({ hint }) => hint === selectedPublicHint)
    publicDiscoveryState.textContent = selected
      ? `${selected.label} is public and ${peerConnected ? 'BRSP connected.' : 'selected for BRSP connection.'}`
      : 'The selected public headset is temporarily absent from discovery; the active BRSP route may still repair.'
  } else if (targets.length > 0) {
    publicDiscoveryState.textContent = `${targets.length} public headset${targets.length === 1 ? '' : 's'} online. Selecting the first opaque beacon deterministically…`
  } else {
    publicDiscoveryState.textContent = snapshot.message || 'Looking for public Study 6 headsets…'
  }

  publicTargetList.replaceChildren(...targets.map((target) => {
    const item = document.createElement('li')
    const selected = target.hint === selectedPublicHint
    item.dataset.selected = String(selected)
    item.textContent = `${target.label} · ${selected ? peerConnected ? 'connected' : 'selected' : 'online'}`
    return item
  }))
}

async function maybeAutoConnectPublic(snapshot: Study6PublicBeaconReceiverSnapshot): Promise<void> {
  renderPublicDiscovery(snapshot)
  if (publicAutoConnectSuppressed || selectedPublicHint !== null) return
  const targets = orderedPublicTargets(snapshot.targets)
  const selected = targets[0]
  if (!selected) return
  const selectionGeneration = ++publicSelectionGeneration
  try {
    if (descriptor !== null) {
      const currentDescriptor = descriptor
      let firstPublicDescriptor: PairingDescriptor | null = null
      for (const target of targets) {
        const candidate = await deriveStudy6PublicPairingDescriptor(target.hint)
        if (target.hint === selected.hint) firstPublicDescriptor = candidate
        if (selectionGeneration !== publicSelectionGeneration) return
        if (
          candidate.room === currentDescriptor.room
          && candidate.streamId === currentDescriptor.streamId
          && candidate.key === currentDescriptor.key
        ) {
          selectedPublicHint = target.hint
          renderPublicDiscovery()
          return
        }
      }
      if (descriptorSource === 'saved' && firstPublicDescriptor) {
        connectionGeneration += 1
        connectInFlightGeneration = null
        stopAutomaticReconnect()
        descriptor = null
        descriptorSource = null
        await stopCurrentViewer()
        if (
          selectionGeneration !== publicSelectionGeneration
          || publicAutoConnectSuppressed
          || !latestPublicDiscovery.targets.some(({ hint }) => hint === selected.hint)
        ) return
        selectedPublicHint = selected.hint
        acceptDescriptor(firstPublicDescriptor, 'public')
        renderPublicDiscovery()
        void connect()
      }
      return
    }
    const publicDescriptor = await deriveStudy6PublicPairingDescriptor(selected.hint)
    if (
      selectionGeneration !== publicSelectionGeneration
      || publicAutoConnectSuppressed
      || descriptor !== null
      || !latestPublicDiscovery.targets.some(({ hint }) => hint === selected.hint)
    ) return
    selectedPublicHint = selected.hint
    acceptDescriptor(publicDescriptor, 'public')
    renderPublicDiscovery()
    void connect()
  } catch {
    if (selectionGeneration !== publicSelectionGeneration) return
    publicDiscoveryBadge.textContent = 'Unavailable'
    publicDiscoveryState.textContent = 'The public headset announcement was invalid and was ignored.'
  }
}

function renderCommandAvailability(): void {
  const snapshot = viewer?.snapshot()
  const peerConnected = snapshot?.peerConnected === true
  const statusGateBlocked = snapshot?.commandGateBlocked === true || snapshot?.stateStale === true
  for (const button of commandButtons) {
    const name = button.dataset.command as SimpleRemoteCommandName
    button.disabled = (
      name !== 'request_status'
      && statusGateBlocked
    ) || !companionCommandAllowed(name, peerConnected, latestStatus)
  }
  applyConfigurationButton.disabled = statusGateBlocked
    || !companionCommandAllowed('configure_study', peerConnected, latestStatus)
  startParticipantButton.disabled = statusGateBlocked
    || !companionCommandAllowed('start_participant', peerConnected, latestStatus)
}

function renderConnection(snapshot: CompanionViewerSnapshot): void {
  connectionState.textContent = snapshot.message || (snapshot.phase === 'idle' ? 'Disconnected.' : snapshot.phase)
  const connected = snapshot.peerConnected
  renderCommandAvailability()
  connectButton.disabled = snapshot.phase === 'connecting' || descriptor === null
  connectButton.textContent = snapshot.phase === 'error' ? 'Retry now' : 'Connect'
  disconnectButton.disabled = snapshot.phase === 'idle' && retryTimer === undefined
  routeBadge.textContent = connected
    ? snapshot.stateStale ? 'Status stale' : 'BRSP authenticated'
    : snapshot.phase === 'connecting' ? 'Connecting' : 'Offline'
  const scopes = document.querySelector<HTMLElement>('[data-field="scopes"]')
  if (scopes) {
    scopes.textContent = snapshot.acceptedScopes.length > 0
      ? snapshot.acceptedScopes.join(', ')
      : '—'
  }
  renderPublicDiscovery()
}

function renderStatus(status: CompanionStatus): void {
  latestStatus = status
  const set = (name: string, value: string) => {
    const target = document.querySelector<HTMLElement>(`[data-field="${name}"]`)
    if (target) target.textContent = value
  }
  set('phase', status.phase)
  set('route', status.route === 'immersive-vr' ? 'Immersive VR' : 'Browser')
  set('language', status.language === 'de' ? 'German (de)' : 'English (en)')
  set('variant', status.variant ?? 'Not configured')
  set('timing', status.timingMode === null
    ? 'Not configured'
    : status.timingMode === 'full' ? 'Full · 5 min' : 'Clipped · 10 s')
  set('xr-presenting', status.xrPresenting ? 'Presenting' : 'Not presenting')
  set('participant-active', status.participantActive ? 'Active' : 'Inactive')
  set('completed-blocks', `${status.completedBlockCount} / 4`)
  set('block', status.blockOrdinal === null ? '—' : `${status.blockOrdinal} / 4`)
  set('condition', status.condition ?? '—')
  const elapsed = status.mediaElapsedSeconds === null ? '—' : `${Math.round(status.mediaElapsedSeconds)} s`
  const duration = status.mediaDurationSeconds === null ? '' : ` / ${Math.round(status.mediaDurationSeconds)} s`
  set('media', `${elapsed}${duration}${status.mediaPaused ? ' · paused' : ''}`)
  set('storage', status.storageHealthy ? 'Healthy' : 'Attention required')
  set('authority', 'WebXR experiment')
  set('remote-control', status.remoteControlEnabled ? 'Enabled on headset' : 'Read-only')
  set('bridge', status.bridgeConnected ? 'Connected' : 'Unavailable')
  set('sensor', `${status.polarPhase.replaceAll('_', ' ')}${status.polarReady ? ' · ready' : ''}`)
  set('sensor-reason', status.polarReadinessReason || '—')
  set('heart-rate', status.heartRateBpm === null ? '—' : `${status.heartRateBpm} bpm`)
  set(
    'ecg',
    status.ecgSampleRateHz === null
      ? '—'
      : `${status.ecgSampleRateHz.toFixed(1)} Hz · ${status.ecgSampleCount.toLocaleString()} samples`,
  )
  set(
    'sample-age',
    status.lastEcgSampleAgeMs === null ? '—' : `${Math.round(status.lastEcgSampleAgeMs)} ms`,
  )
  set('recording', status.recordingState.replaceAll('_', ' '))
  set('recording-revision', status.recordingRevision.toLocaleString())
  set('recording-markers', status.recordingMarkerCount.toLocaleString())
  set('recording-samples', status.recordingSamplesWritten.toLocaleString())
  set('recording-drops', status.recordingDroppedBatches.toLocaleString())
  set('recording-artifact', status.recordingArtifactOpen ? 'Open' : 'Closed')
  set('recording-durable', status.recordingDurable ? 'Durable' : 'Not confirmed')
  set('writer-health', status.polarWriterHealthy ? 'Healthy' : 'Attention required')
  set('gaps', `${status.polarGapCount} gaps · ${status.polarReconnectCount} reconnects`)
  set('preflight', status.startPreflightReady
    ? 'Quality ready'
    : 'Quality-ineligible; block Start remains locked until preflight recovers')
  set('receipt', status.lastReceiptStage ?? '—')

  // Preserve local operator drafts while setup is still unconfigured. Once
  // WebXR accepts configuration, project only its returned authoritative values.
  if (status.variant !== null && status.timingMode !== null) {
    setupVariant.value = status.variant
    setupLanguage.value = status.language
    setupTiming.value = status.timingMode
  }
  participantHint.textContent = status.participantPrefix
    ? `(expected pool ${status.participantPrefix}1–${status.participantPrefix}24; bounded custom codes are also accepted)`
    : '(configure the study first)'

  renderCommandAvailability()
}

function scheduleReconnect(): void {
  if (!autoReconnectEnabled || !descriptor || retryTimer !== undefined) return
  const scheduledGeneration = connectionGeneration
  const delayIndex = Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)
  const delayMs = RETRY_DELAYS_MS[delayIndex]
  retryAttempt += 1
  connectionState.textContent = `Headset is not available yet. Retrying automatically in ${Math.round(delayMs / 1_000)} s; select Cancel / disconnect to stop.`
  connectButton.textContent = 'Retry now'
  connectButton.disabled = false
  disconnectButton.disabled = false
  retryTimer = window.setTimeout(() => {
    retryTimer = undefined
    if (
      !autoReconnectEnabled
      || !descriptor
      || scheduledGeneration !== connectionGeneration
    ) return
    if (connectInFlightGeneration === connectionGeneration) {
      scheduleReconnect()
      return
    }
    void connect()
  }, delayMs)
}

async function sendRemoteRequest(requestValue: RemoteCommandRequest): Promise<string | null> {
  const request = RemoteCommandRequestSchema.parse(requestValue)
  const commandId = await viewer?.sendCommand(request)
  commandResult.textContent = commandId
    ? `Command ${request.name.replaceAll('_', ' ')} sent; waiting for acknowledgement…`
    : 'Command was not sent.'
  return commandId ?? null
}

async function connect(): Promise<void> {
  const generation = connectionGeneration
  if (!descriptor || connectInFlightGeneration === generation) return
  publicAutoConnectSuppressed = false
  renderPublicDiscovery()
  clearRetryTimer()
  autoReconnectEnabled = true
  connectInFlightGeneration = generation
  latestStatus = null
  renderCommandAvailability()
  await viewer?.stop()
  if (
    generation !== connectionGeneration
    || !autoReconnectEnabled
    || !descriptor
  ) {
    if (connectInFlightGeneration === generation) connectInFlightGeneration = null
    return
  }
  const nextViewer = new CompanionViewer(descriptor)
  viewer = nextViewer
  nextViewer.addEventListener('statechange', (event) => {
    if (viewer !== nextViewer || generation !== connectionGeneration) return
    const snapshot = (event as CustomEvent<CompanionViewerSnapshot>).detail
    renderConnection(snapshot)
    if (snapshot.peerConnected) {
      retryAttempt = 0
      clearRetryTimer()
    } else if (snapshot.phase === 'error') {
      scheduleReconnect()
    }
  })
  nextViewer.addEventListener('stream', (event) => {
    if (viewer !== nextViewer || generation !== connectionGeneration) return
    video.srcObject = (event as CustomEvent<MediaStream>).detail
    videoPlaceholder.hidden = true
    void video.play().catch(() => {
      connectionState.textContent = 'Video is ready; select the video area if autoplay was blocked.'
    })
  })
  nextViewer.addEventListener('status', (event) => {
    if (viewer !== nextViewer || generation !== connectionGeneration) return
    renderStatus((event as CustomEvent<CompanionStatus>).detail)
  })
  nextViewer.addEventListener('ack', (event) => {
    if (viewer !== nextViewer || generation !== connectionGeneration) return
    const acknowledgement = (event as CustomEvent<CommandAcknowledgement>).detail
    const stage = acknowledgement.stage ? ` · ${acknowledgement.stage}` : ''
    commandResult.textContent = `${acknowledgement.accepted ? 'Accepted' : 'Rejected'}${stage}: ${acknowledgement.message}`
    commandResult.dataset.accepted = String(acknowledgement.accepted)
  })
  try {
    await nextViewer.connect()
  } catch {
    // The state event already exposes a bounded user-facing error.
    scheduleReconnect()
  } finally {
    if (connectInFlightGeneration === generation) connectInFlightGeneration = null
  }
}

async function stopCurrentViewer(): Promise<void> {
  const currentViewer = viewer
  viewer = null
  latestStatus = null
  await currentViewer?.stop()
  video.srcObject = null
  videoPlaceholder.hidden = false
  renderCommandAvailability()
  disconnectButton.disabled = true
}

async function disconnect(): Promise<void> {
  connectionGeneration += 1
  connectInFlightGeneration = null
  publicSelectionGeneration += 1
  publicAutoConnectSuppressed = true
  stopAutomaticReconnect()
  await stopCurrentViewer()
  connectionState.textContent = selectedPublicHint
    ? 'Disconnected. Automatic public reconnection is canceled until reload or an explicit Connect.'
    : descriptor
      ? 'Disconnected. Select Connect to authenticate again.'
    : 'Not paired.'
  connectButton.disabled = descriptor === null
  connectButton.textContent = 'Connect'
  renderPublicDiscovery()
}

async function applyInputPairing(): Promise<void> {
  connectionGeneration += 1
  connectInFlightGeneration = null
  publicSelectionGeneration += 1
  publicAutoConnectSuppressed = true
  selectedPublicHint = null
  stopAutomaticReconnect()
  await stopCurrentViewer()
  if (applyDescriptor(fragmentFromInput(pairInput.value), 'manual')) {
    void connect()
  }
}

async function forgetPairing(): Promise<void> {
  connectionGeneration += 1
  connectInFlightGeneration = null
  publicSelectionGeneration += 1
  publicAutoConnectSuppressed = true
  selectedPublicHint = null
  stopAutomaticReconnect()
  removeSavedDescriptor()
  descriptor = null
  descriptorSource = null
  pairInput.value = ''
  connectButton.disabled = true
  await stopCurrentViewer()
  monitoringSection.hidden = true
  pairingSummary.textContent = 'Pairing forgotten. Open or paste a fresh headset link to pair again.'
  connectionState.textContent = 'Not paired; the saved credential was removed from this browser.'
  renderPublicDiscovery()
}

applyPairButton.addEventListener('click', () => void applyInputPairing())
pairInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') void applyInputPairing()
})
connectButton.addEventListener('click', () => void connect())
disconnectButton.addEventListener('click', () => void disconnect())
forgetPairingButton.addEventListener('click', () => void forgetPairing())

for (const button of commandButtons) {
  button.addEventListener('click', async () => {
    const name = button.dataset.command as SimpleRemoteCommandName
    if (
      name === 'abort_session' &&
      !window.confirm('Abort the active WebXR session? WebXR will stop further experiment progression and, if connected, ask the APK to preserve the interrupted ECG record.')
    ) {
      return
    }
    if (
      name === 'finalize_session' &&
      !window.confirm('Finalize and close the APK ECG recording?')
    ) {
      return
    }
    if (
      name === 'request_export' &&
      !window.confirm('Prepare the finalized ECG export on the headset? This does not transfer the file to this companion.')
    ) {
      return
    }
    try {
      await sendRemoteRequest(RemoteCommandRequestSchema.parse({ name, args: {} }))
    } catch (error) {
      commandResult.textContent = error instanceof Error ? error.message : String(error)
    }
  })
}

applyConfigurationButton.addEventListener('click', async () => {
  try {
    await sendRemoteRequest(RemoteCommandRequestSchema.parse({
      name: 'configure_study',
      args: {
        variantId: setupVariant.value,
        languageCode: setupLanguage.value,
        timingMode: setupTiming.value,
      },
    }))
  } catch (error) {
    commandResult.textContent = error instanceof Error ? error.message : String(error)
  }
})

startParticipantButton.addEventListener('click', async () => {
  try {
    const request = RemoteCommandRequestSchema.parse({
      name: 'start_participant',
      args: { participantId: participantInput.value },
    })
    if (await sendRemoteRequest(request)) participantInput.value = ''
  } catch (error) {
    commandResult.textContent = error instanceof Error
      ? 'Enter a participant code containing 1–32 letters, numbers, underscores, or hyphens.'
      : String(error)
  }
})
participantInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !startParticipantButton.disabled) {
    startParticipantButton.click()
  }
})

if (launchPairingFragment) {
  if (applyDescriptor(launchPairingFragment, 'link')) void connect()
} else {
  const restoredDescriptor = loadTrustedPairing()
  if (restoredDescriptor) {
    forgetPairingButton.disabled = false
    acceptDescriptor(restoredDescriptor, 'saved')
    void connect()
  } else {
    forgetPairingButton.disabled = true
  }
}

publicBeaconReceiver.addEventListener('statechange', (event) => {
  renderPublicDiscovery((event as CustomEvent<Study6PublicBeaconReceiverSnapshot>).detail)
})
publicBeaconReceiver.addEventListener('targetschange', (event) => {
  void maybeAutoConnectPublic(
    (event as CustomEvent<Study6PublicBeaconReceiverSnapshot>).detail,
  )
})
renderPublicDiscovery()
void publicBeaconReceiver.start()
  .then((snapshot) => maybeAutoConnectPublic(snapshot))
  .catch(() => {
    // The receiver's bounded state event already renders the public failure.
  })

window.addEventListener('pagehide', () => {
  connectionGeneration += 1
  connectInFlightGeneration = null
  publicSelectionGeneration += 1
  stopAutomaticReconnect()
  void viewer?.stop()
  void publicBeaconReceiver.stop()
}, { once: true })

import type { BridgeReceiptStage } from '../bridge/contract.ts'
import {
  remoteCommandToBrsp,
  STUDY6_BRSP_CAPABILITIES,
  STUDY6_BRSP_SCOPES,
  Study6BrspCommandResultSchema,
  study6BrspState,
} from './brsp-study6.ts'
import { Study6BrspVdoPeerTransport } from './brsp-vdo-peer-transport.ts'
import type {
  CompanionStatus,
  PairingDescriptor,
  RemoteCommandName,
} from './protocol.ts'
import {
  BRSPConnection,
  BRSP_STALE_MS,
  type BRSPAppliedBody,
  type JsonValue,
} from './vendor/browser-remote-sync-protocol/brsp.js'
import {
  createVdoSdk,
  eventDetail,
  loadVdoNinjaSdk,
  type VdoNinjaSdk,
  type VdoTrackDetail,
} from './vdo-sdk.ts'

export interface CommandAcknowledgement {
  commandId: string
  accepted: boolean
  code: string
  message: string
  stage?: BridgeReceiptStage
  /** Effective WebXR experiment revision, never the APK recorder revision. */
  resultingRevision?: number
}

export interface CompanionViewerSnapshot {
  phase: 'idle' | 'connecting' | 'connected' | 'error'
  message: string
  peerConnected: boolean
  controlProtocol: 'brsp/1'
  acceptedScopes: string[]
  stateStale: boolean
  commandGateBlocked: boolean
}

export interface CompanionViewerOptions {
  authenticationTimeoutMs?: number
}

function detailEvent<T>(type: string, detail: T): CustomEvent<T> {
  return new CustomEvent(type, { detail })
}

/** Phone/PC BRSP controller for the WebXR experiment target. */
export class CompanionViewer extends EventTarget {
  private readonly descriptor: PairingDescriptor
  private sdk: VdoNinjaSdk | null = null
  private transport: Study6BrspVdoPeerTransport | null = null
  private brsp: BRSPConnection<JsonValue> | null = null
  private phase: CompanionViewerSnapshot['phase'] = 'idle'
  private message = ''
  private latestRevision = 0
  private awaitingStatusCommandId: string | null = null
  private latestStatusCommandId: string | null = null
  private outcomeUnknown = false
  private hasFreshStatus = false
  private readonly pendingCommands = new Map<
    string,
    { name: RemoteCommandName; timer: number; timedOut: boolean }
  >()
  private stateStale = false
  private staleTimer: number | undefined
  private authenticationTimer: number | undefined
  private tearingDown = false
  private readonly authenticationTimeoutMs: number

  constructor(descriptor: PairingDescriptor, options: CompanionViewerOptions = {}) {
    super()
    this.descriptor = descriptor
    this.authenticationTimeoutMs = options.authenticationTimeoutMs ?? 10_000
  }

  snapshot(): CompanionViewerSnapshot {
    const brsp = this.brsp?.snapshot()
    return {
      phase: this.phase,
      message: this.message,
      peerConnected: brsp?.phase === 'ready',
      controlProtocol: 'brsp/1',
      acceptedScopes: brsp?.acceptedScopes ?? [],
      stateStale: this.stateStale,
      commandGateBlocked:
        !this.hasFreshStatus
        || this.stateStale
        || this.awaitingStatusCommandId !== null
        || this.outcomeUnknown,
    }
  }

  async connect(): Promise<void> {
    await this.stop()
    this.tearingDown = false
    this.phase = 'connecting'
    this.message = 'Connecting to the headset spectator stream and BRSP target…'
    this.emitState()
    try {
      const Constructor = await loadVdoNinjaSdk()
      const sdk = createVdoSdk(Constructor, this.descriptor.forceTurn, this.descriptor.key)
      this.sdk = sdk
      this.attachMediaListeners(sdk)
      const transport = new Study6BrspVdoPeerTransport({
        sdk,
        role: 'controller',
        streamId: this.descriptor.streamId,
      })
      this.transport = transport
      transport.start()
      this.brsp = this.createControllerConnection(transport)
      await sdk.connect()
      await sdk.joinRoom({ room: this.descriptor.room })
      await sdk.view(this.descriptor.streamId, {
        audio: false,
        video: this.descriptor.spectatorMedia,
        downloads: false,
        allowresources: false,
        label: 'Spatial Study 6 BRSP companion',
      })
      if (this.brsp.phase !== 'ready') {
        this.message = 'Data-only peer opened; waiting for BRSP mutual authentication…'
        this.authenticationTimer = window.setTimeout(() => {
          if (this.brsp?.phase === 'ready' || this.tearingDown) return
          void this.failAuthenticationTimeout()
        }, this.authenticationTimeoutMs)
        this.emitState()
      }
    } catch (error) {
      this.phase = 'error'
      this.message = error instanceof Error ? error.message : String(error)
      this.emitState()
      await this.disconnect()
      throw error
    }
  }

  async stop(): Promise<void> {
    this.tearingDown = true
    this.phase = 'idle'
    this.message = ''
    this.stateStale = false
    this.emitState()
    await this.disconnect()
  }

  async sendCommand(name: RemoteCommandName): Promise<string> {
    const connection = this.brsp
    if (!connection || connection.phase !== 'ready') {
      throw new Error('The authenticated BRSP control channel is not ready.')
    }
    if (name !== 'request_status' && !this.hasFreshStatus) {
      throw new Error('Waiting for the first authoritative WebXR status from this connection.')
    }
    if (name !== 'request_status' && this.stateStale) {
      throw new Error('Authoritative WebXR status is stale; refresh status before another command.')
    }
    if (name !== 'request_status' && this.awaitingStatusCommandId !== null) {
      throw new Error('Waiting for the authoritative WebXR state after the previous command.')
    }
    if (name !== 'request_status' && this.outcomeUnknown) {
      throw new Error('A previous command outcome is unknown; refresh authoritative status first.')
    }
    const route = remoteCommandToBrsp(name)
    const commandId = connection.sendCommand(route.scope, route.action, {}, {
      expectedRevision: this.latestRevision,
    })
    const timer = window.setTimeout(() => {
      const pending = this.pendingCommands.get(commandId)
      if (!pending || pending.timedOut) return
      pending.timedOut = true
      this.outcomeUnknown = true
      this.dispatchEvent(detailEvent<CommandAcknowledgement>('ack', {
        commandId,
        accepted: false,
        code: 'outcome_unknown',
        message: 'No applied receipt arrived; refresh authoritative status before another command.',
      }))
      this.emitState()
    }, 8_000)
    this.pendingCommands.set(commandId, { name, timer, timedOut: false })
    return Promise.resolve(commandId)
  }

  private createControllerConnection(
    transport: Study6BrspVdoPeerTransport,
  ): BRSPConnection<JsonValue> {
    const connection = new BRSPConnection<JsonValue>({
      transport,
      role: 'controller',
      sessionId: this.descriptor.room,
      sharedSecret: this.descriptor.key,
      peerId: `controller_${crypto.randomUUID()}`,
      capabilities: [...STUDY6_BRSP_CAPABILITIES],
      requestedScopes: [...STUDY6_BRSP_SCOPES],
    })
    connection.addEventListener('phasechange', (event) => {
      if (this.tearingDown) return
      if (event.detail.phase === 'authenticating') {
        this.message = 'BRSP transport connected; verifying mutual proof…'
      } else if (event.detail.phase === 'ready') {
        this.phase = 'connected'
        this.message = 'BRSP mutual proof verified; authoritative status is synchronized.'
      } else if (event.detail.phase === 'disconnected') {
        this.phase = 'error'
        this.message = 'The BRSP target disconnected; select Connect to authenticate a fresh epoch.'
      } else if (event.detail.phase === 'error') {
        this.phase = 'error'
        this.message = `BRSP protocol error: ${event.detail.message}`
      }
      this.emitState()
    })
    connection.addEventListener('ready', () => {
      if (this.authenticationTimer !== undefined) window.clearTimeout(this.authenticationTimer)
      this.authenticationTimer = undefined
      this.phase = 'connected'
      this.stateStale = false
      this.message = 'BRSP mutual proof verified; waiting for authoritative status…'
      this.startStaleMonitor()
      this.emitState()
    })
    connection.addEventListener('snapshot', (event) => {
      this.acceptStatus(event.detail.state, event.detail.revision)
    })
    connection.addEventListener('state', (event) => {
      this.acceptStatus(event.detail.state, event.detail.revision)
    })
    connection.addEventListener('commandapplied', (event) => {
      this.acceptApplied(event.detail)
    })
    connection.addEventListener('protocolerror', (event) => {
      if (this.tearingDown) return
      this.phase = 'error'
      this.message = `BRSP rejected the session: ${event.detail.message}`
      this.emitState()
    })
    return connection
  }

  private acceptStatus(value: JsonValue, envelopeRevision: number): void {
    let status: CompanionStatus
    try {
      status = study6BrspState(value)
    } catch {
      this.phase = 'error'
      this.message = 'The headset sent a status object outside the Study 6 schema.'
      this.emitState()
      return
    }
    if (status.revision !== envelopeRevision) {
      this.phase = 'error'
      this.message = 'The BRSP envelope and WebXR status revisions disagree.'
      this.emitState()
      return
    }
    if (status.revision < this.latestRevision) return
    this.hasFreshStatus = true
    this.latestRevision = status.revision
    this.latestStatusCommandId = status.remoteCommandReceiptId ?? null
    if (
      this.awaitingStatusCommandId !== null
      && this.latestStatusCommandId === this.awaitingStatusCommandId
    ) {
      this.awaitingStatusCommandId = null
    }
    this.stateStale = false
    this.message = 'Authenticated BRSP control and live status are synchronized.'
    this.dispatchEvent(detailEvent<CompanionStatus>('status', status))
    this.emitState()
  }

  private acceptApplied(applied: BRSPAppliedBody): void {
    const pending = this.pendingCommands.get(applied.commandId)
    if (!pending) {
      this.phase = 'error'
      this.message = 'The BRSP target sent an applied receipt for an unknown command.'
      this.outcomeUnknown = true
      this.emitState()
      return
    }
    const result = Study6BrspCommandResultSchema.safeParse(applied.result)
    if (!result.success) {
      window.clearTimeout(pending.timer)
      this.pendingCommands.delete(applied.commandId)
      this.outcomeUnknown = true
      this.dispatchEvent(detailEvent<CommandAcknowledgement>('ack', {
        commandId: applied.commandId,
        accepted: false,
        code: 'invalid_applied_result',
        message: 'The target acknowledgement did not match the Study 6 result schema.',
        resultingRevision: applied.revision,
      }))
      this.emitState()
      return
    }
    window.clearTimeout(pending.timer)
    this.pendingCommands.delete(applied.commandId)
    if (pending.name === 'request_status') this.outcomeUnknown = false
    // Keep relative/destructive controls closed until a state projection
    // explicitly names this command. WebXR and sensor-only effects can retain
    // the same experiment revision, and the latest-state lane is unordered, so
    // revision equality alone cannot prove post-command synchronization.
    this.awaitingStatusCommandId = this.latestStatusCommandId === applied.commandId
      ? null
      : applied.commandId
    this.dispatchEvent(detailEvent<CommandAcknowledgement>('ack', {
      commandId: applied.commandId,
      accepted: applied.ok,
      code: result.data.code,
      message: result.data.message,
      ...(result.data.stage ? { stage: result.data.stage } : {}),
      resultingRevision: applied.revision,
    }))
    this.emitState()
  }

  private attachMediaListeners(sdk: VdoNinjaSdk): void {
    sdk.addEventListener('track', (event) => {
      const detail = eventDetail<VdoTrackDetail>(event)
      if (detail.streamID && detail.streamID !== this.descriptor.streamId) return
      const stream = detail.streams?.[0]
        ?? (detail.track ? new MediaStream([detail.track]) : undefined)
      if (stream) this.dispatchEvent(detailEvent('stream', stream))
    })
    sdk.addEventListener('error', (event) => {
      if (this.tearingDown) return
      const detail = eventDetail<{ error?: unknown }>(event)
      this.message = detail.error instanceof Error
        ? detail.error.message
        : String(detail.error ?? 'VDO.Ninja transport error')
      this.emitState()
    })
  }

  private startStaleMonitor(): void {
    if (this.staleTimer !== undefined) window.clearInterval(this.staleTimer)
    this.staleTimer = window.setInterval(() => {
      const stale = this.brsp?.isStateStale(performance.now(), BRSP_STALE_MS) ?? false
      if (stale === this.stateStale) return
      this.stateStale = stale
      this.message = stale
        ? 'BRSP is connected, but authoritative status is stale.'
        : 'Authenticated BRSP control and live status are synchronized.'
      this.emitState()
    }, 500)
  }

  private async failAuthenticationTimeout(): Promise<void> {
    if (this.brsp?.phase === 'ready' || this.tearingDown) return
    this.tearingDown = true
    this.phase = 'error'
    this.message = 'BRSP authentication timed out; transport was closed. Connect again.'
    this.emitState()
    await this.disconnect()
    this.tearingDown = false
  }

  private async disconnect(): Promise<void> {
    if (this.authenticationTimer !== undefined) window.clearTimeout(this.authenticationTimer)
    this.authenticationTimer = undefined
    if (this.staleTimer !== undefined) window.clearInterval(this.staleTimer)
    this.staleTimer = undefined
    const brsp = this.brsp
    this.brsp = null
    const closeBrsp = brsp?.close().catch(() => undefined)
    const transport = this.transport
    this.transport = null
    transport?.stop()
    const sdk = this.sdk
    this.sdk = null
    const disconnectSdk = sdk
      ? Promise.resolve(sdk.disconnect()).catch(() => undefined)
      : undefined
    this.latestRevision = 0
    this.hasFreshStatus = false
    this.awaitingStatusCommandId = null
    this.latestStatusCommandId = null
    this.outcomeUnknown = false
    for (const pending of this.pendingCommands.values()) window.clearTimeout(pending.timer)
    this.pendingCommands.clear()
    await Promise.all([closeBrsp, disconnectSdk])
  }

  private emitState(): void {
    this.dispatchEvent(detailEvent('statechange', this.snapshot()))
  }
}

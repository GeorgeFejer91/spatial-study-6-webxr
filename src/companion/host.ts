import type { BridgeReceiptStage } from '../bridge/contract.ts'
import {
  brspToRemoteCommand,
  STUDY6_BRSP_CAPABILITIES,
  STUDY6_BRSP_SCOPES,
  Study6BrspCommandResultSchema,
  study6BrspState,
} from './brsp-study6.ts'
import { Study6BrspVdoPeerTransport } from './brsp-vdo-peer-transport.ts'
import {
  createPairingDescriptor,
  encodePairingDescriptor,
  type CompanionStatus,
  type PairingDescriptor,
  type RemoteCommandName,
} from './protocol.ts'
import {
  type BRSPCommandContext,
  type BRSPCommandOutcome,
  type JsonValue,
} from './vendor/browser-remote-sync-protocol/brsp.js'
import { Study6BrspConnection } from './brsp-connection.ts'
import {
  createVdoSdk,
  loadVdoNinjaSdk,
  type VdoNinjaSdk,
} from './vdo-sdk.ts'

export interface CommandDecision {
  accepted: boolean
  code: string
  message: string
  stage?: BridgeReceiptStage
  /** Recorder-provider revision only; never used as the WebXR/BRSP revision. */
  sensorRevision?: number
}

export interface CompanionHostOptions {
  getStatus: () => CompanionStatus
  handleCommand: (
    name: Exclude<RemoteCommandName, 'request_status'>,
    expectedRevision: number,
  ) => CommandDecision | Promise<CommandDecision>
  companionPageUrl?: URL
  frameRate?: number
  /** Deadline for a transport peer to complete BRSP mutual authentication. */
  authenticationTimeoutMs?: number
  /** Optional monitoring plane. BRSP remains data-only and independent. */
  spectatorMedia?: boolean
}

export interface CompanionHostSnapshot {
  phase: 'idle' | 'connecting' | 'broadcasting' | 'error'
  viewerCount: number
  pairingUrl: string | null
  message: string
  controlProtocol: 'brsp/1'
  acceptedScopes: string[]
}

function detailEvent<T>(type: string, detail: T): CustomEvent<T> {
  return new CustomEvent(type, { detail })
}

function errorToken(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_.:-]/gu, '_').slice(0, 64)
  return normalized || 'command_rejected'
}

/**
 * WebXR is the BRSP target and the sole experiment authority. The same VDO
 * peer carries spectator video, while BRSP control and latest-state traffic use
 * separate RTCDataChannels with distinct delivery semantics.
 */
export class CompanionHost extends EventTarget {
  private readonly options: CompanionHostOptions
  private sdk: VdoNinjaSdk | null = null
  private descriptor: PairingDescriptor | null = null
  private captureStream: MediaStream | null = null
  private transport: Study6BrspVdoPeerTransport | null = null
  private brsp: Study6BrspConnection<JsonValue> | null = null
  private phase: CompanionHostSnapshot['phase'] = 'idle'
  private message = ''
  private statusTimer: number | undefined
  private authenticationTimer: number | undefined
  private lastProcessedCommandId: string | null = null
  private lifecycleGeneration = 0

  constructor(options: CompanionHostOptions) {
    super()
    this.options = options
  }

  snapshot(): CompanionHostSnapshot {
    const brsp = this.brsp?.snapshot()
    return {
      phase: this.phase,
      viewerCount: brsp?.phase === 'ready' ? 1 : 0,
      pairingUrl: this.descriptor ? this.pairingUrl(this.descriptor).toString() : null,
      message: this.message,
      controlProtocol: 'brsp/1',
      acceptedScopes: brsp?.acceptedScopes ?? [],
    }
  }

  async start(canvas: HTMLCanvasElement, forceTurn = false): Promise<CompanionHostSnapshot> {
    const spectatorMedia = this.options.spectatorMedia === true
    if (spectatorMedia && (!('captureStream' in canvas) || typeof canvas.captureStream !== 'function')) {
      throw new Error('This browser cannot capture the WebXR spectator canvas.')
    }
    await this.stop()
    const generation = ++this.lifecycleGeneration
    this.phase = 'connecting'
    this.message = spectatorMedia
      ? 'Connecting optional spectator media and BRSP control to VDO.Ninja signaling…'
      : 'Connecting data-only BRSP control to VDO.Ninja signaling…'
    this.emitState()
    try {
      this.lastProcessedCommandId = null
      this.descriptor = createPairingDescriptor(forceTurn, undefined, spectatorMedia)
      const Constructor = await loadVdoNinjaSdk()
      const sdk = createVdoSdk(Constructor, forceTurn, this.descriptor.key)
      this.sdk = sdk
      const transport = new Study6BrspVdoPeerTransport({
        sdk,
        role: 'target',
        streamId: this.descriptor.streamId,
      })
      this.transport = transport
      transport.start()
      this.brsp = this.createTargetConnection(transport, this.descriptor)

      await sdk.connect()
      if (generation !== this.lifecycleGeneration) return this.snapshot()
      await sdk.joinRoom({ room: this.descriptor.room })
      if (generation !== this.lifecycleGeneration) return this.snapshot()
      if (spectatorMedia) {
        this.captureStream = canvas.captureStream(this.options.frameRate ?? 15)
        if (this.captureStream.getVideoTracks().length !== 1) {
          throw new Error('The spectator canvas did not produce a video track.')
        }
        await sdk.publish(this.captureStream, {
          streamID: this.descriptor.streamId,
          label: 'Spatial Study 6 optional spectator + BRSP target',
        })
      } else {
        await sdk.announce({
          streamID: this.descriptor.streamId,
          label: 'Spatial Study 6 data-only BRSP target',
        })
      }
      if (generation !== this.lifecycleGeneration) return this.snapshot()
      this.phase = 'broadcasting'
      this.message = 'Pairing is ready; waiting for one authenticated BRSP controller.'
      this.statusTimer = window.setInterval(() => this.broadcastStatus(), 1_000)
      this.emitState()
      return this.snapshot()
    } catch (error) {
      if (generation !== this.lifecycleGeneration) return this.snapshot()
      const message = error instanceof Error ? error.message : String(error)
      await this.disconnect()
      this.descriptor = null
      this.phase = 'error'
      this.message = message
      this.emitState()
      throw error
    }
  }

  async stop(): Promise<void> {
    this.lifecycleGeneration += 1
    this.descriptor = null
    this.phase = 'idle'
    this.message = ''
    this.emitState()
    await this.disconnect()
  }

  broadcastStatus(): void {
    if (this.brsp?.phase !== 'ready') return
    const status = this.authoritativeStatus()
    this.brsp.publishState(status as unknown as JsonValue, { revision: status.revision })
  }

  private createTargetConnection(
    transport: Study6BrspVdoPeerTransport,
    descriptor: PairingDescriptor,
  ): Study6BrspConnection<JsonValue> {
    const connection = new Study6BrspConnection<JsonValue>({
      transport,
      role: 'target',
      sessionId: descriptor.room,
      sharedSecret: descriptor.key,
      peerId: `target_${crypto.randomUUID()}`,
      capabilities: [...STUDY6_BRSP_CAPABILITIES],
      grantedScopes: this.options.getStatus().remoteControlEnabled
        ? [...STUDY6_BRSP_SCOPES]
        : ['study.status.read'],
      getState: () => this.authoritativeStatus() as unknown as JsonValue,
      applyCommand: (command) => this.applyBrspCommand(command),
    })
    connection.addEventListener('phasechange', (event) => {
      const detail = event.detail
      if (detail.phase === 'ready') {
        this.clearAuthenticationTimer()
        this.message = 'BRSP mutual proof verified; one controller has experiment access.'
      } else if (detail.phase === 'authenticating') {
        this.startAuthenticationTimer(connection)
        this.message = 'Controller transport connected; verifying BRSP mutual proof…'
      } else if (detail.phase === 'disconnected') {
        this.clearAuthenticationTimer()
        this.message = 'The BRSP controller disconnected; the WebXR experiment continues locally.'
      } else if (detail.phase === 'error') {
        this.clearAuthenticationTimer()
        this.message = `BRSP control error: ${detail.message}`
      }
      this.emitState()
    })
    connection.addEventListener('ready', () => {
      this.broadcastStatus()
      this.emitState()
    })
    connection.addEventListener('protocolerror', () => {
      void this.rearmControl(
        connection,
        'BRSP rejected the controller; pairing is rearmed with a fresh protocol epoch.',
      )
    })
    connection.addEventListener('peerclose', () => {
      void this.rearmControl(
        connection,
        'BRSP controller disconnected; pairing is rearmed with a fresh protocol epoch.',
      )
    })
    return connection
  }

  private async rearmControl(
    connection: Study6BrspConnection<JsonValue>,
    message: string,
  ): Promise<void> {
    const sdk = this.sdk
    const descriptor = this.descriptor
    if (
      this.phase !== 'broadcasting'
      || this.brsp !== connection
      || !sdk
      || !descriptor
    ) {
      return
    }
    this.clearAuthenticationTimer()
    this.brsp = null
    await connection.close().catch(() => undefined)
    this.transport?.stop()
    const transport = new Study6BrspVdoPeerTransport({
      sdk,
      role: 'target',
      streamId: descriptor.streamId,
    })
    this.transport = transport
    transport.start()
    this.brsp = this.createTargetConnection(transport, descriptor)
    this.message = message
    this.emitState()
  }

  private async applyBrspCommand(command: BRSPCommandContext): Promise<BRSPCommandOutcome> {
    const current = this.authoritativeStatus()
    const name = brspToRemoteCommand(command.scope, command.action, command.args)
    if (!name) {
      this.lastProcessedCommandId = command.commandId
      return {
        ok: false,
        revision: current.revision,
        result: {
          code: 'unsupported_command',
          message: 'The requested scope/action tuple is not in the Study 6 allowlist.',
        },
        error: 'unsupported_command',
      }
    }
    if (name !== 'request_status' && command.expectedRevision === null) {
      this.lastProcessedCommandId = command.commandId
      return {
        ok: false,
        revision: current.revision,
        result: {
          code: 'expected_revision_required',
          message: 'A WebXR revision is required for state-changing commands.',
        },
        error: 'expected_revision_required',
      }
    }
    if (name !== 'request_status' && command.expectedRevision !== current.revision) {
      this.lastProcessedCommandId = command.commandId
      return {
        ok: false,
        revision: current.revision,
        result: {
          code: 'stale_revision',
          message: 'The WebXR state changed; use the fresh authoritative status and retry.',
        },
        error: 'stale_revision',
      }
    }

    let decision: CommandDecision
    if (name === 'request_status') {
      decision = {
        accepted: true,
        code: 'status_requested',
        message: 'Fresh privacy-minimized status published.',
      }
    } else {
      try {
        decision = await this.options.handleCommand(name, command.expectedRevision as number)
      } catch {
        decision = {
          accepted: false,
          code: 'command_handler_failed',
          message: 'WebXR could not apply the command.',
        }
      }
    }

    const effective = this.authoritativeStatus()
    // Set the correlation marker only after the application decision is
    // complete. The BRSP core sends its applied receipt and then publishes a
    // fresh state carrying this exact command ID.
    this.lastProcessedCommandId = command.commandId
    const code = errorToken(decision.code)
    const result = Study6BrspCommandResultSchema.parse({
      code,
      message: decision.message.slice(0, 240),
      ...(decision.stage ? { stage: decision.stage } : {}),
      ...(decision.sensorRevision === undefined
        ? {}
        : { sensorRevision: decision.sensorRevision }),
    })
    return {
      ok: decision.accepted,
      revision: effective.revision,
      result: result as unknown as JsonValue,
      error: decision.accepted ? null : code,
    }
  }

  private async disconnect(): Promise<void> {
    this.clearAuthenticationTimer()
    if (this.statusTimer !== undefined) window.clearInterval(this.statusTimer)
    this.statusTimer = undefined
    const brsp = this.brsp
    this.brsp = null
    const closeBrsp = brsp?.close().catch(() => undefined)
    const transport = this.transport
    this.transport = null
    transport?.stop()
    const captureStream = this.captureStream
    this.captureStream = null
    for (const track of captureStream?.getTracks() ?? []) track.stop()
    const sdk = this.sdk
    this.sdk = null
    const disconnectSdk = sdk
      ? Promise.resolve(sdk.disconnect()).catch(() => undefined)
      : undefined
    await Promise.all([closeBrsp, disconnectSdk])
  }

  private startAuthenticationTimer(connection: Study6BrspConnection<JsonValue>): void {
    this.clearAuthenticationTimer()
    this.authenticationTimer = window.setTimeout(() => {
      this.authenticationTimer = undefined
      void this.rearmControl(
        connection,
        'BRSP authentication timed out; pairing is rearmed with a fresh protocol epoch.',
      )
    }, this.options.authenticationTimeoutMs ?? 10_000)
  }

  private clearAuthenticationTimer(): void {
    if (this.authenticationTimer !== undefined) {
      window.clearTimeout(this.authenticationTimer)
      this.authenticationTimer = undefined
    }
  }

  private authoritativeStatus(): CompanionStatus {
    return study6BrspState({
      ...this.options.getStatus(),
      remoteCommandReceiptId: this.lastProcessedCommandId,
    })
  }

  private pairingUrl(descriptor: PairingDescriptor): URL {
    const page = this.options.companionPageUrl
      ?? new URL(`${import.meta.env.BASE_URL}companion.html`, location.origin)
    const url = new URL(page)
    url.hash = `pair=${encodePairingDescriptor(descriptor)}`
    return url
  }

  private emitState(): void {
    this.dispatchEvent(detailEvent('statechange', this.snapshot()))
  }
}

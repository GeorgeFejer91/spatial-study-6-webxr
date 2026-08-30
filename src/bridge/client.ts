import {
  bridgeReceiptStageIndex,
  disconnectedPolarStatus,
  parseBridgeInboundEnvelope,
  parseBridgeExperimentMarker,
  PLACEHOLDER_STIMULUS_MODE,
  polarProjectionFromSnapshot,
  polarProjectionFromStatus,
  STUDY_BRIDGE_PROTOCOL,
  STUDY_BRIDGE_SCHEMA_REVISION,
  type BridgeCommandPayload,
  type BridgeEnvelope,
  type BridgeErrorPayload,
  type BridgeExperimentMarker,
  type BridgeHelloPayload,
  type BridgeInboundEnvelope,
  type BridgeSensorAction,
  type BridgeOutboundEnvelope,
  type BridgeReceiptPayload,
  type BridgeReceiptStage,
  type BridgeSnapshotPayload,
  type PolarStatusProjection,
} from './contract.ts'
import {
  resolveStudyBridgeLaunchConfig,
  WebSocketStudyBridgeTransport,
  type BridgeTransportState,
  type StudyBridgeTransport,
} from './transport.ts'

export interface StudyBridgeProjection {
  connection: BridgeTransportState
  connectionDetail: string
  sensorConnected: boolean
  sessionId: string | null
  bridgeProcessEpoch: string | null
  browserPageEpoch: string
  transportEpoch: string
  revision: number
  awaitingSnapshotRevision: number | null
  snapshot: BridgeSnapshotPayload | null
  polar: PolarStatusProjection
  lastReceipt: BridgeReceiptPayload | null
  lastError: BridgeErrorPayload | null
}

export interface BridgeCommandResult {
  commandId: string
  accepted: boolean
  stage: BridgeReceiptStage
  code: string
  detail: string
  resultingRevision: number
}

interface PendingCommand {
  targetStage: BridgeReceiptStage
  highestStageIndex: number
  bridgeProcessEpoch: string
  resolve: (result: BridgeCommandResult) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  waitingForSnapshotRevision: number | null
  result: BridgeCommandResult | null
}

export interface StudyBridgeClientOptions {
  transport: StudyBridgeTransport
  browserPageEpoch?: string
  browserInstanceId?: string
  buildId?: string
  commandTimeoutMs?: number
  createId?: () => string
}

function createId(): string {
  return crypto.randomUUID()
}

function cloneProjection(projection: StudyBridgeProjection): StudyBridgeProjection {
  return {
    ...projection,
    snapshot: projection.snapshot ? structuredClone(projection.snapshot) : null,
    polar: structuredClone(projection.polar),
    lastReceipt: projection.lastReceipt ? structuredClone(projection.lastReceipt) : null,
    lastError: projection.lastError ? structuredClone(projection.lastError) : null,
  }
}

export class StudyBridgeClient {
  private readonly transport: StudyBridgeTransport
  private readonly browserInstanceId: string
  private readonly buildId: string
  private readonly commandTimeoutMs: number
  private readonly createId: () => string
  private readonly listeners = new Set<(projection: StudyBridgeProjection) => void>()
  private readonly pending = new Map<string, PendingCommand>()
  private commandOperation: Promise<unknown> = Promise.resolve()
  private readonly unsubscribeTransport: () => void
  private projection: StudyBridgeProjection
  private polarFreshnessTimer: ReturnType<typeof setTimeout> | null = null
  private polarFreshnessGeneration = 0
  private handshakeComplete = false

  constructor(options: StudyBridgeClientOptions) {
    this.transport = options.transport
    this.createId = options.createId ?? createId
    this.browserInstanceId = options.browserInstanceId ?? this.createId()
    this.buildId = options.buildId ?? 'webxr-placeholder-rehearsal'
    this.commandTimeoutMs = options.commandTimeoutMs ?? 10_000
    this.projection = {
      connection: this.transport.state,
      connectionDetail: 'Sensor bridge has not connected.',
      sensorConnected: false,
      sessionId: null,
      bridgeProcessEpoch: null,
      browserPageEpoch: options.browserPageEpoch ?? this.createId(),
      transportEpoch: this.createId(),
      revision: 0,
      awaitingSnapshotRevision: null,
      snapshot: null,
      polar: disconnectedPolarStatus(),
      lastReceipt: null,
      lastError: null,
    }
    this.unsubscribeTransport = this.transport.subscribe((event) => {
      if (event.type === 'message') {
        this.receive(event.value)
        return
      }
      this.projection = {
        ...this.projection,
        connection: event.state,
        connectionDetail: event.detail,
        sensorConnected: event.state === 'open' && this.handshakeComplete,
        polar:
          event.state === 'closed' || event.state === 'fault'
            ? disconnectedPolarStatus(event.detail)
            : this.projection.polar,
      }
      if (event.state === 'closed' || event.state === 'fault') {
        this.handshakeComplete = false
        this.clearPolarFreshnessTimer()
        this.rejectPending(new Error(event.detail))
      }
      this.emit()
    })
  }

  snapshot(): StudyBridgeProjection {
    return cloneProjection(this.projection)
  }

  subscribe(listener: (projection: StudyBridgeProjection) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => this.listeners.delete(listener)
  }

  async connect(): Promise<void> {
    await this.transport.connect()
    const helloPayload: BridgeHelloPayload = {
      schemaRevision: STUDY_BRIDGE_SCHEMA_REVISION,
      buildId: this.buildId,
      capabilities: [
        'webxr_experiment_authority',
        'polar_status_projection',
        'experiment_metadata_markers',
        PLACEHOLDER_STIMULUS_MODE,
      ],
      authority: 'webxr_experiment_owner',
    }
    this.transport.send(this.envelope('hello', 'apk', helloPayload))
  }

  applySensorAction(
    action: Exclude<BridgeSensorAction, 'record_experiment_marker'>,
    targetStage: BridgeReceiptStage = 'persisted',
  ): Promise<BridgeCommandResult> {
    return this.command({ action }, targetStage)
  }

  recordExperimentMarker(
    marker: BridgeExperimentMarker,
    targetStage: BridgeReceiptStage = 'persisted',
  ): Promise<BridgeCommandResult> {
    return this.command(
      { action: 'record_experiment_marker', marker: parseBridgeExperimentMarker(marker) },
      targetStage,
    )
  }

  close(): void {
    this.clearPolarFreshnessTimer()
    this.rejectPending(new Error('Sensor bridge client closed.'))
    this.unsubscribeTransport()
    this.transport.close()
    this.listeners.clear()
  }

  private command(
    payload: BridgeCommandPayload,
    targetStage: BridgeReceiptStage,
  ): Promise<BridgeCommandResult> {
    const next = this.commandOperation.then(() => this.issueCommand(payload, targetStage))
    this.commandOperation = next.catch(() => undefined)
    return next
  }

  private issueCommand(
    payload: BridgeCommandPayload,
    targetStage: BridgeReceiptStage,
  ): Promise<BridgeCommandResult> {
    if (!this.projection.sensorConnected || !this.projection.bridgeProcessEpoch) {
      return Promise.reject(new Error('APK sensor recorder is not connected.'))
    }
    if (this.projection.awaitingSnapshotRevision !== null && payload.action !== 'request_status') {
      return Promise.reject(
        new Error(
          `Canonical snapshot revision ${this.projection.awaitingSnapshotRevision} is still pending; command outcome is unknown.`,
        ),
      )
    }
    const commandId = this.createId()
    const envelope = this.envelope('command', 'apk', payload, {
      messageId: commandId,
      expectedRevision: this.projection.revision,
    })
    const promise = new Promise<BridgeCommandResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId)
        reject(
          new Error(
            `Bridge command ${commandId} timed out before ${targetStage} plus its recorder snapshot.`,
          ),
        )
      }, this.commandTimeoutMs)
      this.pending.set(commandId, {
        targetStage,
        highestStageIndex: -1,
        bridgeProcessEpoch: this.projection.bridgeProcessEpoch!,
        waitingForSnapshotRevision: null,
        result: null,
        resolve,
        reject,
        timer,
      })
    })
    try {
      this.transport.send(envelope)
    } catch (error) {
      const pending = this.pending.get(commandId)
      if (pending) {
        clearTimeout(pending.timer)
        this.pending.delete(commandId)
        pending.reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
    return promise
  }

  private receive(value: unknown): void {
    let message: BridgeInboundEnvelope
    try {
      message = parseBridgeInboundEnvelope(value)
    } catch (error) {
      this.projection = {
        ...this.projection,
        connectionDetail: error instanceof Error ? error.message : String(error),
      }
      this.emit()
      return
    }
    if (message.transportEpoch !== this.projection.transportEpoch) {
      this.projection = {
        ...this.projection,
        connectionDetail: 'Ignored a message from a stale bridge transport epoch.',
      }
      this.emit()
      return
    }
    if (
      message.browserPageEpoch !== undefined &&
      message.browserPageEpoch !== this.projection.browserPageEpoch
    ) {
      this.projection = {
        ...this.projection,
        connectionDetail: 'Ignored a message addressed to a stale browser page.',
      }
      this.emit()
      return
    }

    const previousEpoch = this.projection.bridgeProcessEpoch
    if (previousEpoch !== null && previousEpoch !== message.bridgeProcessEpoch) {
      if (message.type !== 'hello') {
        this.projection = {
          ...this.projection,
          connectionDetail: 'Ignored a non-hello message from an unbound APK process epoch.',
        }
        this.emit()
        return
      }
      this.rejectPending(new Error('APK bridge process restarted before command completion.'))
      this.projection = {
        ...this.projection,
        sessionId: null,
        revision: 0,
        awaitingSnapshotRevision: null,
        snapshot: null,
        polar: disconnectedPolarStatus('APK bridge process restarted; awaiting a fresh snapshot.'),
        lastReceipt: null,
      }
    }
    if (!this.handshakeComplete && message.type !== 'hello') {
      this.projection = {
        ...this.projection,
        connectionDetail: 'Ignored APK data received before the sensor-provider hello.',
      }
      this.emit()
      return
    }
    if (message.type === 'hello') {
      if (message.payload.authority !== 'sensor_recorder_provider') {
        this.projection = {
          ...this.projection,
          connectionDetail: 'Rejected a hello that did not identify the APK sensor recorder.',
        }
        this.emit()
        return
      }
      this.handshakeComplete = true
    }
    this.projection = {
      ...this.projection,
      sensorConnected: this.handshakeComplete,
      bridgeProcessEpoch: message.bridgeProcessEpoch,
      sessionId: message.sessionId ?? this.projection.sessionId,
      connectionDetail: 'APK sensor recorder connected.',
    }

    switch (message.type) {
      case 'hello':
        this.emit()
        return
      case 'snapshot':
        this.receiveSnapshot(message)
        return
      case 'polar_status':
        if (message.revision < this.projection.revision) return
        this.projection = {
          ...this.projection,
          polar: polarProjectionFromStatus(message.payload, this.projection.polar),
        }
        this.schedulePolarFreshnessDowngrade(this.projection.polar)
        this.emit()
        return
      case 'receipt':
        this.receiveReceipt(message)
        return
      case 'error':
        this.receiveError(message)
        return
    }
  }

  private receiveSnapshot(message: BridgeEnvelope<'snapshot', BridgeSnapshotPayload>): void {
    if (message.revision < this.projection.revision) return
    if (message.payload.recording.revision !== message.revision) {
      this.projection = {
        ...this.projection,
        connectionDetail:
          'Rejected an APK snapshot whose recording revision did not match its envelope.',
      }
      this.emit()
      return
    }
    const polar = polarProjectionFromSnapshot(message.payload)
    this.projection = {
      ...this.projection,
      revision: message.revision,
      sessionId: message.sessionId ?? this.projection.sessionId,
      snapshot: message.payload,
      polar,
      lastError: null,
      awaitingSnapshotRevision:
        this.projection.awaitingSnapshotRevision !== null &&
        message.revision < this.projection.awaitingSnapshotRevision
          ? this.projection.awaitingSnapshotRevision
          : null,
    }
    this.schedulePolarFreshnessDowngrade(polar)
    this.resolveSnapshotBoundCommands(message.revision)
    this.emit()
  }

  private receiveReceipt(message: BridgeEnvelope<'receipt', BridgeReceiptPayload>): void {
    const receipt = message.payload
    this.projection = { ...this.projection, lastReceipt: receipt }
    const pending = this.pending.get(receipt.commandMessageId)
    if (!pending) {
      this.emit()
      return
    }
    if (pending.bridgeProcessEpoch !== message.bridgeProcessEpoch) return
    const stageIndex = bridgeReceiptStageIndex(receipt.stage)
    if (stageIndex < pending.highestStageIndex) return
    pending.highestStageIndex = stageIndex

    if (stageIndex >= bridgeReceiptStageIndex(pending.targetStage)) {
      const result: BridgeCommandResult = {
        commandId: receipt.commandMessageId,
        accepted: true,
        stage: receipt.stage,
        code: receipt.outcome,
        detail: receipt.detail ?? '',
        resultingRevision: receipt.effectiveRevision,
      }
      if (receipt.effectiveRevision > this.projection.revision) {
        pending.waitingForSnapshotRevision = receipt.effectiveRevision
        pending.result = result
        this.projection = {
          ...this.projection,
          awaitingSnapshotRevision: Math.max(
            this.projection.awaitingSnapshotRevision ?? 0,
            receipt.effectiveRevision,
          ),
        }
      } else {
        clearTimeout(pending.timer)
        this.pending.delete(receipt.commandMessageId)
        pending.resolve(result)
      }
    }
    this.emit()
  }

  private receiveError(message: BridgeEnvelope<'error', BridgeErrorPayload>): void {
    this.projection = {
      ...this.projection,
      lastError: message.payload,
      connectionDetail: message.payload.detail,
    }
    if (message.correlationId) {
      const pending = this.pending.get(message.correlationId)
      if (pending) {
        clearTimeout(pending.timer)
        this.pending.delete(message.correlationId)
        pending.reject(new Error(`${message.payload.code}: ${message.payload.detail}`))
      }
    }
    this.emit()
  }

  private envelope<TType extends 'hello' | 'command', TPayload>(
    type: TType,
    target: 'apk',
    payload: TPayload,
    overrides: { messageId?: string; expectedRevision?: number } = {},
  ): Extract<BridgeOutboundEnvelope, { type: TType }> {
    return {
      protocol: STUDY_BRIDGE_PROTOCOL,
      bridgeProcessEpoch: this.projection.bridgeProcessEpoch ?? 'unbound',
      browserPageEpoch: this.projection.browserPageEpoch,
      transportEpoch: this.projection.transportEpoch,
      revision: this.projection.revision,
      messageId: overrides.messageId ?? this.createId(),
      ...(this.projection.sessionId === null ? {} : { sessionId: this.projection.sessionId }),
      ...(overrides.expectedRevision === undefined
        ? {}
        : { expectedRevision: overrides.expectedRevision }),
      sender: { role: 'webxr', instanceId: this.browserInstanceId },
      target,
      type,
      payload,
    } as unknown as Extract<BridgeOutboundEnvelope, { type: TType }>
  }

  private rejectPending(error: Error): void {
    this.pending.forEach((pending) => {
      clearTimeout(pending.timer)
      pending.reject(error)
    })
    this.pending.clear()
  }

  private resolveSnapshotBoundCommands(snapshotRevision: number): void {
    this.pending.forEach((pending, commandId) => {
      if (
        pending.waitingForSnapshotRevision === null ||
        pending.waitingForSnapshotRevision > snapshotRevision ||
        pending.result === null
      ) {
        return
      }
      clearTimeout(pending.timer)
      this.pending.delete(commandId)
      pending.resolve(pending.result)
    })
  }

  private schedulePolarFreshnessDowngrade(polar: PolarStatusProjection): void {
    this.clearPolarFreshnessTimer()
    const generation = ++this.polarFreshnessGeneration
    if (polar.lastSampleAgeMs === null || polar.phase !== 'streaming') return
    const delayMs = Math.max(0, 2_001 - polar.lastSampleAgeMs)
    this.polarFreshnessTimer = setTimeout(() => {
      if (generation !== this.polarFreshnessGeneration) return
      this.polarFreshnessTimer = null
      this.projection = {
        ...this.projection,
        polar: {
          ...this.projection.polar,
          ready: false,
          readinessReason: 'Sensor status is stale; waiting for a fresh APK observation.',
          lastSampleAgeMs: 2_001,
        },
      }
      this.emit()
    }, delayMs)
  }

  private clearPolarFreshnessTimer(): void {
    this.polarFreshnessGeneration += 1
    if (this.polarFreshnessTimer !== null) clearTimeout(this.polarFreshnessTimer)
    this.polarFreshnessTimer = null
  }

  private emit(): void {
    const projection = this.snapshot()
    this.listeners.forEach((listener) => listener(projection))
  }
}

export function createDefaultStudyBridgeClient(): StudyBridgeClient {
  const launch = resolveStudyBridgeLaunchConfig(window.location)
  if (launch.fromFragment) {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/u, ''))
    fragment.delete('bridgeWs')
    fragment.delete('bridgeToken')
    const suffix = fragment.size > 0 ? `#${fragment.toString()}` : ''
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}${suffix}`,
    )
  }
  return new StudyBridgeClient({
    transport: new WebSocketStudyBridgeTransport({ url: launch.url }),
  })
}

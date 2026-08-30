import {
  bridgeReceiptStageIndex,
  disconnectedPolarStatus,
  missingRequiredApkBridgeCapabilities,
  parseBridgeInboundEnvelope,
  parseBridgeExperimentMarker,
  parseBridgeOutboundEnvelope,
  PLACEHOLDER_STIMULUS_MODE,
  polarProjectionFromSnapshot,
  polarProjectionFromStatus,
  STUDY_BRIDGE_PROTOCOL,
  STUDY_BRIDGE_SCHEMA_REVISION,
  type BridgeCommandPayload,
  type BridgeEnvelope,
  type BridgeErrorPayload,
  type BridgeExperimentMarker,
  type BridgeInboundEnvelope,
  type BridgeSensorAction,
  type BridgeOutboundEnvelope,
  type BridgeReceiptPayload,
  type BridgeReceiptStage,
  type BridgeSnapshotPayload,
  type PolarStatusProjection,
  type WebXrBridgeHelloPayload,
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
  bridgeLaunch?: string
  browserPageEpoch?: string
  browserInstanceId?: string
  buildId?: string
  commandTimeoutMs?: number
  handshakeTimeoutMs?: number
  reconnectDelaysMs?: readonly number[]
  createId?: () => string
}

const DEFAULT_RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const

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
  private readonly bridgeLaunch: string
  private readonly buildId: string
  private readonly commandTimeoutMs: number
  private readonly handshakeTimeoutMs: number
  private readonly reconnectDelaysMs: readonly number[]
  private readonly createId: () => string
  private readonly listeners = new Set<(projection: StudyBridgeProjection) => void>()
  private readonly pending = new Map<string, PendingCommand>()
  private commandOperation: Promise<unknown> = Promise.resolve()
  private readonly unsubscribeTransport: () => void
  private projection: StudyBridgeProjection
  private polarFreshnessTimer: ReturnType<typeof setTimeout> | null = null
  private polarFreshnessGeneration = 0
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null
  private handshakeGeneration = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private reconnectGeneration = 0
  private lifecycleGeneration = 0
  private connectOperation: Promise<void> | null = null
  private connectionDesired = false
  private stopped = false
  private helloAccepted = false
  private handshakeComplete = false

  constructor(options: StudyBridgeClientOptions) {
    this.transport = options.transport
    this.createId = options.createId ?? createId
    this.browserInstanceId = options.browserInstanceId ?? this.createId()
    this.bridgeLaunch = options.bridgeLaunch ?? 'standalone-webxr-launch'
    if (!/^[A-Za-z0-9_-]{16,96}$/u.test(this.bridgeLaunch)) {
      throw new Error('bridgeLaunch must be 16 to 96 base64url characters.')
    }
    this.buildId = options.buildId ?? 'webxr-placeholder-rehearsal'
    this.commandTimeoutMs = options.commandTimeoutMs ?? 10_000
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? 5_000
    if (
      !Number.isSafeInteger(this.handshakeTimeoutMs) ||
      this.handshakeTimeoutMs < 1 ||
      this.handshakeTimeoutMs > 60_000
    ) {
      throw new Error('handshakeTimeoutMs must be from 1 through 60000 milliseconds.')
    }
    this.reconnectDelaysMs = options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS
    if (
      this.reconnectDelaysMs.length === 0 ||
      this.reconnectDelaysMs.some(
        (delay) => !Number.isSafeInteger(delay) || delay < 0 || delay > 60_000,
      )
    ) {
      throw new Error('reconnectDelaysMs must contain delays from 0 through 60000 milliseconds.')
    }
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
      const unavailable = event.state === 'closed' || event.state === 'fault'
      this.projection = {
        ...this.projection,
        connection: event.state,
        connectionDetail: event.detail,
        sensorConnected: event.state === 'open' && this.handshakeComplete,
        ...(unavailable
          ? {
              awaitingSnapshotRevision: null,
              snapshot: null,
              polar: disconnectedPolarStatus(event.detail),
            }
          : {}),
      }
      if (unavailable) {
        this.helloAccepted = false
        this.handshakeComplete = false
        this.clearHandshakeTimer()
        this.clearPolarFreshnessTimer()
        this.rejectPending(new Error(event.detail))
      }
      this.emit()
      if (unavailable) this.scheduleReconnect(event.detail)
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
    if (this.stopped) throw new Error('Sensor bridge client is closed.')
    this.connectionDesired = true
    if (this.transport.state === 'open' || this.handshakeComplete) return
    await this.startTransportAttempt(false)
  }

  private sendHello(): void {
    const helloPayload: WebXrBridgeHelloPayload = {
      schemaRevision: STUDY_BRIDGE_SCHEMA_REVISION,
      buildId: this.buildId,
      capabilities: [
        'webxr_experiment_authority',
        'polar_status_projection',
        'experiment_metadata_markers',
        'begin_recording',
        'session_owned_recording',
        'durable_markers',
        PLACEHOLDER_STIMULUS_MODE,
      ],
      authority: 'webxr_experiment_owner',
      bridgeLaunch: this.bridgeLaunch,
    }
    this.transport.send(parseBridgeOutboundEnvelope(this.envelope('hello', 'apk', helloPayload)))
  }

  applySensorAction(
    action: Exclude<BridgeSensorAction, 'begin_recording' | 'record_experiment_marker'>,
    targetStage: BridgeReceiptStage = 'persisted',
  ): Promise<BridgeCommandResult> {
    return this.command({ action }, targetStage)
  }

  beginRecording(
    sessionId: string,
    webxrRevision: number,
    recordingRequestId: string,
    targetStage: BridgeReceiptStage = 'observed',
  ): Promise<BridgeCommandResult> {
    return this.command(
      { action: 'begin_recording', sessionId, webxrRevision, recordingRequestId },
      targetStage,
      sessionId,
    )
  }

  recordExperimentMarker(
    marker: BridgeExperimentMarker,
    targetStage: BridgeReceiptStage = 'persisted',
  ): Promise<BridgeCommandResult> {
    const parsedMarker = parseBridgeExperimentMarker(marker)
    return this.command(
      { action: 'record_experiment_marker', marker: parsedMarker },
      targetStage,
      parsedMarker.sessionId ?? null,
    )
  }

  close(): void {
    if (this.stopped) return
    this.stopped = true
    this.connectionDesired = false
    this.lifecycleGeneration += 1
    this.clearReconnectTimer()
    this.clearHandshakeTimer()
    this.clearPolarFreshnessTimer()
    this.rejectPending(new Error('Sensor bridge client closed.'))
    this.unsubscribeTransport()
    this.transport.close()
    this.listeners.clear()
  }

  private command(
    payload: BridgeCommandPayload,
    targetStage: BridgeReceiptStage,
    sessionIdOverride?: string | null,
  ): Promise<BridgeCommandResult> {
    const next = this.commandOperation.then(() =>
      this.issueCommand(payload, targetStage, sessionIdOverride),
    )
    this.commandOperation = next.catch(() => undefined)
    return next
  }

  private issueCommand(
    payload: BridgeCommandPayload,
    targetStage: BridgeReceiptStage,
    sessionIdOverride?: string | null,
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
      sessionId: sessionIdOverride,
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
      this.transport.send(parseBridgeOutboundEnvelope(envelope))
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
    if (this.transport.state !== 'open') return
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
    if (!this.helloAccepted && message.type !== 'hello') {
      this.projection = {
        ...this.projection,
        connectionDetail: 'Ignored APK data received before the sensor-provider hello.',
      }
      this.emit()
      return
    }
    if (!this.handshakeComplete && message.type !== 'hello' && message.type !== 'snapshot') {
      this.projection = {
        ...this.projection,
        connectionDetail: 'Ignored APK data received before the fresh canonical snapshot.',
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
      const missingCapabilities = missingRequiredApkBridgeCapabilities(
        message.payload.capabilities,
      )
      if (missingCapabilities.length > 0) {
        this.helloAccepted = false
        this.handshakeComplete = false
        this.projection = {
          ...this.projection,
          sensorConnected: false,
          connectionDetail: `Rejected APK hello missing required capabilities: ${missingCapabilities.join(', ')}.`,
        }
        this.emit()
        return
      }
      this.helloAccepted = true
      this.handshakeComplete = false
      this.projection = {
        ...this.projection,
        sensorConnected: false,
        bridgeProcessEpoch: message.bridgeProcessEpoch,
        sessionId: message.sessionId ?? this.projection.sessionId,
        connectionDetail: 'APK hello accepted; awaiting a fresh canonical recorder snapshot.',
      }
      this.emit()
      return
    }
    this.projection = {
      ...this.projection,
      sensorConnected: this.handshakeComplete,
      bridgeProcessEpoch: message.bridgeProcessEpoch,
      sessionId: message.sessionId ?? this.projection.sessionId,
      connectionDetail: this.handshakeComplete
        ? 'APK sensor recorder connected.'
        : 'APK hello accepted; awaiting a fresh canonical recorder snapshot.',
    }

    switch (message.type) {
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
    this.handshakeComplete = true
    this.projection = {
      ...this.projection,
      sensorConnected: this.transport.state === 'open',
      connectionDetail: 'APK sensor recorder connected.',
      revision: message.revision,
      sessionId:
        message.sessionId ??
        message.payload.recording.ownerSessionId ??
        this.projection.sessionId,
      snapshot: message.payload,
      polar,
      lastError: null,
      awaitingSnapshotRevision:
        this.projection.awaitingSnapshotRevision !== null &&
        message.revision < this.projection.awaitingSnapshotRevision
          ? this.projection.awaitingSnapshotRevision
          : null,
    }
    this.reconnectAttempt = 0
    this.clearReconnectTimer()
    this.clearHandshakeTimer()
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
    overrides: {
      messageId?: string
      expectedRevision?: number
      sessionId?: string | null
    } = {},
  ): Extract<BridgeOutboundEnvelope, { type: TType }> {
    const sessionId =
      'sessionId' in overrides ? overrides.sessionId : this.projection.sessionId
    return {
      protocol: STUDY_BRIDGE_PROTOCOL,
      bridgeProcessEpoch: this.projection.bridgeProcessEpoch ?? 'unbound',
      browserPageEpoch: this.projection.browserPageEpoch,
      transportEpoch: this.projection.transportEpoch,
      revision: this.projection.revision,
      messageId: overrides.messageId ?? this.createId(),
      ...(sessionId == null ? {} : { sessionId }),
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

  private scheduleHandshakeDeadline(): void {
    this.clearHandshakeTimer()
    const generation = this.handshakeGeneration
    const lifecycleGeneration = this.lifecycleGeneration
    this.handshakeTimer = setTimeout(() => {
      if (
        this.stopped ||
        this.handshakeComplete ||
        generation !== this.handshakeGeneration ||
        lifecycleGeneration !== this.lifecycleGeneration
      ) {
        return
      }
      this.handshakeTimer = null
      this.projection = {
        ...this.projection,
        sensorConnected: false,
        connectionDetail:
          'APK bridge handshake timed out before a fresh hello and canonical snapshot.',
      }
      this.emit()
      this.transport.close(4000, 'APK hello/snapshot handshake timed out')
    }, this.handshakeTimeoutMs)
  }

  private clearHandshakeTimer(): void {
    this.handshakeGeneration += 1
    if (this.handshakeTimer !== null) clearTimeout(this.handshakeTimer)
    this.handshakeTimer = null
  }

  private startTransportAttempt(reconnecting: boolean): Promise<void> {
    if (this.stopped) return Promise.reject(new Error('Sensor bridge client is closed.'))
    if (this.connectOperation) return this.connectOperation

    const lifecycleGeneration = this.lifecycleGeneration
    if (reconnecting) {
      this.helloAccepted = false
      this.handshakeComplete = false
      this.projection = {
        ...this.projection,
        sensorConnected: false,
        sessionId: null,
        bridgeProcessEpoch: null,
        transportEpoch: this.createId(),
        revision: 0,
        awaitingSnapshotRevision: null,
        snapshot: null,
        polar: disconnectedPolarStatus('Reconnecting to the APK sensor recorder.'),
        lastReceipt: null,
        lastError: null,
      }
      this.emit()
    }

    const operation = (async () => {
      try {
        await this.transport.connect()
        if (this.stopped || lifecycleGeneration !== this.lifecycleGeneration) return
        this.sendHello()
        this.scheduleHandshakeDeadline()
      } catch (error) {
        if (!this.stopped && lifecycleGeneration === this.lifecycleGeneration) {
          this.scheduleReconnect(error instanceof Error ? error.message : String(error))
        }
        throw error
      }
    })()
    this.connectOperation = operation
    void operation.then(
      () => {
        if (this.connectOperation === operation) this.connectOperation = null
      },
      () => {
        if (this.connectOperation === operation) this.connectOperation = null
      },
    )
    return operation
  }

  private scheduleReconnect(detail: string): void {
    if (
      this.stopped ||
      !this.connectionDesired ||
      this.reconnectTimer !== null
    ) {
      return
    }
    const delayIndex = Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1)
    const delayMs = this.reconnectDelaysMs[delayIndex]!
    this.reconnectAttempt += 1
    const generation = ++this.reconnectGeneration
    const lifecycleGeneration = this.lifecycleGeneration
    this.projection = {
      ...this.projection,
      connectionDetail: `${detail} Reconnecting to the local sensor bridge in ${delayMs} ms.`,
    }
    this.emit()
    this.reconnectTimer = setTimeout(() => {
      if (
        this.stopped ||
        generation !== this.reconnectGeneration ||
        lifecycleGeneration !== this.lifecycleGeneration
      ) {
        return
      }
      this.reconnectTimer = null
      void this.startTransportAttempt(true).catch(() => undefined)
    }, delayMs)
  }

  private clearReconnectTimer(): void {
    this.reconnectGeneration += 1
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private emit(): void {
    const projection = this.snapshot()
    this.listeners.forEach((listener) => listener(projection))
  }
}

export function createDefaultStudyBridgeClient(): StudyBridgeClient {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/u, ''))
  const hasFragmentLaunchMaterial = fragment.has('bridgeWs') || fragment.has('bridgeToken')
  const launch = (() => {
    try {
      return resolveStudyBridgeLaunchConfig(window.location)
    } finally {
      if (hasFragmentLaunchMaterial) {
        fragment.delete('bridgeWs')
        fragment.delete('bridgeToken')
        const suffix = fragment.size > 0 ? `#${fragment.toString()}` : ''
        window.history.replaceState(
          window.history.state,
          '',
          `${window.location.pathname}${window.location.search}${suffix}`,
        )
      }
    }
  })()
  return new StudyBridgeClient({
    transport: new WebSocketStudyBridgeTransport({ url: launch.url }),
    bridgeLaunch: launch.bridgeLaunch ?? 'standalone-webxr-launch',
  })
}

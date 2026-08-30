import type { CommandDecision } from '../companion/host.ts'
import type { CompanionStatus, RemoteCommandName } from '../companion/protocol.ts'
import {
  disconnectedPolarStatus,
  polarProjectionIsReady,
  type BridgeExperimentMarker,
  type BridgeReceiptStage,
  type BridgeSensorAction,
  type ExperimentMarkerEventType,
  type PolarStatusProjection,
  type StudyBridgeClient,
  type StudyBridgeProjection,
} from '../bridge/index.ts'
import { StudyMediaPlayer, type StudyMediaSnapshot } from '../media/player.ts'
import {
  downloadBlob,
  exportJsonBlob,
  exportResponsesCsv,
  StudyDatabase,
  type ExportRevision,
} from '../persistence/database.ts'
import {
  canAdvanceAssessment,
  canGoBackAssessment,
  createInitialExperimentState,
  guardRemoteCommand,
  permutationNumber,
  reduceStudy,
  remoteStatus,
  validateExperimentState,
  variantSpec,
  REMOTE_COMMAND_PROTOCOL,
  type Demographics,
  type ExperimentState,
  type LanguageCode,
  type RemoteCommand,
  type StudyAction,
  type StudyConfiguration,
} from '../study/index.ts'
import type { BrowserStudyShell } from '../ui/browser-shell.ts'
import type { StudyXRRuntime } from '../xr/study-xr-runtime.ts'
import { CompanionControls } from './companion-controls.ts'
import { StudyPanelRenderer } from './panel-renderer.ts'

export interface StudyControllerOptions {
  shell: BrowserStudyShell
  runtime: StudyXRRuntime
  media: StudyMediaPlayer
  panelRenderer: StudyPanelRenderer
  bridge?: StudyBridgeClient
}

function safeFilenameToken(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 64)
}

export class StudyController {
  private readonly shell: BrowserStudyShell
  private readonly runtime: StudyXRRuntime
  private readonly media: StudyMediaPlayer
  private readonly panelRenderer: StudyPanelRenderer
  private readonly bridge: StudyBridgeClient | null
  private database: StudyDatabase | null = null
  private state: ExperimentState = createInitialExperimentState()
  private durableRevision = -1
  private usedParticipantIds: string[] = []
  private storageHealthy = true
  private recoveryBlocked = false
  private sessionFinalized = false
  private localMessage = ''
  private sensorMessage = ''
  private operation: Promise<unknown> = Promise.resolve()
  private remoteOperation: Promise<unknown> = Promise.resolve()
  private lastMediaRevisionPosition = 0
  private controlEnabled = false
  private companionControls: CompanionControls | null = null
  private xrPresenting = false
  private blockStartInFlight = false
  private polar: PolarStatusProjection = disconnectedPolarStatus()
  private bridgeProjection: StudyBridgeProjection | null = null
  private unsubscribeBridge: (() => void) | null = null

  constructor(options: StudyControllerOptions) {
    this.shell = options.shell
    this.runtime = options.runtime
    this.media = options.media
    this.panelRenderer = options.panelRenderer
    this.bridge = options.bridge ?? null
  }

  async initialize(): Promise<void> {
    this.panelRenderer.resetTransientState()
    if (this.bridge) {
      this.unsubscribeBridge = this.bridge.subscribe((projection) => {
        this.applyBridgeProjection(projection)
      })
      try {
        await this.bridge.connect()
      } catch (error) {
        this.sensorMessage = error instanceof Error ? error.message : String(error)
      }
    }
    try {
      this.database = await StudyDatabase.open()
      this.usedParticipantIds = (await this.database.listParticipants()).map(
        (participant) => participant.participantId,
      )
      const recovered = await this.database.recoverActiveSession()
      if (recovered) {
        const candidate = recovered.revision.state as unknown as ExperimentState
        let errors: string[]
        try {
          errors = validateExperimentState(candidate)
          if (candidate.sessionId !== recovered.header.sessionId) {
            errors.push('recovery_session_owner_mismatch')
          }
          if (candidate.participantId !== recovered.header.participantId) {
            errors.push('recovery_participant_owner_mismatch')
          }
        } catch {
          errors = ['state_shape_invalid']
        }
        if (errors.length > 0) {
          this.storageHealthy = false
          this.recoveryBlocked = true
          this.localMessage = `Recovery stopped: ${errors.join(', ')}.`
        } else {
          this.state = candidate
          this.durableRevision = recovered.header.latestRevision
          this.recoveryBlocked = false
          this.sessionFinalized = false
          this.localMessage = 'Recovered the unfinished local session.'
          if (this.state.page === 'complete' || this.state.page === 'aborted') {
            await this.database.finalizeSession(
              this.state.sessionId!,
              this.state.page === 'complete' ? 'complete' : 'abandoned',
            )
            this.sessionFinalized = true
          } else if (this.state.page === 'stimulus') {
            this.prepareRecoveredMedia()
            if (this.state.media.status === 'playing') {
              const paused = await this.applyAction({ type: 'pause_media' })
              const recoveryNotice = 'Recovered media is paused; resume with a local gesture.'
              if (paused) {
                this.localMessage = this.localMessage
                  ? `${recoveryNotice} ${this.localMessage}`
                  : recoveryNotice
              } else {
                this.recoveryBlocked = true
                this.localMessage = `Recovery could not save the required paused state: ${this.localMessage}`
              }
            }
          }
        }
      }
    } catch (error) {
      this.storageHealthy = false
      this.recoveryBlocked = true
      this.localMessage = error instanceof Error ? error.message : String(error)
    }

    this.initializeCompanionControls()
    this.render()
  }

  private initializeCompanionControls(): void {
    this.companionControls = new CompanionControls({
      slot: this.shell.companionSlot,
      canvas: this.shell.canvas,
      getStatus: () => this.companionStatus(),
      handleCommand: (name, expectedRevision) => this.handleRemoteCommand(name, expectedRevision),
      onControlEnabledChange: (enabled) => {
        this.controlEnabled = enabled
      },
    })
  }

  createPanelActions() {
    return {
      configure: (configuration: StudyConfiguration) => void this.enqueue({ type: 'configure', configuration }),
      setDemographicsLanguage: (languageCode: LanguageCode) =>
        void this.enqueue({ type: 'set_demographics_language', languageCode }),
      startParticipant: (participantId: string) => void this.startParticipant(participantId),
      submitDemographics: (demographics: Demographics) =>
        void this.submitDemographics(demographics),
      startBlock: () => void this.startBlock(),
      setSam: (dimension: 'valence' | 'arousal' | 'dominance', value: number) =>
        void this.enqueue({ type: 'set_sam', dimension, value }),
      setAffect: (dimension: 'valence' | 'arousal', value: number) =>
        void this.enqueue({ type: 'set_affect', dimension, value }),
      setEmotion: (
        emotion: 'anger' | 'disgust' | 'fear' | 'happiness' | 'sadness' | 'surprise',
        value: number,
      ) => void this.enqueue({ type: 'set_emotion', emotion, value }),
      setHand: (dimension: 'ownership' | 'agency', value: number) =>
        void this.enqueue({ type: 'set_hand', dimension, value }),
      advanceAssessment: () => void this.advanceAssessment(),
      backAssessment: () => void this.enqueue({ type: 'back_assessment' }),
      exportJson: () => void this.export('json'),
      exportCsv: () => void this.export('csv'),
      startNewSession: () => this.startNewSession(),
    }
  }

  onFrame(time: number): void {
    const snapshot = this.media.update(time)
    if (
      this.state.page === 'stimulus' &&
      snapshot.phase === 'playing' &&
      snapshot.positionMs - this.lastMediaRevisionPosition >= 5_000
    ) {
      this.lastMediaRevisionPosition = snapshot.positionMs
      void this.enqueue({ type: 'observe_media_position', positionMs: snapshot.positionMs })
    }
  }

  onMediaEnded(snapshot: StudyMediaSnapshot): void {
    if (this.state.page !== 'stimulus') return
    void this.completeMedia(snapshot)
  }

  onMediaError(snapshot: StudyMediaSnapshot): void {
    if (this.state.page !== 'stimulus') return
    void this.enterTechnicalHold(snapshot.error?.slice(0, 96) || 'media_error')
  }

  onMediaToggleRequest(snapshot: StudyMediaSnapshot): void {
    if (snapshot.phase === 'playing') this.pauseMedia()
    else if (snapshot.phase === 'paused' || snapshot.phase === 'ready') this.resumeMedia()
    else if (snapshot.phase === 'ended') this.onMediaEnded(snapshot)
    else if (snapshot.phase === 'error') this.onMediaError(snapshot)
  }

  onXRStateChange(presenting: boolean): void {
    this.xrPresenting = presenting
    this.shell.setXRPresenting(presenting)
    this.render()
  }

  async toggleXR(): Promise<void> {
    try {
      if (this.xrPresenting) await this.runtime.exitXR()
      else await this.runtime.enterXR()
    } catch (error) {
      this.localMessage = error instanceof Error ? error.message : String(error)
      this.render()
    }
  }

  async checkXRAvailability(): Promise<void> {
    this.shell.setXRAvailability(await this.runtime.isImmersiveSupported())
  }

  shutdown(): void {
    this.companionControls?.destroy()
    this.companionControls = null
    this.database?.close()
    this.database = null
    this.unsubscribeBridge?.()
    this.unsubscribeBridge = null
    this.bridge?.close()
  }

  pauseMedia(): void {
    void this.enqueue({ type: 'pause_media' }).then((accepted) => {
      if (!accepted) return
      this.media.pause()
      void this.recordSensorMarker('media_paused', this.state, this.media.snapshot().positionMs)
    })
  }

  resumeMedia(): void {
    const playback = this.media.play()
    void playback
      .then(async () => {
        if (!(await this.enqueue({ type: 'resume_media' }))) {
          this.media.pause()
          return
        }
        await this.recordSensorMarker('media_resumed', this.state, this.media.snapshot().positionMs)
      })
      .catch((error) => {
        this.localMessage = error instanceof Error ? error.message : String(error)
        this.render()
      })
  }

  private enqueue(action: StudyAction): Promise<boolean> {
    const next = this.operation.then(() => this.applyAction(action))
    this.operation = next.catch(() => undefined)
    return next
  }

  private async applyAction(action: StudyAction): Promise<boolean> {
    if (this.recoveryBlocked) {
      this.storageHealthy = false
      this.localMessage = 'Local recovery is blocked; no study transition was applied.'
      this.render()
      return false
    }
    const previous = this.state
    const result = reduceStudy(previous, action)
    if (!result.accepted) {
      this.localMessage = result.detail
      this.render()
      return false
    }
    const next = result.state
    try {
      if (action.type === 'start_participant') {
        if (this.recoveryBlocked) {
          throw new Error('A damaged or unavailable active session must be resolved before allocation.')
        }
        if (!this.database || !next.configuration || !next.sessionId) {
          throw new Error('Durable storage is unavailable; no participant ID was reserved.')
        }
        const spec = variantSpec(next.configuration.variantId)
        await this.database.beginSession(
          {
            participantId: next.participantId,
            pool: spec.participantPrefix,
            permutation: permutationNumber(next.participantId),
            sessionId: next.sessionId,
          },
          next,
        )
        this.durableRevision = 0
        this.usedParticipantIds = Array.from(
          new Set([...this.usedParticipantIds, next.participantId]),
        ).sort()
      } else if (next.sessionId) {
        if (!this.database) {
          throw new Error('Durable storage is unavailable; the study action was not applied.')
        }
        const completedQuestionnaire =
          previous.page === 'hand_embodiment' &&
          action.type === 'advance_assessment' &&
          previous.blocks[previous.currentBlockIndex]?.questionnaire === null
            ? next.blocks[previous.currentBlockIndex]?.questionnaire
            : null
        const revision = completedQuestionnaire
          ? await this.database.appendRevisionWithResponse(
              next.sessionId,
              this.durableRevision,
              next,
              {
                sessionId: next.sessionId,
                responseId: `${previous.blocks[previous.currentBlockIndex].attemptId}:questionnaire`,
                attemptOrdinal: 1,
                page: 'hand_embodiment',
                answer: completedQuestionnaire,
              },
            )
          : await this.database.appendRevision(next.sessionId, this.durableRevision, next)
        this.durableRevision = revision.revision
      }
    } catch (error) {
      this.storageHealthy = false
      this.localMessage = error instanceof Error ? error.message : String(error)
      this.render()
      return false
    }

    // Only expose the next in-memory state after its owning revision is durable.
    this.state = next
    this.storageHealthy = true
    this.localMessage = ''
    if (action.type === 'start_participant') this.sessionFinalized = false

    let auditWarning = ''
    if (next.sessionId && this.database) {
      try {
        await this.database.appendEvent(next.sessionId, 'study_action', { type: action.type })
      } catch (error) {
        auditWarning = `State saved, but its audit event was not appended: ${
          error instanceof Error ? error.message : String(error)
        }`
      }

      if (
        (next.page === 'complete' || next.page === 'aborted') &&
        previous.page !== next.page
      ) {
        this.sessionFinalized = false
        try {
          await this.database.finalizeSession(
            next.sessionId,
            next.page === 'complete' ? 'complete' : 'abandoned',
          )
          this.sessionFinalized = true
        } catch (error) {
          this.storageHealthy = false
          this.localMessage = `Responses were saved, but the terminal receipt failed: ${
            error instanceof Error ? error.message : String(error)
          }`
          this.syncMediaVisibility()
          this.render()
          return false
        }
      }
    }

    if (auditWarning) {
      this.storageHealthy = false
      this.localMessage = auditWarning
    }
    this.syncMediaVisibility()
    this.render()
    return true
  }

  private async submitDemographics(demographics: Demographics): Promise<void> {
    if (!(await this.enqueue({ type: 'submit_demographics', demographics }))) return
    await this.recordSensorMarker('experiment_ready', this.state)
  }

  private async advanceAssessment(): Promise<boolean> {
    const previousPage = this.state.page
    if (
      !(await this.enqueue({
        type: 'advance_assessment',
        recordedAtUtc: new Date().toISOString(),
      }))
    ) {
      return false
    }
    if (previousPage !== 'hand_embodiment') return true

    await this.recordSensorMarker('block_completed', this.state)
    if (this.state.page !== 'complete') return true

    const markerSaved = await this.recordSensorMarker('session_finalized', this.state)
    if (!this.bridge) return true
    if (!markerSaved) return false
    return this.applySensorOperation('finalize_recording', 'persisted')
  }

  private async completeMedia(snapshot: StudyMediaSnapshot): Promise<void> {
    const accepted = await this.enqueue({
      type: 'complete_stimulus',
      observedDurationMs: snapshot.durationMs,
      endedAtUtc: new Date().toISOString(),
    })
    if (!accepted) {
      this.localMessage = `${this.localMessage} Select the media surface to retry saving completion.`.trim()
      this.render()
      return
    }
    await this.recordSensorMarker('media_ended', this.state, snapshot.positionMs)
  }

  private async enterTechnicalHold(reason: string): Promise<boolean> {
    const accepted = await this.enqueue({ type: 'enter_technical_hold', reason })
    if (accepted) await this.recordSensorMarker('technical_hold', this.state)
    return accepted
  }

  private async recordSensorMarker(
    eventType: ExperimentMarkerEventType,
    state: ExperimentState,
    mediaPositionMs?: number,
  ): Promise<boolean> {
    if (!this.bridge) return true
    const block = state.blocks[state.currentBlockIndex]
    const marker: BridgeExperimentMarker = {
      markerId: `marker-${crypto.randomUUID()}`,
      eventType,
      webxrRevision: state.revision,
      ...(state.sessionId ? { sessionId: state.sessionId } : {}),
      ...(block
        ? {
            blockOrder: block.blockOrder,
            conditionId: block.conditionId,
            mediaId: block.mediaId,
          }
        : {}),
      ...(mediaPositionMs === undefined
        ? {}
        : { mediaPositionMs: Math.max(0, Math.round(mediaPositionMs)) }),
      browserMonotonicMs: Math.max(0, Math.round(performance.now())),
      browserUtc: new Date().toISOString(),
    }
    try {
      const receipt = await this.bridge.recordExperimentMarker(marker, 'persisted')
      this.sensorMessage = receipt.accepted
        ? ''
        : receipt.detail || `The APK rejected ${eventType}.`
      this.render()
      return receipt.accepted
    } catch (error) {
      this.sensorMessage = `ECG marker ${eventType} failed: ${
        error instanceof Error ? error.message : String(error)
      }`
      if (state.sessionId && this.database) {
        await this.database
          .appendEvent(state.sessionId, 'sensor_marker_failed', { eventType })
          .catch(() => undefined)
      }
      this.render()
      return false
    }
  }

  private async applySensorOperation(
    action: Exclude<BridgeSensorAction, 'record_experiment_marker'>,
    targetStage: BridgeReceiptStage,
  ): Promise<boolean> {
    if (!this.bridge) {
      this.sensorMessage = `${action} requires the APK sensor recorder.`
      this.render()
      return false
    }
    try {
      const receipt = await this.bridge.applySensorAction(action, targetStage)
      this.sensorMessage = receipt.accepted ? '' : receipt.detail || receipt.code
      this.render()
      return receipt.accepted
    } catch (error) {
      this.sensorMessage = error instanceof Error ? error.message : String(error)
      this.render()
      return false
    }
  }

  private async startParticipant(participantId: string): Promise<void> {
    if (!this.database || this.recoveryBlocked) {
      this.storageHealthy = false
      this.localMessage = this.recoveryBlocked
        ? 'Participant allocation is blocked until the local recovery problem is resolved.'
        : 'Participant allocation requires durable local storage.'
      this.render()
      return
    }
    const idAccepted = await this.enqueue({ type: 'set_participant_id', participantId })
    if (!idAccepted) return
    await this.enqueue({
      type: 'start_participant',
      sessionId: `s6-${crypto.randomUUID()}`,
      allocatedAtUtc: new Date().toISOString(),
      usedParticipantIds: this.usedParticipantIds,
    })
  }

  private async startBlock(): Promise<boolean> {
    if (this.blockStartInFlight) {
      this.localMessage = 'Block start is already in progress.'
      this.render()
      return false
    }
    const block = this.state.blocks[this.state.currentBlockIndex]
    if (!block || !this.state.configuration) {
      this.localMessage = 'The current block has no complete media assignment.'
      this.render()
      return false
    }
    if (!this.bridgeStartPreflightReady()) {
      this.localMessage = this.bridgeProjection?.sensorConnected
        ? `Block start is gated by the Sensor Bridge: ${this.polar.readinessReason || 'live 130 Hz ECG and a healthy writer are required'}.`
        : 'Block start requires the connected APK sensor recorder.'
      this.render()
      return false
    }
    this.blockStartInFlight = true
    try {
      this.media.load(
        {
          videoFile: block.videoFile,
          audioFile: block.audioFile,
          durationMs: this.state.configuration.timingMode === 'full' ? 300_000 : 10_000,
        },
        0,
      )
      if (!(await this.recordSensorMarker('block_start_intent', this.state, 0))) {
        this.localMessage = 'Block start stopped because the ECG intent marker was not durable.'
        this.render()
        return false
      }
      await this.media.play()
      const accepted = await this.enqueue({
        type: 'start_block',
        startedAtUtc: new Date().toISOString(),
      })
      if (!accepted) {
        this.media.pause()
        return false
      }
      if (await this.recordSensorMarker('media_started', this.state, 0)) return true
      this.media.pause()
      await this.enterTechnicalHold('sensor_media_start_marker_failed')
      return false
    } catch (error) {
      this.localMessage = error instanceof Error ? error.message : String(error)
      this.media.pause()
      this.render()
      return false
    } finally {
      this.blockStartInFlight = false
    }
  }

  private prepareRecoveredMedia(): void {
    const block = this.state.blocks[this.state.currentBlockIndex]
    if (!block) return
    this.media.load(
      {
        videoFile: block.videoFile,
        audioFile: block.audioFile,
        durationMs: this.state.media.durationMs,
      },
      this.state.media.positionMs,
    )
    this.lastMediaRevisionPosition = this.state.media.positionMs
    this.media.pause()
    this.syncMediaVisibility()
  }

  private syncMediaVisibility(): void {
    if (this.state.page === 'stimulus') {
      this.media.show()
    } else {
      this.media.hide()
    }
  }

  private async export(format: 'json' | 'csv'): Promise<void> {
    if (!this.database || !this.state.sessionId) return
    try {
      const revision: ExportRevision = await this.database.createExportRevision(this.state.sessionId)
      const stem = `spatial-study-6-${safeFilenameToken(this.state.participantId)}-export-${revision.revision}`
      if (format === 'json') downloadBlob(exportJsonBlob(revision), `${stem}.json`)
      else downloadBlob(exportResponsesCsv(revision.payload), `${stem}.csv`)
      this.localMessage = `Created immutable export revision ${revision.revision}.`
      this.render()
    } catch (error) {
      this.storageHealthy = false
      this.localMessage = error instanceof Error ? error.message : String(error)
      this.render()
    }
  }

  private startNewSession(): void {
    if (this.state.page !== 'complete' && this.state.page !== 'aborted') return
    if (!this.sessionFinalized) {
      this.storageHealthy = false
      this.localMessage = 'A terminal receipt must be saved before another session can start.'
      this.render()
      return
    }
    this.state = createInitialExperimentState()
    this.durableRevision = -1
    this.lastMediaRevisionPosition = 0
    this.sessionFinalized = false
    this.recoveryBlocked = false
    this.localMessage = ''
    this.panelRenderer.resetTransientState()
    this.media.hide()
    this.render()
  }

  private companionStatus(): CompanionStatus {
    const domain = remoteStatus(this.state)
    const media = this.media.snapshot()
    const bridgeConnected = this.bridgeProjection?.sensorConnected ?? false
    const recording = this.bridgeProjection?.snapshot?.recording ?? null
    const polarReady = polarProjectionIsReady(this.polar)
    const startPreflightReady = this.bridgeStartPreflightReady() && this.state.page === 'block_ready'
    return {
      revision: domain.revision,
      phase: domain.page,
      route: this.xrPresenting ? 'immersive-vr' : 'browser',
      language: this.state.configuration?.languageCode ?? 'en',
      xrPresenting: this.xrPresenting,
      participantActive: domain.participant_active,
      blockOrdinal: domain.block_order,
      condition: domain.condition_id,
      mediaElapsedSeconds: this.state.page === 'stimulus' ? media.positionMs / 1_000 : null,
      mediaDurationSeconds: this.state.page === 'stimulus' ? media.durationMs / 1_000 : null,
      mediaPaused: media.phase === 'paused',
      storageHealthy: this.storageHealthy,
      authority: 'webxr_experiment_owner',
      bridgeConnected,
      recordingState: recording?.state ?? 'unavailable',
      recordingRevision: Math.min(recording?.revision ?? 0, Number.MAX_SAFE_INTEGER),
      recordingMarkerCount: Math.min(recording?.markerCount ?? 0, Number.MAX_SAFE_INTEGER),
      recordingSamplesWritten: Math.min(
        recording?.samplesWritten ?? 0,
        Number.MAX_SAFE_INTEGER,
      ),
      recordingDroppedBatches: Math.min(
        recording?.droppedBatches ?? 0,
        Number.MAX_SAFE_INTEGER,
      ),
      recordingArtifactOpen: recording?.artifactOpen ?? false,
      recordingDurable: recording?.durable ?? false,
      polarPhase: this.polar.phase,
      polarReady,
      polarReadinessReason: this.polar.readinessReason.slice(0, 240),
      heartRateBpm: this.polar.heartRateBpm,
      ecgSampleRateHz: this.polar.ecgSampleRateHz,
      ecgSampleCount: Math.min(this.polar.ecgSampleCount, Number.MAX_SAFE_INTEGER),
      lastEcgSampleAgeMs:
        this.polar.lastSampleAgeMs === null
          ? null
          : Math.min(this.polar.lastSampleAgeMs, 86_400_000),
      polarWriterHealthy: this.polar.writer.healthy,
      polarReconnectCount: Math.min(this.polar.reconnectCount, Number.MAX_SAFE_INTEGER),
      polarGapCount: Math.min(this.polar.gapCount, Number.MAX_SAFE_INTEGER),
      startPreflightReady,
      lastReceiptStage: this.bridgeProjection?.lastReceipt?.stage ?? null,
      remoteControlEnabled: this.controlEnabled,
      remoteAdvanceAllowed: canAdvanceAssessment(this.state),
      remoteBackAllowed: canGoBackAssessment(this.state),
      remoteStartAllowed: this.bridge ? startPreflightReady : this.state.page === 'block_ready',
      remoteAbortAllowed:
        this.state.sessionId !== null &&
        this.state.page !== 'complete' &&
        this.state.page !== 'aborted',
      remoteFinalizeAllowed: this.state.sessionId !== null && this.state.page === 'complete',
      remoteExportAllowed: this.state.sessionId !== null,
    }
  }

  private async handleRemoteCommand(
    name: Exclude<RemoteCommandName, 'request_status'>,
    expectedRevision: number,
  ): Promise<CommandDecision> {
    const next = this.remoteOperation.then(() =>
      this.applyRemoteCommand(name, expectedRevision),
    )
    this.remoteOperation = next.catch(() => undefined)
    return next
  }

  private async applyRemoteCommand(
    name: Exclude<RemoteCommandName, 'request_status'>,
    expectedRevision: number,
  ): Promise<CommandDecision> {
    const command: RemoteCommand = {
      protocol: REMOTE_COMMAND_PROTOCOL,
      kind: 'command',
      command_id: crypto.randomUUID(),
      issued_at_unix_ms: Date.now(),
      expected_revision: expectedRevision,
      command: name,
    }
    const decision = guardRemoteCommand(this.state, command, this.controlEnabled)
    if (!decision.accepted) {
      return { accepted: false, code: decision.code, message: decision.detail }
    }
    switch (decision.intent.type) {
      case 'report_status':
        return { accepted: true, code: 'status_sent', message: 'Fresh status sent.' }
      case 'recenter_panel':
        this.runtime.recenterPanel()
        return {
          accepted: true,
          code: 'recentered',
          message: 'Panel recentered.',
        }
      case 'start_block':
        return (await this.startBlock())
          ? this.withPersistedWebXrEffect({
              accepted: true,
              code: 'started',
              message: 'Block started and saved.',
            })
          : { accepted: false, code: 'start_failed', message: this.localMessage }
      case 'pause_media':
        if (await this.enqueue({ type: 'pause_media' })) {
          this.media.pause()
          await this.recordSensorMarker(
            'media_paused',
            this.state,
            this.media.snapshot().positionMs,
          )
          return this.withPersistedWebXrEffect({
            accepted: true,
            code: 'paused',
            message: 'Media paused.',
          })
        }
        return { accepted: false, code: 'pause_failed', message: this.localMessage }
      case 'resume_media':
        try {
          await this.media.play()
        } catch (error) {
          return {
            accepted: false,
            code: 'local_gesture_required',
            message: error instanceof Error ? error.message : String(error),
          }
        }
        if (await this.enqueue({ type: 'resume_media' })) {
          await this.recordSensorMarker(
            'media_resumed',
            this.state,
            this.media.snapshot().positionMs,
          )
          return this.withPersistedWebXrEffect({
            accepted: true,
            code: 'resumed',
            message: 'Media resumed.',
          })
        }
        this.media.pause()
        return { accepted: false, code: 'resume_failed', message: this.localMessage }
      case 'advance_assessment':
        return (await this.advanceAssessment())
          ? this.withPersistedWebXrEffect({
              accepted: true,
              code: 'advanced',
              message: 'Questionnaire advanced.',
            })
          : { accepted: false, code: 'advance_failed', message: this.localMessage }
      case 'back_assessment':
        return (await this.enqueue({ type: 'back_assessment' }))
          ? this.withPersistedWebXrEffect({
              accepted: true,
              code: 'went_back',
              message: 'Questionnaire moved back.',
            })
          : { accepted: false, code: 'back_failed', message: this.localMessage }
      case 'abort_session':
        return this.abortSession()
      case 'finalize_session':
        return this.forwardSensorAction('finalize_recording', 'persisted')
      case 'reconnect_sensor':
        return this.forwardSensorAction('reconnect_sensor', 'applied')
      case 'return_to_experiment':
        return this.forwardSensorAction('return_to_experiment', 'applied')
      case 'request_export':
        return this.forwardSensorAction('request_sensor_export', 'observed')
    }
  }

  private async abortSession(): Promise<CommandDecision> {
    const accepted = await this.enqueue({
      type: 'abort_session',
      reason: 'remote_operator_abort',
      abortedAtUtc: new Date().toISOString(),
    })
    if (!accepted) {
      return { accepted: false, code: 'abort_failed', message: this.localMessage }
    }
    this.media.pause()
    const marked = await this.recordSensorMarker('session_aborted', this.state)
    const finalized = !this.bridge || (marked && (await this.applySensorOperation('finalize_recording', 'persisted')))
    return this.withPersistedWebXrEffect({
      accepted: true,
      code: finalized ? 'aborted' : 'aborted_sensor_attention',
      message: finalized
        ? 'WebXR session aborted and sensor recording finalized.'
        : 'WebXR session aborted; the APK recording still needs attention.',
    })
  }

  private async forwardSensorAction(
    action: Exclude<BridgeSensorAction, 'record_experiment_marker'>,
    targetStage: BridgeReceiptStage,
  ): Promise<CommandDecision> {
    if (!this.bridge) {
      return {
        accepted: false,
        code: 'sensor_recorder_required',
        message: `${action} requires the native sensor recorder.`,
      }
    }
    try {
      const receipt = await this.bridge.applySensorAction(action, targetStage)
      return {
        accepted: receipt.accepted,
        code: receipt.code,
        message: receipt.detail || `${action} reached ${receipt.stage}.`,
        stage: receipt.stage,
        sensorRevision: receipt.resultingRevision,
      }
    } catch (error) {
      return {
        accepted: false,
        code: 'bridge_command_failed',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private withPersistedWebXrEffect(decision: CommandDecision): CommandDecision {
    // WebXR owns and durably stores experiment revisions. Sensor receipts are a
    // separate effect stream and must never replace this reducer receipt.
    return decision.accepted
      ? { ...decision, stage: 'persisted' }
      : decision
  }

  private render(): void {
    this.syncMediaVisibility()
    const mediaSnapshot = this.media.snapshot()
    const language = this.state.configuration?.languageCode ?? 'en'
    this.shell.setMediaControl({
      visible: this.state.page === 'stimulus',
      paused: mediaSnapshot.phase !== 'playing',
      pauseLabel: language === 'de' ? 'Medium pausieren' : 'Pause media',
      resumeLabel: language === 'de' ? 'Medium fortsetzen' : 'Resume media',
    })
    const displayMessage = [this.localMessage, this.sensorMessage].filter(Boolean).join(' · ')
    this.panelRenderer.render(this.state, {
      usedParticipantIds: this.usedParticipantIds,
      localMessage: displayMessage,
      storageHealthy: this.storageHealthy,
      polar: this.polar,
      startPreflightReady: this.bridgeStartPreflightReady(),
    })
    this.shell.setStatus(
      displayMessage ||
        `${this.state.page.replaceAll('_', ' ')} · WebXR authority · ${this.bridge ? 'APK sensor recorder' : 'sensor-disabled rehearsal'}`,
    )
  }

  private applyBridgeProjection(projection: StudyBridgeProjection): void {
    this.bridgeProjection = projection
    this.polar = projection.polar
    if (!projection.sensorConnected) {
      this.sensorMessage = projection.connectionDetail
    } else if (projection.lastError) {
      this.sensorMessage = `${projection.lastError.code}: ${projection.lastError.detail}`
    } else {
      this.sensorMessage = ''
    }
    this.render()
  }

  private bridgeStartPreflightReady(): boolean {
    if (!this.bridge) return true
    return (
      (this.bridgeProjection?.sensorConnected ?? false) &&
      polarProjectionIsReady(this.polar) &&
      this.polar.writer.phase === 'recording' &&
      this.polar.writer.healthy
    )
  }
}

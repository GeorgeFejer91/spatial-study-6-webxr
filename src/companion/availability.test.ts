import { describe, expect, it } from 'vitest'

import type { CompanionStatus } from './protocol'
import { companionCommandAllowed } from './availability'

const status: CompanionStatus = {
  revision: 5,
  phase: 'complete',
  route: 'browser',
  language: 'en',
  variant: 'DHS',
  timingMode: 'clipped',
  participantPrefix: 'PH',
  xrPresenting: false,
  participantActive: true,
  completedBlockCount: 4,
  blockOrdinal: 4,
  condition: 'HC_HE',
  mediaElapsedSeconds: null,
  mediaDurationSeconds: null,
  mediaPaused: false,
  storageHealthy: true,
  authority: 'webxr_experiment_owner',
  bridgeConnected: true,
  recordingState: 'recording',
  recordingRevision: 12,
  recordingMarkerCount: 17,
  recordingSamplesWritten: 13_000,
  recordingDroppedBatches: 0,
  recordingArtifactOpen: true,
  recordingDurable: true,
  polarPhase: 'streaming',
  polarReady: true,
  polarReadinessReason: 'Ready.',
  heartRateBpm: 64,
  ecgSampleRateHz: 130,
  ecgSampleCount: 1_300,
  lastEcgSampleAgeMs: 12,
  polarWriterHealthy: true,
  polarReconnectCount: 0,
  polarGapCount: 0,
  startPreflightReady: false,
  lastReceiptStage: 'observed',
  remoteControlEnabled: true,
  remoteConfigureAllowed: false,
  remoteParticipantStartAllowed: false,
  remoteAdvanceAllowed: false,
  remoteBackAllowed: false,
  remoteStartAllowed: false,
  remoteAbortAllowed: true,
  remoteFinalizeAllowed: true,
  remoteExportAllowed: true,
}

describe('companion command availability', () => {
  it('uses target-returned phase gates for setup and participant allocation', () => {
    expect(companionCommandAllowed('configure_study', true, {
      ...status,
      phase: 'operator_setup',
      remoteConfigureAllowed: true,
    })).toBe(true)
    expect(companionCommandAllowed('start_participant', true, {
      ...status,
      phase: 'participant_id',
      participantActive: false,
      remoteParticipantStartAllowed: true,
    })).toBe(true)
    expect(companionCommandAllowed('configure_study', true, status)).toBe(false)
    expect(companionCommandAllowed('start_participant', false, {
      ...status,
      remoteParticipantStartAllowed: true,
    })).toBe(false)
  })

  it('requires a connected, actively recording APK before finalization', () => {
    expect(companionCommandAllowed('finalize_session', true, status)).toBe(true)
    expect(companionCommandAllowed('finalize_session', true, { ...status, bridgeConnected: false })).toBe(false)
    expect(companionCommandAllowed('finalize_session', true, { ...status, recordingState: 'finalized' })).toBe(false)
  })

  it('only enables sensor export for a connected, finalized APK recording', () => {
    expect(companionCommandAllowed('request_export', true, status)).toBe(false)
    expect(companionCommandAllowed('request_export', true, { ...status, recordingState: 'finalized' })).toBe(true)
    expect(companionCommandAllowed('request_export', true, {
      ...status,
      bridgeConnected: false,
      recordingState: 'finalized',
    })).toBe(false)
  })

  it('keeps WebXR abort independent from the APK bridge', () => {
    expect(companionCommandAllowed('abort_session', true, {
      ...status,
      bridgeConnected: false,
      recordingState: 'unavailable',
    })).toBe(true)
    expect(companionCommandAllowed('abort_session', false, status)).toBe(false)
  })

  it('keeps status read-only until the headset wearer enables control', () => {
    const readOnly = { ...status, remoteControlEnabled: false }
    expect(companionCommandAllowed('request_status', true, readOnly)).toBe(true)
    expect(companionCommandAllowed('abort_session', true, readOnly)).toBe(false)
    expect(companionCommandAllowed('recenter_panel', true, readOnly)).toBe(false)
  })
})

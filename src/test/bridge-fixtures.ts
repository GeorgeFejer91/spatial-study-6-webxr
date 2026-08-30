import type {
  BridgeHelloPayload,
  BridgeSnapshotPayload,
  PolarStatusProjection,
} from '../bridge/index.ts'

export function readyPolarProjection(): PolarStatusProjection {
  return {
    phase: 'streaming',
    ready: true,
    readinessReason: 'ready',
    heartRateBpm: 64,
    rrIntervalCount: 20,
    ecgSampleRateHz: 130,
    ecgSampleCount: 3_900,
    lastSampleAgeMs: 24,
    stableDurationMs: 30_000,
    previewKind: 'real_samples',
    waveformMicrovolts: [-24, -12, 4, 38, 112, -72, -18, 2],
    writer: {
      phase: 'recording',
      healthy: true,
      queueDepth: 0,
      storageFreeBytes: 2_000_000_000,
    },
    reconnectCount: 0,
    gapCount: 0,
  }
}

export function apkHelloPayload(): BridgeHelloPayload {
  return {
    schemaRevision: 1,
    buildId: 'sensor-bridge-0.1.0',
    capabilities: [
      'polar_h10_ecg',
      'durable_ecg',
      'experiment_metadata_markers',
      'staged_receipts',
    ],
    authority: 'sensor_recorder_provider',
  }
}

export function acquisitionSnapshotPayload(
  revision = 0,
  polar: PolarStatusProjection = {
    phase: 'scanning',
    ready: false,
    readinessReason: 'sensor-not-connected',
    heartRateBpm: null,
    rrIntervalCount: 0,
    ecgSampleRateHz: null,
    ecgSampleCount: 0,
    lastSampleAgeMs: null,
    stableDurationMs: null,
    previewKind: 'none',
    waveformMicrovolts: [],
    writer: {
      phase: 'recording',
      healthy: true,
      queueDepth: 0,
      storageFreeBytes: 1_000_000,
    },
    reconnectCount: 0,
    gapCount: 0,
  },
): BridgeSnapshotPayload {
  return {
    recording: {
      recordingEpoch: 'recording-epoch-1',
      state: 'recording',
      revision,
      markerCount: revision,
      samplesWritten: 0,
      droppedBatches: 0,
      artifactOpen: true,
      durable: true,
    },
    polar,
  }
}

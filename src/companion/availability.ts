import type { CompanionStatus, RemoteCommandName } from './protocol'

/**
 * Companion command gates are projections of WebXR authority plus the APK's
 * sensor-recorder state. Aborting remains a WebXR-local decision and therefore
 * deliberately has no APK bridge prerequisite.
 */
export function companionCommandAllowed(
  name: RemoteCommandName,
  peerConnected: boolean,
  status: CompanionStatus | null,
): boolean {
  if (!peerConnected) return false
  if (name === 'request_status') return true
  if (!status) return false
  if (!status.remoteControlEnabled) return false

  switch (name) {
    case 'start_block':
      return status.remoteStartAllowed
    case 'pause_media':
      return status.mediaElapsedSeconds !== null && !status.mediaPaused
    case 'resume_media':
      return status.mediaPaused
    case 'advance':
      return status.remoteAdvanceAllowed
    case 'back':
      return status.remoteBackAllowed
    case 'abort_session':
      return status.remoteAbortAllowed
    case 'finalize_session':
      return status.remoteFinalizeAllowed && status.bridgeConnected && status.recordingState === 'recording'
    case 'request_export':
      return status.remoteExportAllowed && status.bridgeConnected && status.recordingState === 'finalized'
    case 'reconnect_sensor':
    case 'return_to_experiment':
      return status.bridgeConnected
    case 'recenter_panel':
      return true
  }
}

import {
  canAdvanceAssessment,
  canGoBackAssessment,
} from "./reducer"
import type { ExperimentState } from "./types"

export const REMOTE_COMMAND_PROTOCOL =
  "spatial.study6.companion.command.v1" as const
export const REMOTE_STATUS_PROTOCOL =
  "spatial.study6.companion.status.v1" as const
export const MAX_REMOTE_COMMAND_BYTES = 2_048

export const REMOTE_COMMAND_NAMES = [
  "request_status",
  "recenter_panel",
  "start_block",
  "pause_media",
  "resume_media",
  "advance",
  "back",
] as const
export type RemoteCommandName = (typeof REMOTE_COMMAND_NAMES)[number]

export interface RemoteCommand {
  protocol: typeof REMOTE_COMMAND_PROTOCOL
  kind: "command"
  command_id: string
  issued_at_unix_ms: number
  expected_revision: number
  command: RemoteCommandName
}

export type RemoteCommandParseResult =
  | { accepted: true; command: RemoteCommand }
  | { accepted: false; code: string; detail: string }

export type RemoteIntent =
  | { type: "report_status" }
  | { type: "recenter_panel" }
  | { type: "start_block" }
  | { type: "pause_media" }
  | { type: "resume_media" }
  | { type: "advance_assessment" }
  | { type: "back_assessment" }

export type RemoteGuardDecision =
  | { accepted: true; intent: RemoteIntent }
  | { accepted: false; code: string; detail: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function parseRemoteCommandJson(raw: string): RemoteCommandParseResult {
  if (new TextEncoder().encode(raw).byteLength > MAX_REMOTE_COMMAND_BYTES) {
    return {
      accepted: false,
      code: "command_too_large",
      detail: `Commands are limited to ${MAX_REMOTE_COMMAND_BYTES} UTF-8 bytes.`,
    }
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { accepted: false, code: "invalid_json", detail: "Command is not JSON." }
  }
  if (!isRecord(value)) {
    return { accepted: false, code: "invalid_envelope", detail: "Command must be an object." }
  }
  const exactKeys = [
    "protocol",
    "kind",
    "command_id",
    "issued_at_unix_ms",
    "expected_revision",
    "command",
  ]
  const actualKeys = Object.keys(value).sort()
  if (
    actualKeys.length !== exactKeys.length ||
    actualKeys.some((key, index) => key !== [...exactKeys].sort()[index])
  ) {
    return {
      accepted: false,
      code: "unknown_or_missing_field",
      detail: "The command envelope must contain only the frozen fields.",
    }
  }
  if (value.protocol !== REMOTE_COMMAND_PROTOCOL || value.kind !== "command") {
    return {
      accepted: false,
      code: "unsupported_protocol",
      detail: "The command protocol or kind is unsupported.",
    }
  }
  if (
    typeof value.command_id !== "string" ||
    !/^[A-Za-z0-9._-]{1,64}$/.test(value.command_id)
  ) {
    return {
      accepted: false,
      code: "command_id_invalid",
      detail: "Command ID is malformed.",
    }
  }
  if (
    !Number.isSafeInteger(value.issued_at_unix_ms) ||
    (value.issued_at_unix_ms as number) <= 0
  ) {
    return {
      accepted: false,
      code: "command_time_invalid",
      detail: "Command time must be a positive Unix millisecond value.",
    }
  }
  if (
    !Number.isSafeInteger(value.expected_revision) ||
    (value.expected_revision as number) < 0
  ) {
    return {
      accepted: false,
      code: "expected_revision_invalid",
      detail: "Expected revision must be a nonnegative integer.",
    }
  }
  if (
    typeof value.command !== "string" ||
    !(REMOTE_COMMAND_NAMES as readonly string[]).includes(value.command)
  ) {
    return {
      accepted: false,
      code: "unknown_command",
      detail: "The requested operation is not in the command allowlist.",
    }
  }
  return { accepted: true, command: value as unknown as RemoteCommand }
}

export function guardRemoteCommand(
  state: ExperimentState,
  command: RemoteCommand,
  controlEnabled: boolean,
): RemoteGuardDecision {
  if (command.command === "request_status") {
    return { accepted: true, intent: { type: "report_status" } }
  }
  if (command.expected_revision !== state.revision) {
    return {
      accepted: false,
      code: "stale_revision",
      detail: "Expected revision does not match the WebXR session.",
    }
  }
  if (!controlEnabled) {
    return {
      accepted: false,
      code: "remote_control_disabled",
      detail: "The local operator has not enabled companion control.",
    }
  }
  switch (command.command) {
    case "recenter_panel":
      return { accepted: true, intent: { type: "recenter_panel" } }
    case "start_block":
      return state.page === "block_ready"
        ? { accepted: true, intent: { type: "start_block" } }
        : {
            accepted: false,
            code: "start_block_not_allowed",
            detail: "A pending block is not on screen.",
          }
    case "pause_media":
      return state.page === "stimulus" && state.media.status === "playing"
        ? { accepted: true, intent: { type: "pause_media" } }
        : {
            accepted: false,
            code: "pause_not_allowed",
            detail: "Stimulus media is not playing.",
          }
    case "resume_media":
      return state.page === "stimulus" && state.media.status === "paused"
        ? { accepted: true, intent: { type: "resume_media" } }
        : {
            accepted: false,
            code: "resume_not_allowed",
            detail: "Stimulus media is not paused.",
          }
    case "advance":
      return canAdvanceAssessment(state)
        ? { accepted: true, intent: { type: "advance_assessment" } }
        : {
            accepted: false,
            code: "advance_not_allowed",
            detail:
              "Remote advance is limited to a locally completed questionnaire page.",
          }
    case "back":
      return canGoBackAssessment(state)
        ? { accepted: true, intent: { type: "back_assessment" } }
        : {
            accepted: false,
            code: "back_not_allowed",
            detail: "This page has no safe questionnaire back edge.",
          }
  }
}

export interface RemoteStatus {
  protocol: typeof REMOTE_STATUS_PROTOCOL
  kind: "status"
  revision: number
  page: ExperimentState["page"]
  participant_active: boolean
  block_order: number | null
  condition_id: string | null
  media_status: ExperimentState["media"]["status"]
  media_position_ms: number
  media_duration_ms: number
  complete_block_count: number
  test_route: true
  participant_data_eligible: false
  technical_hold: boolean
}

/** Deliberately excludes participant ID, names, demographics, and answers. */
export function remoteStatus(state: ExperimentState): RemoteStatus {
  const block = state.blocks[state.currentBlockIndex]
  return {
    protocol: REMOTE_STATUS_PROTOCOL,
    kind: "status",
    revision: state.revision,
    page: state.page,
    participant_active: state.sessionId !== null,
    block_order: block?.blockOrder ?? null,
    condition_id: block?.conditionId ?? null,
    media_status: state.media.status,
    media_position_ms: state.media.positionMs,
    media_duration_ms: state.media.durationMs,
    complete_block_count: state.blocks.filter((candidate) => candidate.status === "complete")
      .length,
    test_route: true,
    participant_data_eligible: false,
    technical_hold: state.page === "technical_hold",
  }
}

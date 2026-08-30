import { z } from 'zod'

import { BRIDGE_RECEIPT_STAGES } from '../bridge/contract.ts'
import {
  CompanionStatusSchema,
  remoteCommandNames,
  type CompanionStatus,
  type RemoteCommandName,
} from './protocol.ts'

export const STUDY6_BRSP_CAPABILITIES = [
  'command-ack',
  'state-snapshot',
  'latest-state',
  'study6-status-v1',
] as const

export const STUDY6_BRSP_SCOPES = [
  'study.status.read',
  'study.view.control',
  'study.media.control',
  'study.questionnaire.control',
  'study.session.abort',
  'sensor.recorder.control',
  'sensor.recorder.export',
] as const

export type Study6BrspScope = (typeof STUDY6_BRSP_SCOPES)[number]

export interface Study6BrspCommandRoute {
  scope: Study6BrspScope
  action: RemoteCommandName
}

const routes = {
  request_status: 'study.status.read',
  recenter_panel: 'study.view.control',
  start_block: 'study.media.control',
  pause_media: 'study.media.control',
  resume_media: 'study.media.control',
  advance: 'study.questionnaire.control',
  back: 'study.questionnaire.control',
  abort_session: 'study.session.abort',
  finalize_session: 'sensor.recorder.control',
  reconnect_sensor: 'sensor.recorder.control',
  return_to_experiment: 'sensor.recorder.control',
  request_export: 'sensor.recorder.export',
} as const satisfies Record<RemoteCommandName, Study6BrspScope>

export const Study6BrspCommandResultSchema = z.object({
  code: z.string().min(1).max(80).regex(/^[A-Za-z0-9_.:-]+$/u),
  message: z.string().max(240),
  stage: z.enum(BRIDGE_RECEIPT_STAGES).optional(),
  sensorRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict()

export type Study6BrspCommandResult = z.infer<typeof Study6BrspCommandResultSchema>

export function remoteCommandToBrsp(name: RemoteCommandName): Study6BrspCommandRoute {
  return { scope: routes[name], action: name }
}

/**
 * BRSP is only the authenticated command envelope. This exact route check is
 * the application allowlist: a granted scope never authorizes arbitrary
 * actions or arguments.
 */
export function brspToRemoteCommand(
  scope: string,
  action: string,
  args: unknown,
): RemoteCommandName | null {
  if (
    typeof args !== 'object' ||
    args === null ||
    Array.isArray(args) ||
    Object.keys(args).length !== 0 ||
    !(remoteCommandNames as readonly string[]).includes(action)
  ) {
    return null
  }
  const name = action as RemoteCommandName
  return routes[name] === scope ? name : null
}

/** Strictly validate the privacy-minimized state before it enters BRSP. */
export function study6BrspState(value: unknown): CompanionStatus {
  return CompanionStatusSchema.parse(value)
}


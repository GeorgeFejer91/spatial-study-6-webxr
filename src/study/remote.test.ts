import { describe, expect, it } from "vitest"

import {
  guardRemoteCommand,
  parseRemoteCommandJson,
  remoteStatus,
  type RemoteCommand,
} from "./remote"
import { createInitialExperimentState, reduceStudy } from "./reducer"
import type { ExperimentState } from "./types"

function command(
  state: ExperimentState,
  operation: RemoteCommand["command"],
): RemoteCommand {
  return {
    protocol: "spatial.study6.companion.command.v1",
    kind: "command",
    command_id: "command-1",
    issued_at_unix_ms: 1_788_034_400_000,
    expected_revision: state.revision,
    command: operation,
  }
}

describe("bounded companion commands", () => {
  it("parses only the exact bounded envelope and allowlist", () => {
    const state = createInitialExperimentState()
    expect(parseRemoteCommandJson(JSON.stringify(command(state, "request_status"))).accepted).toBe(
      true,
    )
    expect(
      parseRemoteCommandJson(
        JSON.stringify({ ...command(state, "request_status"), participant_id: "PH1" }),
      ),
    ).toMatchObject({ accepted: false, code: "unknown_or_missing_field" })
    expect(
      parseRemoteCommandJson(
        JSON.stringify({ ...command(state, "request_status"), command: "set_answer" }),
      ),
    ).toMatchObject({ accepted: false, code: "unknown_command" })
  })

  it("requires fresh revisions and local enablement for mutations", () => {
    const state = createInitialExperimentState()
    expect(guardRemoteCommand(state, command(state, "request_status"), false).accepted).toBe(
      true,
    )
    expect(guardRemoteCommand(state, command(state, "recenter_panel"), false)).toMatchObject({
      accepted: false,
      code: "remote_control_disabled",
    })
    expect(
      guardRemoteCommand(
        state,
        { ...command(state, "request_status"), expected_revision: 99 },
        true,
      ),
    ).toMatchObject({ accepted: true })
    expect(
      guardRemoteCommand(
        state,
        { ...command(state, "recenter_panel"), expected_revision: 99 },
        true,
      ),
    ).toMatchObject({ accepted: false, code: "stale_revision" })
  })

  it("does not remotely advance setup, participant identity, consent, or unanswered pages", () => {
    let state = createInitialExperimentState()
    expect(guardRemoteCommand(state, command(state, "advance"), true)).toMatchObject({
      accepted: false,
      code: "advance_not_allowed",
    })
    const configured = reduceStudy(state, {
      type: "configure",
      configuration: { variantId: "DHS", languageCode: "en", timingMode: "clipped" },
    })
    expect(configured.accepted).toBe(true)
    state = configured.state
    expect(guardRemoteCommand(state, command(state, "advance"), true)).toMatchObject({
      accepted: false,
      code: "advance_not_allowed",
    })
  })

  it("emits privacy-minimized status with no identity or answers", () => {
    const state = {
      ...createInitialExperimentState(),
      participantId: "PRIVATE_PERSON_ID",
    }
    const status = remoteStatus(state)
    expect(status.participant_active).toBe(false)
    expect(JSON.stringify(status)).not.toContain("PRIVATE_PERSON_ID")
    expect(status.participant_data_eligible).toBe(false)
    expect(status.test_route).toBe(true)
  })
})

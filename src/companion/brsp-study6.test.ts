import { describe, expect, it } from 'vitest'

import {
  brspToRemoteCommand,
  remoteCommandToBrsp,
  STUDY6_BRSP_SCOPES,
} from './brsp-study6.ts'
import { remoteCommandNames } from './protocol.ts'

describe('Study 6 BRSP application profile', () => {
  it('maps every bounded remote action to exactly one negotiated scope', () => {
    expect(new Set(remoteCommandNames.map((name) => remoteCommandToBrsp(name).action))).toEqual(
      new Set(remoteCommandNames),
    )
    expect(new Set(remoteCommandNames.map((name) => remoteCommandToBrsp(name).scope))).toEqual(
      new Set(STUDY6_BRSP_SCOPES),
    )
  })

  it('accepts only the exact scope, action, and empty argument tuple', () => {
    expect(brspToRemoteCommand('study.media.control', 'pause_media', {})).toEqual({
      name: 'pause_media',
      args: {},
    })
    expect(brspToRemoteCommand('study.questionnaire.control', 'pause_media', {})).toBeNull()
    expect(brspToRemoteCommand('study.media.control', 'set_answer', {})).toBeNull()
    expect(brspToRemoteCommand('study.media.control', 'pause_media', { answer: 4 })).toBeNull()
  })

  it('accepts only bounded setup/participant arguments and keeps private responses out', () => {
    expect(brspToRemoteCommand('study.setup.control', 'configure_study', {
      variantId: 'DHS',
      languageCode: 'en',
      timingMode: 'clipped',
    })).toMatchObject({ name: 'configure_study' })
    expect(brspToRemoteCommand('study.participant.control', 'start_participant', {
      participantId: 'PH1',
    })).toEqual({ name: 'start_participant', args: { participantId: 'PH1' } })
    expect(brspToRemoteCommand('study.participant.control', 'start_participant', {
      participantId: 'PH1',
      consent: true,
    })).toBeNull()
    expect(remoteCommandNames).not.toContain('set_answer')
    expect(remoteCommandNames).not.toContain('set_demographics')
    expect(remoteCommandNames).not.toContain('set_consent')
  })
})

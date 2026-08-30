import { describe, expect, it } from 'vitest'

import type { SpatialStudyPanel } from '../ui/index.ts'
import { StudyPanelRenderer, type StudyPanelActions } from './panel-renderer.ts'

interface RendererDrafts {
  setup: { languageCode: string; variantId: string | null; timingMode: string }
  participantDraft: string
  demographics: {
    firstName: string
    lastName: string
    ageYears: number | undefined
    handedness: string | null
    gender: string | null
    consentConfirmed: boolean
  }
}

describe('StudyPanelRenderer transient privacy boundary', () => {
  it('can initialize the native demographics parity fixture without persistent storage', () => {
    const renderer = new StudyPanelRenderer(
      {} as SpatialStudyPanel,
      {} as StudyPanelActions,
      {
        firstName: 'Debug',
        lastName: 'Preview',
        ageYears: 30,
        handedness: 'right',
        gender: 'prefer_not_to_say',
        consentConfirmed: true,
      },
    )

    expect((renderer as unknown as RendererDrafts).demographics).toEqual({
      firstName: 'Debug',
      lastName: 'Preview',
      ageYears: 30,
      handedness: 'right',
      gender: 'prefer_not_to_say',
      consentConfirmed: true,
    })
  })

  it('clears setup, participant, demographics, consent, and keypad drafts', () => {
    const renderer = new StudyPanelRenderer(
      {} as SpatialStudyPanel,
      {} as StudyPanelActions,
    )
    const drafts = renderer as unknown as RendererDrafts
    drafts.setup = { languageCode: 'de', variantId: 'DHS', timingMode: 'clipped' }
    drafts.participantDraft = 'PH24'
    drafts.demographics = {
      firstName: 'Private',
      lastName: 'Person',
      ageYears: 42,
      handedness: 'left',
      gender: 'other',
      consentConfirmed: true,
    }

    renderer.resetTransientState()

    expect(drafts.setup).toEqual({ languageCode: 'en', variantId: null, timingMode: 'full' })
    expect(drafts.participantDraft).toBe('')
    expect(drafts.demographics).toEqual({
      firstName: '',
      lastName: '',
      ageYears: undefined,
      handedness: null,
      gender: null,
      consentConfirmed: false,
    })
  })
})

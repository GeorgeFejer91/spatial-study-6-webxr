import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Object3D } from 'three'

import {
  createInitialExperimentState,
  emptyAssessmentDraft,
  type ExperimentPage,
  type ExperimentState,
} from '../study/index.ts'
import {
  QUESTIONNAIRE_VISUAL_AUTHORITY,
  QUESTIONNAIRE_VISUAL_CONTRACT,
  SpatialStudyPanel,
  STUDY_UI_COLORS,
} from '../ui/index.ts'
import { samRow, scaleChoice, spatialScale } from './components.ts'
import { StudyPanelRenderer, type StudyPanelActions } from './panel-renderer.ts'

type PropertyObject = Object3D & {
  inputProperties?: Record<string, unknown>
}

const panels: SpatialStudyPanel[] = []

function property(object: Object3D, name: string): unknown {
  return (object as PropertyObject).inputProperties?.[name]
}

function named(root: Object3D, name: string): Object3D {
  const object = root.getObjectByName(name)
  expect(object, `missing UIKit object ${name}`).toBeDefined()
  return object as Object3D
}

function questionnaireState(page: ExperimentPage): ExperimentState {
  return {
    ...createInitialExperimentState(),
    page,
    configuration: { variantId: 'DHS', languageCode: 'en', timingMode: 'clipped' },
    assessmentDraft: emptyAssessmentDraft(),
  }
}

function actions(): StudyPanelActions {
  return {
    configure: vi.fn(),
    setDemographicsLanguage: vi.fn(),
    startParticipant: vi.fn(),
    submitDemographics: vi.fn(),
    startBlock: vi.fn(),
    setSam: vi.fn(),
    setAffect: vi.fn(),
    setEmotion: vi.fn(),
    setHand: vi.fn(),
    advanceAssessment: vi.fn(),
    backAssessment: vi.fn(),
    exportJson: vi.fn(),
    exportCsv: vi.fn(),
    startNewSession: vi.fn(),
  }
}

function render(page: ExperimentPage, mutate?: (state: ExperimentState) => void) {
  const panel = new SpatialStudyPanel()
  panels.push(panel)
  const state = questionnaireState(page)
  mutate?.(state)
  new StudyPanelRenderer(panel, actions()).render(state, {
    usedParticipantIds: [],
    localMessage: '',
    storageHealthy: true,
  })
  return panel
}

afterEach(() => {
  panels.splice(0).forEach((panel) => panel.dispose())
  document.body.replaceChildren()
})

describe('pinned native questionnaire authority', () => {
  it('locks the WebXR projection to the native source revision and frame', () => {
    expect(QUESTIONNAIRE_VISUAL_AUTHORITY.sourceRevision).toBe(
      'dd41646e02e4a1d73b990626b74048d34ce8f26a',
    )
    expect(QUESTIONNAIRE_VISUAL_CONTRACT.panel).toMatchObject({
      width: 1080,
      height: 720,
      paddingTop: 24,
      paddingRight: 28,
      paddingBottom: 22,
      paddingLeft: 28,
      borderWidth: 1,
      borderRadius: 0,
    })
  })

  it('projects the exact panel, header, body, and footer geometry', () => {
    const panel = new SpatialStudyPanel({ title: 'How did you feel?' })
    panels.push(panel)

    expect(property(panel.root, 'width')).toBe(1080)
    expect(property(panel.root, 'height')).toBe(720)
    expect(property(panel.root, 'paddingLeft')).toBe(28)
    expect(property(panel.root, 'paddingRight')).toBe(28)
    expect(property(panel.root, 'borderRadius')).toBe(0)
    expect(property(panel.root, 'backgroundColor')).toBe(STUDY_UI_COLORS.panel)
    expect(property(panel.header, 'height')).toBe(72)
    expect(property(panel.body, 'paddingTop')).toBe(8)
    expect(property(panel.body, 'paddingBottom')).toBe(16)
    expect(property(panel.footer, 'height')).toBe(66)
  })

  it('toggles the native pointer/direct control and one-sixth physical panel scale', () => {
    const changed = vi.fn()
    const panel = new SpatialStudyPanel({ onInteractionModeChange: changed })
    panels.push(panel)
    panel.setInteractionModeControlVisible(true)
    panel.setInteractionMode('direct')

    expect(changed).toHaveBeenCalledWith('direct')
    expect(property(panel.progress, 'text')).toBe('Direct mode')
    expect(property(panel.progress, 'width')).toBe(164)
    expect(property(panel.progress, 'height')).toBe(52)
    expect(property(panel.root, 'pixelSize')).toBeCloseTo(0.00125 / 6, 12)
  })
})

describe('native questionnaire controls', () => {
  it('uses measured SAM cards, side labels, gold selection, and dominance overflow', () => {
    const valence = samRow({
      question: '',
      lowLabel: 'Unpleasant',
      highLabel: 'Pleasant',
      dimension: 'valence',
      selected: 5,
      onSelect: vi.fn(),
    })
    const selected = named(valence, 'study6-sam-row-valence-choice-5')
    expect(property(selected, 'width')).toBe(72)
    expect(property(selected, 'height')).toBe(93)
    expect(property(selected, 'borderRadius')).toBe(7)
    expect(property(selected, 'backgroundColor')).toBe(STUDY_UI_COLORS.selected)
    expect(property(named(valence, 'study6-sam-row-valence-choices'), 'width')).toBe(744)
    expect(property(named(valence, 'study6-sam-row-valence-low-label'), 'width')).toBe(90)

    const dominance = samRow({
      question: 'Control',
      lowLabel: 'Not in control',
      highLabel: 'In control',
      dimension: 'dominance',
      selected: null,
      onSelect: vi.fn(),
    })
    const largest = named(dominance, 'study6-sam-row-dominance-choice-9-image')
    expect(property(largest, 'width')).toBeCloseTo(103.224, 3)
    expect(Number(property(largest, 'width'))).toBeGreaterThan(72)
  })

  it('keeps the native slider shell, thumb, track, and numeric bubble visible before touch', () => {
    const slider = spatialScale({
      question: 'How pleasant?',
      minimum: -100,
      maximum: 100,
      value: 0,
      touched: false,
      lowLabel: 'Unpleasant',
      highLabel: 'Pleasant',
      neutralLabel: '0 (neutral)',
      signed: true,
      name: 'test-affect',
      onChange: vi.fn(),
    })

    expect(property(named(slider, 'test-affect-touch-shell'), 'height')).toBe(88)
    expect(property(named(slider, 'test-affect-track'), 'height')).toBe(12)
    expect(property(named(slider, 'test-affect-thumb'), 'width')).toBe(30)
    const bubble = named(slider, 'test-affect-value-bubble')
    expect(property(bubble, 'width')).toBe(86)
    expect(property(bubble, 'height')).toBe(26)
    expect(property(bubble.children[0], 'text')).toBe('0')
    expect(named(slider, 'test-affect-zero-marker')).toBeDefined()
  })

  it('uses seven discrete embodiment choices rather than a slider', () => {
    const choice = scaleChoice({
      question: 'The virtual hands felt like my own hands.',
      lowLabel: 'Strongly disagree',
      highLabel: 'Strongly agree',
      selected: 4,
      name: 'test-hand',
      onSelect: vi.fn(),
    })
    const row = named(choice, 'test-hand-choices')
    expect(row.children).toHaveLength(7)
    expect(named(choice, 'test-hand-choice-4')).toBeDefined()
    expect(choice.getObjectByName('test-hand-track')).toBeUndefined()
  })
})

describe('questionnaire page composition and gating', () => {
  it('uses the compact native demographics frame and two-column surface', () => {
    const panel = render('demographics')
    expect(property(panel.root, 'paddingTop')).toBe(20)
    expect(property(panel.root, 'paddingBottom')).toBe(20)
    expect(property(panel.header, 'height')).toBe(54)
    expect(property(panel.body, 'paddingTop')).toBe(4)
    expect(property(panel.footer, 'height')).toBe(0)
    expect(named(panel.body, 'study6-demographics-polar-status')).toBeDefined()
  })

  it('keeps SAM navigation in the footer with no Back button', () => {
    const panel = render('self_assessment_manikin')
    expect(panel.body.getObjectByName('study6-questionnaire-sam')).toBeDefined()
    expect(panel.footer.getObjectByName('study6-questionnaire-back')).toBeUndefined()
    expect(property(named(panel.footer, 'study6-questionnaire-next'), 'pointerEvents')).toBe(
      'none',
    )
  })

  it('arranges emotion sliders as two rows of three and enables Continue only after all touches', () => {
    const incomplete = render('emotion_representation_vas')
    expect(named(incomplete.body, 'study6-emotion-row-1').children).toHaveLength(3)
    expect(named(incomplete.body, 'study6-emotion-row-2').children).toHaveLength(3)
    expect(property(named(incomplete.footer, 'study6-questionnaire-next'), 'pointerEvents')).toBe(
      'none',
    )

    const complete = render('emotion_representation_vas', (state) => {
      state.assessmentDraft.angerTouched = true
      state.assessmentDraft.disgustTouched = true
      state.assessmentDraft.fearTouched = true
      state.assessmentDraft.happinessTouched = true
      state.assessmentDraft.sadnessTouched = true
      state.assessmentDraft.surpriseTouched = true
    })
    expect(property(named(complete.footer, 'study6-questionnaire-next'), 'pointerEvents')).toBe(
      'auto',
    )
  })

  it('renders two seven-button embodiment rows and the native footer widths', () => {
    const panel = render('hand_embodiment')
    expect(named(panel.body, 'study6-hand-ownership-choices').children).toHaveLength(7)
    expect(named(panel.body, 'study6-hand-agency-choices').children).toHaveLength(7)
    expect(property(named(panel.footer, 'study6-questionnaire-back'), 'width')).toBe(150)
    expect(property(named(panel.footer, 'study6-questionnaire-next'), 'width')).toBe(230)
  })
})

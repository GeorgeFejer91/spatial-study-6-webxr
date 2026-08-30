import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Object3D } from 'three'

import type { PolarStatusProjection } from '../bridge/index.ts'
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

interface TestGestureEvent {
  uv?: { x: number }
  pointerId?: number
  stopPropagation: ReturnType<typeof vi.fn>
  stopImmediatePropagation: ReturnType<typeof vi.fn>
}

type GestureHandlerName =
  | 'onPointerDown'
  | 'onPointerMove'
  | 'onPointerUp'
  | 'onPointerCancel'

type CapturableObject = Object3D & {
  setPointerCapture: ReturnType<typeof vi.fn>
  releasePointerCapture: ReturnType<typeof vi.fn>
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

function gestureHandler(
  object: Object3D,
  name: GestureHandlerName,
): (event: TestGestureEvent) => void {
  const handler = property(object, name)
  expect(handler, `missing UIKit gesture handler ${name}`).toBeTypeOf('function')
  return handler as (event: TestGestureEvent) => void
}

function gestureEvent(pointerId: number, uvX?: number): TestGestureEvent {
  return {
    ...(uvX === undefined ? {} : { uv: { x: uvX } }),
    pointerId,
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  }
}

function makeCapturable(object: Object3D): CapturableObject {
  const capturable = object as CapturableObject
  capturable.setPointerCapture = vi.fn<(pointerId: number) => void>()
  capturable.releasePointerCapture = vi.fn<(pointerId: number) => void>()
  return capturable
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

function render(
  page: ExperimentPage,
  mutate?: (state: ExperimentState) => void,
  polar?: PolarStatusProjection,
) {
  const panel = new SpatialStudyPanel()
  panels.push(panel)
  const state = questionnaireState(page)
  mutate?.(state)
  new StudyPanelRenderer(panel, actions()).render(state, {
    participantProgress: [],
    localMessage: '',
    storageHealthy: true,
    polar,
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
      '384935890d8ba29a2851002163352019d65768f6',
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

  it('admits the native pointer/direct control only on the explicit QA surface', () => {
    const changed = vi.fn()
    const panel = new SpatialStudyPanel({
      allowDirectMode: true,
      onInteractionModeChange: changed,
    })
    panels.push(panel)
    panel.setInteractionModeControlVisible(true)
    panel.setInteractionMode('direct')

    expect(changed).toHaveBeenCalledWith('direct')
    expect(property(panel.progress, 'text')).toBe('Direct mode')
    expect(property(panel.progress, 'width')).toBe(164)
    expect(property(panel.progress, 'height')).toBe(52)
    expect(property(panel.kioskStatus, 'width')).toBe(142)
    expect(property(panel.kioskStatus, 'height')).toBe(52)
    expect(property(panel.kioskStatus, 'text')).toBe('Kiosk | Off')
    expect(property(panel.kioskStatus, 'pointerEvents')).toBe('none')
    expect(property(panel.root, 'pixelSize')).toBeCloseTo(0.00125 / 6, 12)
  })

  it('keeps production pointer-only and rejects programmatic Direct requests', () => {
    const changed = vi.fn()
    const panel = new SpatialStudyPanel({ onInteractionModeChange: changed })
    panels.push(panel)
    panel.setInteractionModeControlVisible(true)

    expect(panel.setInteractionMode('direct')).toBe(false)
    expect(changed).not.toHaveBeenCalled()
    expect(property(panel.progress, 'display')).toBe('none')
    expect(property(panel.progress, 'pointerEvents')).toBe('none')
    expect(property(panel.kioskStatus, 'display')).toBe('flex')
    expect(property(panel.root, 'pixelSize')).toBeCloseTo(0.00125, 12)
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
    expect((largest as Object3D & { material: { clippingPlanes: unknown[] } }).material.clippingPlanes).toEqual([])
  })

  it('renders all 27 native SAM figures with intentional overflow unclipped', () => {
    const panel = render('self_assessment_manikin')
    const images: Object3D[] = []
    panel.body.traverse((object) => {
      if (object.name.endsWith('-image')) images.push(object)
    })

    expect(images).toHaveLength(27)
    images.forEach((image) => {
      expect(property(image, 'src')).toMatch(/assets\/sam\/(?:valence|arousal)\/.+\.png$/)
      expect(
        (image as Object3D & { material: { clippingPlanes: unknown[] } }).material.clippingPlanes,
      ).toEqual([])
    })
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
    const track = named(slider, 'test-affect-track')
    expect(property(track, 'height')).toBe(12)
    expect(property(track, 'width')).toBe(988)
    expect(property(track, 'positionLeft')).toBe(18)
    expect(property(named(slider, 'test-affect-thumb'), 'width')).toBe(30)
    const bubble = named(slider, 'test-affect-value-bubble')
    expect(property(bubble, 'width')).toBe(86)
    expect(property(bubble, 'height')).toBe(26)
    expect(property(bubble.children[0], 'text')).toBe('0')
    expect(named(slider, 'test-affect-zero-marker')).toBeDefined()
  })

  it('drags sliders continuously, clamps and rounds locally, then commits once on release', () => {
    const changed = vi.fn()
    const slider = spatialScale({
      question: 'How pleasant?',
      minimum: 0,
      maximum: 100,
      value: 0,
      touched: false,
      lowLabel: 'Low',
      highLabel: 'High',
      width: 100,
      showFill: true,
      name: 'test-drag-slider',
      onChange: changed,
    })
    const shell = makeCapturable(named(slider, 'test-drag-slider-touch-shell'))
    const bubbleText = named(slider, 'test-drag-slider-value-bubble').children[0]
    const down = gestureEvent(41, -1)
    const roundedMove = gestureEvent(41, (18 + 0.505 * 64) / 100)
    const clampedMove = gestureEvent(41, 2)
    const releaseOutside = gestureEvent(41)

    gestureHandler(shell, 'onPointerDown')(down)
    expect(shell.setPointerCapture).toHaveBeenCalledWith(41)
    expect(property(bubbleText, 'text')).toBe('0')
    expect(changed).not.toHaveBeenCalled()

    gestureHandler(shell, 'onPointerMove')(roundedMove)
    expect(property(bubbleText, 'text')).toBe('51')
    expect(changed).not.toHaveBeenCalled()

    gestureHandler(shell, 'onPointerMove')(clampedMove)
    expect(property(bubbleText, 'text')).toBe('100')
    expect(property(named(slider, 'test-drag-slider-thumb'), 'positionLeft')).toBe(67)
    expect(changed).not.toHaveBeenCalled()

    gestureHandler(shell, 'onPointerUp')(releaseOutside)
    expect(shell.releasePointerCapture).toHaveBeenCalledWith(41)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(changed).toHaveBeenCalledWith(100)
    for (const event of [down, roundedMove, clampedMove, releaseOutside]) {
      expect(event.stopImmediatePropagation).toHaveBeenCalled()
    }
  })

  it('retains the latest native slider value on pointer cancellation and releases capture', () => {
    const changed = vi.fn()
    const slider = spatialScale({
      question: 'Intensity',
      minimum: 0,
      maximum: 100,
      value: 0,
      touched: false,
      lowLabel: 'Low',
      highLabel: 'High',
      width: 100,
      name: 'test-cancel-slider',
      onChange: changed,
    })
    const shell = makeCapturable(named(slider, 'test-cancel-slider-touch-shell'))
    const cancel = gestureEvent(9)

    gestureHandler(shell, 'onPointerDown')(gestureEvent(9, 0))
    gestureHandler(shell, 'onPointerMove')(gestureEvent(9, 0.5))
    gestureHandler(shell, 'onPointerCancel')(cancel)

    expect(shell.releasePointerCapture).toHaveBeenCalledWith(9)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(changed).toHaveBeenCalledWith(50)
    expect(cancel.stopImmediatePropagation).toHaveBeenCalled()
  })

  it('uses one row-wide SAM drag overlay and commits the nearest choice after release', () => {
    const selected = vi.fn()
    const row = samRow({
      question: 'Control',
      lowLabel: 'Low',
      highLabel: 'High',
      dimension: 'dominance',
      selected: null,
      onSelect: selected,
    })
    const overlay = makeCapturable(named(row, 'study6-sam-row-dominance-hit-overlay'))
    const down = gestureEvent(17, -1)
    const middle = gestureEvent(17, 0.5)
    const beyondLast = gestureEvent(17, 2)
    const releaseOutside = gestureEvent(17)

    expect(property(overlay, 'width')).toBe(744)
    expect(property(overlay, 'height')).toBe(139)
    expect(property(named(row, 'study6-sam-row-dominance-choice-1'), 'pointerEvents')).toBe(
      'none',
    )

    gestureHandler(overlay, 'onPointerDown')(down)
    expect(property(named(row, 'study6-sam-row-dominance-choice-1'), 'backgroundColor')).toBe(
      STUDY_UI_COLORS.selected,
    )
    gestureHandler(overlay, 'onPointerMove')(middle)
    expect(property(named(row, 'study6-sam-row-dominance-choice-5'), 'backgroundColor')).toBe(
      STUDY_UI_COLORS.selected,
    )
    gestureHandler(overlay, 'onPointerMove')(beyondLast)
    expect(property(named(row, 'study6-sam-row-dominance-choice-9'), 'backgroundColor')).toBe(
      STUDY_UI_COLORS.selected,
    )
    expect(selected).not.toHaveBeenCalled()

    gestureHandler(overlay, 'onPointerUp')(releaseOutside)
    expect(overlay.setPointerCapture).toHaveBeenCalledWith(17)
    expect(overlay.releasePointerCapture).toHaveBeenCalledWith(17)
    expect(selected).toHaveBeenCalledTimes(1)
    expect(selected).toHaveBeenCalledWith(9)
    for (const event of [down, middle, beyondLast, releaseOutside]) {
      expect(event.stopImmediatePropagation).toHaveBeenCalled()
    }
  })

  it('retains the latest SAM drag choice on cancellation without duplicate commits', () => {
    const selected = vi.fn()
    const row = samRow({
      question: '',
      lowLabel: 'Low',
      highLabel: 'High',
      dimension: 'valence',
      selected: 5,
      onSelect: selected,
    })
    const overlay = makeCapturable(named(row, 'study6-sam-row-valence-hit-overlay'))

    gestureHandler(overlay, 'onPointerDown')(gestureEvent(23, 0.5))
    gestureHandler(overlay, 'onPointerMove')(gestureEvent(23, 0.7))
    gestureHandler(overlay, 'onPointerCancel')(gestureEvent(23))
    gestureHandler(overlay, 'onPointerUp')(gestureEvent(23, 1))

    expect(selected).toHaveBeenCalledTimes(1)
    expect(selected).toHaveBeenCalledWith(7)
    expect(overlay.releasePointerCapture).toHaveBeenCalledWith(23)
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
  it.each([
    'self_assessment_manikin',
    'affect_vas',
    'emotion_representation_vas',
    'hand_embodiment',
  ] as const)('disables parent scrolling for the %s assessment surface', (page) => {
    const panel = render(page)
    expect(property(panel.body, 'overflow')).toBe('hidden')
  })

  it('preserves same-page scroll but resets it across pages and transient sessions', () => {
    const panel = new SpatialStudyPanel()
    panels.push(panel)
    const renderer = new StudyPanelRenderer(panel, actions())
    const context = {
      participantProgress: [],
      localMessage: '',
      storageHealthy: true,
    }
    const participant = questionnaireState('participant_id')

    renderer.render(participant, context)
    panel.body.scrollPosition.value = [0, -120]
    panel.body.scrollVelocity.set(0, -8)
    renderer.render(participant, context)

    expect(panel.body.scrollPosition.value).toEqual([0, -120])
    expect(panel.body.scrollVelocity.y).toBe(-8)

    renderer.resetTransientState()
    renderer.render(participant, context)

    expect(panel.body.scrollPosition.value).toEqual([0, 0])
    expect(panel.body.scrollVelocity.y).toBe(0)

    panel.body.scrollPosition.value = [0, -80]
    panel.body.scrollVelocity.set(0, -4)
    renderer.render(questionnaireState('demographics'), context)

    expect(panel.body.scrollPosition.value).toEqual([0, 0])
    expect(panel.body.scrollVelocity.y).toBe(0)
  })

  it('uses the compact native demographics frame and two-column surface', () => {
    const panel = render('demographics')
    expect(property(panel.root, 'paddingTop')).toBe(20)
    expect(property(panel.root, 'paddingBottom')).toBe(20)
    expect(property(panel.header, 'height')).toBe(54)
    expect(property(panel.body, 'paddingTop')).toBe(4)
    expect(property(panel.body, 'overflow')).toBe('scroll')
    expect(property(panel.footer, 'height')).toBe(0)
    expect(named(panel.body, 'study6-demographics-polar-status')).toBeDefined()
    expect(named(panel.body, 'study6-polar-waveform-empty')).toBeDefined()
  })

  it('projects only real APK ECG samples into the live demographics waveform', () => {
    const polar: PolarStatusProjection = {
      phase: 'streaming',
      ready: true,
      readinessReason: 'ready',
      heartRateBpm: 64,
      rrIntervalCount: 12,
      ecgSampleRateHz: 130,
      ecgSampleCount: 3_900,
      lastSampleAgeMs: 18,
      stableDurationMs: 30_000,
      previewKind: 'real_samples',
      waveformMicrovolts: [-20, -10, 4, 80, -44, -12, 0, 8],
      writer: {
        phase: 'recording',
        healthy: true,
        queueDepth: 0,
        storageFreeBytes: 2_000_000_000,
      },
      reconnectCount: 0,
      gapCount: 0,
    }
    const panel = render('demographics', undefined, polar)
    const status = named(panel.body, 'study6-demographics-polar-status')
    expect(property(status, 'backgroundColor')).toBe(STUDY_UI_COLORS.successSoft)
    expect(named(panel.body, 'study6-polar-waveform-real').children).toHaveLength(8)
    expect(panel.body.getObjectByName('study6-polar-waveform-empty')).toBeUndefined()
  })

  it('keeps SAM navigation in the footer with no Back button', () => {
    const panel = render('self_assessment_manikin')
    expect(property(panel.body, 'overflow')).toBe('hidden')
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

  it('keeps all 24 participant boxes selectable and colors only completed segments', () => {
    const panel = new SpatialStudyPanel()
    panels.push(panel)
    const state = questionnaireState('participant_id')
    new StudyPanelRenderer(panel, actions()).render(state, {
      participantProgress: [
        {
          participantId: 'PH1',
          completedBlocks: 2,
          completedDatasets: 0,
          hasIncompleteDataset: true,
          completedConditions: ['HC_HE', 'LC_HE'],
          resumableSessionId: 'session-partial',
        },
        {
          participantId: 'PH2',
          completedBlocks: 4,
          completedDatasets: 2,
          hasIncompleteDataset: false,
          completedConditions: ['HC_HE', 'LC_HE', 'HC_LE', 'LC_LE'],
          resumableSessionId: null,
        },
      ],
      localMessage: '',
      storageHealthy: true,
    })

    for (let index = 1; index <= 24; index += 1) {
      expect(property(named(panel.body, `study6-participant-PH${index}`), 'pointerEvents')).toBe(
        'auto',
      )
    }
    expect(
      property(named(panel.body, 'study6-participant-PH1-segment-1'), 'backgroundColor'),
    ).toBe(STUDY_UI_COLORS.success)
    expect(
      property(named(panel.body, 'study6-participant-PH1-segment-2'), 'backgroundColor'),
    ).toBe(STUDY_UI_COLORS.success)
    expect(
      property(named(panel.body, 'study6-participant-PH1-segment-3'), 'backgroundColor'),
    ).toBe(STUDY_UI_COLORS.border)
    expect(
      property(named(panel.body, 'study6-participant-PH2-segment-4'), 'backgroundColor'),
    ).toBe(STUDY_UI_COLORS.success)
  })

  it('keeps the block start control enabled when APK ECG preflight is not ready', () => {
    const panel = new SpatialStudyPanel()
    panels.push(panel)
    const state = questionnaireState('block_ready')
    state.blocks = [
      {
        blockOrder: 1,
        conditionId: 'HC_HE',
        mediaId: 'Hand_HC_HE',
        videoFile: 'Hand_HC_HE.mp4',
        audioVariantId: 'V01',
        audioFile: 'study6_neutral_hand_audio_V01_EN.mp3',
        permutationId: 'perm_01',
        blockId: 'block-1',
        attemptId: 'attempt-1',
        status: 'pending',
        questionnaire: null,
      },
    ]
    new StudyPanelRenderer(panel, actions()).render(state, {
      participantProgress: [],
      localMessage: '',
      storageHealthy: true,
      startPreflightReady: false,
    })
    expect(property(named(panel.body, 'study6-block-start'), 'pointerEvents')).toBe('auto')
  })
})

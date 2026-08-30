import './style.css'

import { StudyPanelRenderer, type StudyPanelActions } from './app/panel-renderer.ts'
import {
  createInitialExperimentState,
  type AssessmentPage,
  type ExperimentState,
  type LanguageCode,
} from './study/index.ts'
import { createBrowserStudyShell, SpatialStudyPanel } from './ui/index.ts'
import { createStudyXRRuntime, type StudyXRRuntime } from './xr/index.ts'

const PAGE_TOKENS = {
  demographics: 'demographics',
  sam: 'self_assessment_manikin',
  affect: 'affect_vas',
  emotion: 'emotion_representation_vas',
  hand: 'hand_embodiment',
} as const

type PreviewPageToken = keyof typeof PAGE_TOKENS
type PreviewState = 'empty' | 'complete'

function fixedQuery<T extends string>(
  parameters: URLSearchParams,
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = parameters.get(name)
  return value !== null && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

function previewState(
  page: ExperimentState['page'],
  languageCode: LanguageCode,
  state: PreviewState,
): ExperimentState {
  const experiment = createInitialExperimentState()
  experiment.page = page
  experiment.configuration = { variantId: 'DHS', languageCode, timingMode: 'clipped' }
  experiment.currentBlockIndex = 0
  if (state === 'complete') {
    Object.assign(experiment.assessmentDraft, {
      samValence: 5,
      samArousal: 6,
      samDominance: 4,
      affectValence: 25,
      affectArousal: -20,
      affectValenceTouched: true,
      affectArousalTouched: true,
      anger: 20,
      disgust: 30,
      fear: 40,
      happiness: 70,
      sadness: 10,
      surprise: 60,
      angerTouched: true,
      disgustTouched: true,
      fearTouched: true,
      happinessTouched: true,
      sadnessTouched: true,
      surpriseTouched: true,
      handOwnership: 5,
      handAgency: 6,
    })
  }
  return experiment
}

const app = document.querySelector<HTMLElement>('#app')
if (!app) throw new Error('Questionnaire parity preview root is missing.')
app.replaceChildren()

const query = new URLSearchParams(window.location.search)
const pageToken = fixedQuery(
  query,
  'page',
  Object.keys(PAGE_TOKENS) as PreviewPageToken[],
  'sam',
)
const stateToken = fixedQuery(query, 'state', ['empty', 'complete'] as const, 'empty')
const language = fixedQuery(query, 'language', ['en', 'de'] as const, 'en')
const initialMode = fixedQuery(query, 'mode', ['pointer', 'direct'] as const, 'pointer')

const shell = createBrowserStudyShell(app, {
  title: 'Study 6 questionnaire parity preview',
  interactiveView: 'In-memory Study 6 questionnaire parity preview',
  testOnly: 'QUESTIONNAIRE PARITY | NO DATA',
})
let runtime: StudyXRRuntime
const panel = new SpatialStudyPanel({
  onInteractionModeChange: (mode) => runtime?.setPanelInteractionMode(mode),
})
runtime = createStudyXRRuntime({
  canvas: shell.canvas,
  requestHandTracking: false,
  onXRStateChange: (presenting) => shell.setXRPresenting(presenting),
  onInputModeChange: ({ left, right }) =>
    shell.setStatus(`questionnaire parity | ${pageToken} | ${stateToken} | ${left}/${right}`),
})
runtime.attachUiRoot(panel.root, true)

let state = previewState(PAGE_TOKENS[pageToken], language, stateToken)
const assessmentPages: AssessmentPage[] = [
  'self_assessment_manikin',
  'affect_vas',
  'emotion_representation_vas',
  'hand_embodiment',
]

const render = () => {
  renderer.render(state, {
    usedParticipantIds: [],
    localMessage: 'In-memory questionnaire parity preview | no data',
    storageHealthy: true,
  })
  shell.setStatus(`questionnaire parity | ${state.page} | ${stateToken} | no data`)
}

const actions: StudyPanelActions = {
  configure: () => undefined,
  setDemographicsLanguage: (languageCode) => {
    if (state.configuration) state.configuration.languageCode = languageCode
    render()
  },
  startParticipant: () => undefined,
  submitDemographics: () => undefined,
  startBlock: () => undefined,
  setSam: (dimension, value) => {
    state.assessmentDraft[
      dimension === 'valence'
        ? 'samValence'
        : dimension === 'arousal'
          ? 'samArousal'
          : 'samDominance'
    ] = value
    render()
  },
  setAffect: (dimension, value) => {
    if (dimension === 'valence') {
      state.assessmentDraft.affectValence = value
      state.assessmentDraft.affectValenceTouched = true
    } else {
      state.assessmentDraft.affectArousal = value
      state.assessmentDraft.affectArousalTouched = true
    }
    render()
  },
  setEmotion: (emotion, value) => {
    state.assessmentDraft[emotion] = value
    state.assessmentDraft[`${emotion}Touched`] = true
    render()
  },
  setHand: (dimension, value) => {
    state.assessmentDraft[dimension === 'ownership' ? 'handOwnership' : 'handAgency'] = value
    render()
  },
  advanceAssessment: () => {
    const index = assessmentPages.indexOf(state.page as AssessmentPage)
    if (index >= 0 && index < assessmentPages.length - 1) {
      state = { ...state, page: assessmentPages[index + 1] }
      render()
    }
  },
  backAssessment: () => {
    const index = assessmentPages.indexOf(state.page as AssessmentPage)
    if (index > 0) {
      state = { ...state, page: assessmentPages[index - 1] }
      render()
    }
  },
  exportJson: () => undefined,
  exportCsv: () => undefined,
  startNewSession: () => undefined,
}

const renderer = new StudyPanelRenderer(panel, actions)
if (initialMode === 'direct') panel.setInteractionMode('direct')
render()

shell.enterVRButton.addEventListener('click', async () => {
  if (runtime.renderer.xr.isPresenting) await runtime.exitXR()
  else await runtime.enterXR()
})
shell.recenterButton.addEventListener('click', () => runtime.recenterPanel())

void runtime.isImmersiveSupported().then((supported) => shell.setXRAvailability(supported))

window.addEventListener(
  'pagehide',
  () => {
    runtime.dispose()
    panel.dispose()
    shell.destroy()
  },
  { once: true },
)

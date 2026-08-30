import './style.css'

import { StudyController } from './app/controller.ts'
import {
  StudyPanelRenderer,
  type StudyPanelActions,
} from './app/panel-renderer.ts'
import { StudySceneRoot } from './app/scene-root.ts'
import { createDefaultStudyBridgeClient } from './bridge/index.ts'
import { StudyMediaPlayer } from './media/player.ts'
import { isVerifiedPackagedPwa } from './pwa/immersive-launch.ts'
import { createBrowserStudyShell, SpatialStudyPanel } from './ui/index.ts'
import { createStudyXRRuntime } from './xr/index.ts'
import type { StudyXRRuntime } from './xr/study-xr-runtime.ts'

const app = document.querySelector<HTMLElement>('#app')
if (!app) throw new Error('Spatial Study 6 root element is missing.')
app.replaceChildren()

// WebXR always owns the experiment reducer. The deployed route additionally
// requires the native sensor recorder; disabling it is an explicit
// participant-ineligible questionnaire/UI rehearsal.
const sensorDisabledRehearsal =
  new URLSearchParams(window.location.search).get('sensor') === 'disabled-rehearsal'

const shell = createBrowserStudyShell(app)
let runtime: StudyXRRuntime
const panel = new SpatialStudyPanel({
  onInteractionModeChange: (mode) => runtime?.setPanelInteractionMode(mode),
})
let controller: StudyController | undefined
let liveActions: StudyPanelActions | undefined

const media = new StudyMediaPlayer({
  onEnded: (snapshot) => controller?.onMediaEnded(snapshot),
  onError: (snapshot) => controller?.onMediaError(snapshot),
  onToggleRequest: (snapshot) => controller?.onMediaToggleRequest(snapshot),
})
const sceneRoot = new StudySceneRoot(panel, media)
runtime = createStudyXRRuntime({
  canvas: shell.canvas,
  onFrame: ({ time }) => controller?.onFrame(time),
  onXRStateChange: (presenting) => controller?.onXRStateChange(presenting),
  onInputModeChange: ({ left, right }) => {
    if (left !== 'none' || right !== 'none') {
      shell.setStatus(`XR input · left ${left} · right ${right}`)
    }
  },
})
runtime.attachUiRoot(sceneRoot, true)

const actionProxy: StudyPanelActions = {
  configure: (value) => liveActions?.configure(value),
  setDemographicsLanguage: (value) => liveActions?.setDemographicsLanguage(value),
  startParticipant: (value) => liveActions?.startParticipant(value),
  submitDemographics: (value) => liveActions?.submitDemographics(value),
  startBlock: () => liveActions?.startBlock(),
  setSam: (dimension, value) => liveActions?.setSam(dimension, value),
  setAffect: (dimension, value) => liveActions?.setAffect(dimension, value),
  setEmotion: (emotion, value) => liveActions?.setEmotion(emotion, value),
  setHand: (dimension, value) => liveActions?.setHand(dimension, value),
  advanceAssessment: () => liveActions?.advanceAssessment(),
  backAssessment: () => liveActions?.backAssessment(),
  exportJson: () => liveActions?.exportJson(),
  exportCsv: () => liveActions?.exportCsv(),
  startNewSession: () => liveActions?.startNewSession(),
}
const panelRenderer = new StudyPanelRenderer(panel, actionProxy)
controller = new StudyController({
  shell,
  runtime,
  media,
  panelRenderer,
  ...(sensorDisabledRehearsal ? {} : { bridge: createDefaultStudyBridgeClient() }),
})
liveActions = controller.createPanelActions()

shell.enterVRButton.addEventListener('click', () => void controller?.toggleXR())
shell.recenterButton.addEventListener('click', () => runtime.recenterPanel())
shell.mediaButton.addEventListener('click', () =>
  controller?.onMediaToggleRequest(media.snapshot()),
)

void controller.initialize().then(async () => {
  await controller?.checkXRAvailability()
  if (controller && isVerifiedPackagedPwa()) await controller.toggleXR()
})

window.addEventListener(
  'pagehide',
  () => {
    controller?.shutdown()
    runtime.dispose()
  },
  { once: true },
)

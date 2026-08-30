import { XRInputManager, type XRAssetLoader } from '@iwsdk/xr-input'
import { forwardHtmlEvents } from '@pmndrs/pointer-events'
import { reversePainterSortStable } from '@pmndrs/uikit'
import {
  Color,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three'

import {
  STUDY_PANEL_CENTER_HEIGHT_METERS,
  STUDY_PANEL_DISTANCE_METERS,
  STUDY_PANEL_HEIGHT_METERS,
  STUDY_PANEL_WIDTH_METERS,
  STUDY_UI_COLORS,
  type StudyPanelInteractionMode,
} from '../ui/constants.ts'
import { QUESTIONNAIRE_VISUAL_CONTRACT } from '../ui/questionnaire-contract.ts'
import {
  configureStudyXRRenderQuality,
  type StudyXRRenderQualityOptions,
} from './render-quality.ts'
import {
  advanceStudyPanelAnchorPoll,
  resolveStudyPanelInteractionMode,
  shouldReanchorStudyPanel,
} from './panel-placement.ts'

export type XRHandedInputMode = 'none' | 'controller' | 'hand'

export interface XRInputModeSnapshot {
  left: XRHandedInputMode
  right: XRHandedInputMode
}

export interface StudyXRFrameContext {
  time: number
  deltaSeconds: number
  presenting: boolean
}

export interface StudyXRRuntimeOptions {
  canvas: HTMLCanvasElement
  panelDistance?: number
  maxPixelRatio?: number
  xrFramebufferScaleFactor?: number
  xrFixedFoveation?: number
  /** Enables the native one-sixth direct-touch placement in explicit QA routes only. */
  allowDirectMode?: boolean
  requestHandTracking?: boolean
  onFrame?: (context: StudyXRFrameContext) => void
  onXRStateChange?: (presenting: boolean) => void
  onInputModeChange?: (snapshot: XRInputModeSnapshot) => void
}

export function createStudyXRSessionInit(requestHandTracking = true): XRSessionInit {
  return {
    requiredFeatures: ['local-floor'],
    optionalFeatures: requestHandTracking
      ? ['hand-tracking', 'bounded-floor']
      : ['bounded-floor'],
  }
}

const localOnlyVisualLoader: XRAssetLoader = {
  async loadGLTF(assetPath) {
    throw new Error(`Remote XR input visual blocked: ${assetPath}`)
  },
}

export interface UikitRoot extends Object3D {
  update(deltaMilliseconds: number): void
}

export interface StudyXRRuntime {
  readonly scene: Scene
  readonly camera: PerspectiveCamera
  readonly renderer: WebGLRenderer
  readonly input: XRInputManager
  attachUiRoot(root: UikitRoot, primary?: boolean): void
  detachUiRoot(root: UikitRoot): void
  isImmersiveSupported(): Promise<boolean>
  enterXR(): Promise<void>
  exitXR(): Promise<void>
  recenterPanel(): void
  setPanelInteractionMode(mode: StudyPanelInteractionMode): void
  captureMirrorStream(frameRate?: number): MediaStream
  dispose(): void
}

const scratchHeadPosition = new Vector3()
const scratchHeadQuaternion = new Quaternion()
const scratchForward = new Vector3()
const scratchPanelTarget = new Vector3()

function sourceMode(source: ReturnType<XRInputManager['getPrimaryInputSource']>): XRHandedInputMode {
  if (!source) return 'none'
  return source.hand ? 'hand' : 'controller'
}

function sameInputSnapshot(a: XRInputModeSnapshot, b: XRInputModeSnapshot): boolean {
  return a.left === b.left && a.right === b.right
}

export function createStudyXRRuntime(options: StudyXRRuntimeOptions): StudyXRRuntime {
  const scene = new Scene()
  scene.background = new Color(STUDY_UI_COLORS.world)

  const camera = new PerspectiveCamera(52, 1, 0.04, 40)
  camera.position.set(0, STUDY_PANEL_CENTER_HEIGHT_METERS, 0)

  const renderer = new WebGLRenderer({
    canvas: options.canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  })
  renderer.xr.enabled = true
  configureStudyXRRenderQuality(renderer.xr, {
    framebufferScaleFactor: options.xrFramebufferScaleFactor,
    fixedFoveation: options.xrFixedFoveation,
  } satisfies StudyXRRenderQualityOptions)
  renderer.xr.setReferenceSpaceType('local-floor')
  renderer.localClippingEnabled = true
  renderer.setClearColor(STUDY_UI_COLORS.world, 1)
  renderer.setTransparentSort(reversePainterSortStable)
  renderer.outputColorSpace = 'srgb'

  // xr-input otherwise resolves controller/hand GLBs from jsDelivr. Study 6
  // deliberately keeps all runtime assets on the Pages origin; pointer and
  // pinch tracking remain available when visual models are omitted.
  const input = new XRInputManager({ scene, camera, assetLoader: localOnlyVisualLoader })
  scene.add(input.xrOrigin)

  const desktopPointer = forwardHtmlEvents(options.canvas, camera, scene, {
    batchEvents: true,
    intersectEveryFrame: true,
  })
  const uiRoots = new Set<UikitRoot>()
  let primaryUiRoot: UikitRoot | undefined
  let lastTime: number | undefined
  let recenterOnNextFrame = false
  let inputSnapshot: XRInputModeSnapshot = { left: 'none', right: 'none' }
  let anchorPollElapsedMilliseconds = 0

  let panelDistance = options.panelDistance ?? STUDY_PANEL_DISTANCE_METERS
  let panelVerticalOffset = 0
  const allowDirectMode = options.allowDirectMode === true
  const maxPixelRatio = options.maxPixelRatio ?? 2

  const resize = () => {
    const parent = options.canvas.parentElement
    const width = Math.max(1, parent?.clientWidth ?? window.innerWidth)
    const height = Math.max(1, parent?.clientHeight ?? window.innerHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio))
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    const fitMargin = 1.12
    const verticalHalfExtent = Math.max(
      (STUDY_PANEL_HEIGHT_METERS * fitMargin) / 2,
      (STUDY_PANEL_WIDTH_METERS * fitMargin) / (2 * camera.aspect),
    )
    const fitFov =
      (2 * Math.atan(verticalHalfExtent / panelDistance) * 180) / Math.PI
    camera.fov = Math.min(100, Math.max(52, fitFov))
    camera.updateProjectionMatrix()
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(options.canvas.parentElement ?? options.canvas)
  resize()

  const computePanelTarget = (target: Vector3): Vector3 => {
    const source = renderer.xr.isPresenting ? input.xrOrigin.head : camera
    source.getWorldPosition(scratchHeadPosition)
    source.getWorldQuaternion(scratchHeadQuaternion)
    scratchForward.set(0, 0, -1).applyQuaternion(scratchHeadQuaternion)
    if (scratchForward.lengthSq() < 0.0001) scratchForward.set(0, 0, -1)
    scratchForward.normalize()

    target
      .copy(scratchHeadPosition)
      .addScaledVector(scratchForward, panelDistance)
    target.y += panelVerticalOffset
    return target
  }

  const recenterPanel = () => {
    anchorPollElapsedMilliseconds = 0
    if (!primaryUiRoot) return

    computePanelTarget(scratchPanelTarget)
    primaryUiRoot.position.copy(scratchPanelTarget)
    primaryUiRoot.lookAt(scratchHeadPosition.x, scratchHeadPosition.y, scratchHeadPosition.z)
    primaryUiRoot.updateMatrixWorld(true)
  }

  const isQuestionnaireAnchorActive = (): boolean => {
    if (!primaryUiRoot?.visible) return false
    const panel = primaryUiRoot.getObjectByName('study6-spatial-panel')
    return panel?.visible ?? true
  }

  renderer.xr.addEventListener('sessionstart', () => {
    lastTime = undefined
    anchorPollElapsedMilliseconds = 0
    recenterOnNextFrame = true
    options.onXRStateChange?.(true)
  })
  renderer.xr.addEventListener('sessionend', () => {
    lastTime = undefined
    anchorPollElapsedMilliseconds = 0
    inputSnapshot = { left: 'none', right: 'none' }
    options.onInputModeChange?.(inputSnapshot)
    options.onXRStateChange?.(false)
  })

  renderer.setAnimationLoop((time) => {
    const deltaMilliseconds =
      lastTime === undefined ? 0 : Math.min(100, Math.max(0, time - lastTime))
    lastTime = time

    desktopPointer.update()
    input.update(renderer.xr, deltaMilliseconds / 1000, time)

    const nextInputSnapshot: XRInputModeSnapshot = {
      left: sourceMode(input.getPrimaryInputSource('left')),
      right: sourceMode(input.getPrimaryInputSource('right')),
    }
    if (!sameInputSnapshot(inputSnapshot, nextInputSnapshot)) {
      inputSnapshot = nextInputSnapshot
      options.onInputModeChange?.(inputSnapshot)
    }

    if (recenterOnNextFrame) {
      recenterOnNextFrame = false
      recenterPanel()
    }

    const anchorPoll = advanceStudyPanelAnchorPoll(
      anchorPollElapsedMilliseconds,
      deltaMilliseconds,
      renderer.xr.isPresenting && isQuestionnaireAnchorActive(),
    )
    anchorPollElapsedMilliseconds = anchorPoll.elapsedMilliseconds
    if (anchorPoll.shouldPoll && primaryUiRoot) {
      computePanelTarget(scratchPanelTarget)
      if (
        shouldReanchorStudyPanel(
          primaryUiRoot.position.distanceToSquared(scratchPanelTarget),
        )
      ) {
        recenterPanel()
      }
    }

    uiRoots.forEach((root) => root.update(deltaMilliseconds))
    options.onFrame?.({
      time,
      deltaSeconds: deltaMilliseconds / 1000,
      presenting: renderer.xr.isPresenting,
    })
    renderer.render(scene, camera)
  })

  const isImmersiveSupported = async (): Promise<boolean> => {
    const xr = navigator.xr
    if (!xr || !window.isSecureContext) return false
    try {
      return await xr.isSessionSupported('immersive-vr')
    } catch {
      return false
    }
  }

  const enterXR = async (): Promise<void> => {
    if (renderer.xr.isPresenting) return
    const xr = navigator.xr
    if (!xr || !window.isSecureContext) {
      throw new DOMException('Immersive WebXR is unavailable.', 'NotSupportedError')
    }
    const session = await xr.requestSession(
      'immersive-vr',
      createStudyXRSessionInit(options.requestHandTracking !== false),
    )
    try {
      await renderer.xr.setSession(session)
    } catch (error) {
      await session.end().catch(() => undefined)
      throw error
    }
  }

  const exitXR = async (): Promise<void> => {
    const session = renderer.xr.getSession()
    if (session) await session.end()
  }

  return {
    scene,
    camera,
    renderer,
    input,
    attachUiRoot: (root: UikitRoot, primary = primaryUiRoot === undefined) => {
      uiRoots.add(root)
      scene.add(root)
      if (primary) {
        primaryUiRoot = root
        anchorPollElapsedMilliseconds = 0
        root.position.set(
          0,
          STUDY_PANEL_CENTER_HEIGHT_METERS,
          -panelDistance,
        )
      }
    },
    detachUiRoot: (root: UikitRoot) => {
      uiRoots.delete(root)
      root.removeFromParent()
      if (root === primaryUiRoot) {
        primaryUiRoot = undefined
        anchorPollElapsedMilliseconds = 0
      }
    },
    isImmersiveSupported,
    enterXR,
    exitXR,
    recenterPanel,
    setPanelInteractionMode: (mode) => {
      const effectiveMode = resolveStudyPanelInteractionMode(mode, allowDirectMode)
      if (effectiveMode === 'direct') {
        panelDistance = QUESTIONNAIRE_VISUAL_CONTRACT.panel.directDistanceMeters
        panelVerticalOffset = QUESTIONNAIRE_VISUAL_CONTRACT.panel.directVerticalOffsetMeters
      } else {
        panelDistance = QUESTIONNAIRE_VISUAL_CONTRACT.panel.pointerDistanceMeters
        panelVerticalOffset = 0
      }
      recenterPanel()
    },
    captureMirrorStream: (frameRate = 20) =>
      options.canvas.captureStream(Math.max(1, Math.min(60, frameRate))),
    dispose: () => {
      renderer.setAnimationLoop(null)
      resizeObserver.disconnect()
      desktopPointer.destroy()
      input.multiPointers.left.dispose()
      input.multiPointers.right.dispose()
      uiRoots.clear()
      renderer.dispose()
    },
  }
}

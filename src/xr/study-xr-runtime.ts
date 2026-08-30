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
  onFrame?: (context: StudyXRFrameContext) => void
  onXRStateChange?: (presenting: boolean) => void
  onInputModeChange?: (snapshot: XRInputModeSnapshot) => void
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

  let panelDistance = options.panelDistance ?? STUDY_PANEL_DISTANCE_METERS
  let panelVerticalOffset = 0
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

  const recenterPanel = () => {
    if (!primaryUiRoot) return

    const source = renderer.xr.isPresenting ? input.xrOrigin.head : camera
    source.getWorldPosition(scratchHeadPosition)
    source.getWorldQuaternion(scratchHeadQuaternion)
    scratchForward.set(0, 0, -1).applyQuaternion(scratchHeadQuaternion)
    if (scratchForward.lengthSq() < 0.0001) scratchForward.set(0, 0, -1)
    scratchForward.normalize()

    primaryUiRoot.position
      .copy(scratchHeadPosition)
      .addScaledVector(scratchForward, panelDistance)
    primaryUiRoot.position.y += panelVerticalOffset
    primaryUiRoot.lookAt(scratchHeadPosition.x, scratchHeadPosition.y, scratchHeadPosition.z)
    primaryUiRoot.updateMatrixWorld(true)
  }

  renderer.xr.addEventListener('sessionstart', () => {
    lastTime = undefined
    recenterOnNextFrame = true
    options.onXRStateChange?.(true)
  })
  renderer.xr.addEventListener('sessionend', () => {
    lastTime = undefined
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
    const session = await xr.requestSession('immersive-vr', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hand-tracking', 'bounded-floor'],
    })
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
      if (root === primaryUiRoot) primaryUiRoot = undefined
    },
    isImmersiveSupported,
    enterXR,
    exitXR,
    recenterPanel,
    setPanelInteractionMode: (mode) => {
      if (mode === 'direct') {
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

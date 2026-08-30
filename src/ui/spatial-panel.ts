import { Container, Text } from '@pmndrs/uikit'
import type { Object3D } from 'three'

import {
  STUDY_PANEL_CENTER_HEIGHT_METERS,
  STUDY_PANEL_DISTANCE_METERS,
  STUDY_PANEL_HEIGHT_PX,
  STUDY_PANEL_PIXEL_SIZE_METERS,
  STUDY_PANEL_WIDTH_PX,
  STUDY_UI_COLORS,
  type StudyPanelInteractionMode,
  type StudyStatusTone,
} from './constants.ts'
import {
  QUESTIONNAIRE_VISUAL_CONTRACT,
  questionnaireTitleSize,
} from './questionnaire-contract.ts'
import { disposeSystemTextFieldsIn } from './system-text-field.ts'

export interface SpatialStudyPanelOptions {
  eyebrow?: string
  title?: string
  progress?: string
  footerHint?: string
  footerStatus?: string
  footerStatusTone?: StudyStatusTone
  /** Direct-touch placement is a parity/QA route, never a production default. */
  allowDirectMode?: boolean
  onInteractionModeChange?: (mode: StudyPanelInteractionMode) => void
}

const statusColors: Record<StudyStatusTone, string> = {
  neutral: STUDY_UI_COLORS.textMuted,
  success: STUDY_UI_COLORS.success,
  warning: STUDY_UI_COLORS.warning,
  danger: STUDY_UI_COLORS.danger,
}

function disposeObject(object: Object3D): void {
  const disposable = object as Object3D & { dispose?: () => void }
  disposable.dispose?.()
}

/**
 * Reusable physical panel shared by the browser camera and immersive WebXR.
 * Its inherited uikit pixel size fixes 1080 x 720 logical pixels to
 * 1.35 x 0.90 metres without an additional Object3D scale.
 */
export class SpatialStudyPanel {
  readonly root: Container
  readonly header: Container
  readonly body: Container
  readonly footer: Container
  readonly eyebrow: Text
  readonly title: Text
  readonly progress: Text
  readonly kioskStatus: Text
  readonly footerHint: Text
  readonly footerStatus: Text
  private interactionMode: StudyPanelInteractionMode = 'pointer'
  private interactionControlVisible = false
  private demographicsLayout = false
  private readonly allowDirectMode: boolean
  private readonly onInteractionModeChange?: (mode: StudyPanelInteractionMode) => void

  constructor(options: SpatialStudyPanelOptions = {}) {
    const contract = QUESTIONNAIRE_VISUAL_CONTRACT
    this.allowDirectMode = options.allowDirectMode ?? false
    this.onInteractionModeChange = options.onInteractionModeChange
    this.root = new Container({
      width: STUDY_PANEL_WIDTH_PX,
      height: STUDY_PANEL_HEIGHT_PX,
      pixelSize: STUDY_PANEL_PIXEL_SIZE_METERS,
      flexDirection: 'column',
      paddingTop: contract.panel.paddingTop,
      paddingRight: contract.panel.paddingRight,
      paddingBottom: contract.panel.paddingBottom,
      paddingLeft: contract.panel.paddingLeft,
      gapRow: 0,
      overflow: 'hidden',
      backgroundColor: STUDY_UI_COLORS.panel,
      borderColor: STUDY_UI_COLORS.panelBorder,
      borderWidth: contract.panel.borderWidth,
      borderRadius: contract.panel.borderRadius,
    })
    this.root.name = 'study6-spatial-panel'
    this.root.position.set(
      0,
      STUDY_PANEL_CENTER_HEIGHT_METERS,
      -STUDY_PANEL_DISTANCE_METERS,
    )

    this.header = new Container({
      width: '100%',
      height: contract.header.height,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gapColumn: 12,
      paddingBottom: contract.header.paddingBottom,
    })

    const heading = new Container({
      flexGrow: 1,
      flexDirection: 'column',
      justifyContent: 'center',
    })
    this.eyebrow = new Text({
      text: '',
      color: STUDY_UI_COLORS.accent,
      fontSize: 0,
      fontWeight: 'bold',
    })
    const initialTitle = options.title ?? ''
    this.title = new Text({
      text: initialTitle,
      color: STUDY_UI_COLORS.text,
      fontSize: questionnaireTitleSize(initialTitle),
      fontWeight: 'bold',
      lineHeight: '100%',
    })
    heading.add(this.title)

    const headerControls = new Container({
      flexDirection: 'row',
      alignItems: 'center',
      gapColumn: contract.header.compactControlGap,
    })
    this.progress = new Text({
      width: contract.header.compactControlWidth,
      height: contract.header.compactControlHeight,
      text: options.progress ?? '',
      color: STUDY_UI_COLORS.text,
      fontSize: contract.button.textSize,
      fontWeight: 'bold',
      textAlign: 'center',
      lineHeight: '100%',
      backgroundColor: STUDY_UI_COLORS.panelRaised,
      borderColor: STUDY_UI_COLORS.border,
      borderWidth: contract.button.borderWidth,
      borderRadius: contract.button.borderRadius,
      cursor: 'pointer',
      pointerEvents: 'auto',
      onClick: () => {
        if (!this.interactionControlVisible || !this.allowDirectMode) return
        this.setInteractionMode(this.interactionMode === 'pointer' ? 'direct' : 'pointer')
      },
    })
    this.progress.name = 'study6-panel-interaction-mode'
    this.kioskStatus = new Text({
      width: contract.header.kioskControlWidth,
      height: contract.header.compactControlHeight,
      text: 'Kiosk | Off',
      color: STUDY_UI_COLORS.text,
      fontSize: 13,
      fontWeight: 'bold',
      textAlign: 'center',
      lineHeight: '100%',
      backgroundColor: STUDY_UI_COLORS.panelRaised,
      borderColor: STUDY_UI_COLORS.border,
      borderWidth: contract.button.borderWidth,
      borderRadius: contract.button.borderRadius,
      pointerEvents: 'none',
    })
    this.kioskStatus.name = 'study6-panel-kiosk-status'
    headerControls.add(this.progress, this.kioskStatus)
    this.header.add(heading, headerControls)

    this.body = new Container({
      width: '100%',
      flexGrow: 1,
      flexDirection: 'column',
      gapRow: 0,
      paddingTop: contract.body.paddingTop,
      paddingBottom: contract.body.paddingBottom,
      overflow: 'hidden',
    })
    this.body.name = 'study6-spatial-panel-body'

    this.footer = new Container({
      width: '100%',
      height: contract.footer.height,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gapColumn: 0,
      paddingTop: contract.footer.paddingTop,
    })
    this.footerHint = new Text({
      flexGrow: 1,
      text: options.footerHint ?? '',
      color: STUDY_UI_COLORS.textMuted,
      fontSize: contract.footer.messageSize,
      lineHeight: '120%',
    })
    this.footerStatus = new Text({
      width: 310,
      text: options.footerStatus ?? '',
      color: statusColors[options.footerStatusTone ?? 'neutral'],
      fontSize: contract.footer.messageSize,
      fontWeight: 'bold',
      textAlign: 'right',
    })
    this.footer.add(this.footerHint, this.footerStatus)

    this.root.add(this.header, this.body, this.footer)
  }

  setHeader(options: { eyebrow?: string; title?: string; progress?: string }): void {
    if (options.eyebrow !== undefined) {
      this.eyebrow.setProperties({ text: options.eyebrow })
    }
    if (options.title !== undefined) {
      this.title.setProperties({
        text: options.title,
        fontSize: this.demographicsLayout ? 28 : questionnaireTitleSize(options.title),
      })
    }
    if (options.progress !== undefined) {
      if (!this.interactionControlVisible) {
        this.progress.setProperties({ text: options.progress })
      }
    }
  }

  setDemographicsLayout(enabled: boolean): void {
    this.demographicsLayout = enabled
    const contract = QUESTIONNAIRE_VISUAL_CONTRACT
    this.root.setProperties({
      paddingTop: enabled ? 20 : contract.panel.paddingTop,
      paddingBottom: enabled ? 20 : contract.panel.paddingBottom,
    })
    this.header.setProperties({
      height: enabled ? 54 : contract.header.height,
      paddingBottom: enabled ? 6 : contract.header.paddingBottom,
    })
    this.body.setProperties({
      paddingTop: enabled ? 4 : contract.body.paddingTop,
      paddingBottom: enabled ? 0 : contract.body.paddingBottom,
    })
    if (enabled) this.title.setProperties({ fontSize: 28 })
  }

  setInteractionModeControlVisible(visible: boolean): void {
    this.interactionControlVisible = visible
    const switchable = visible && this.allowDirectMode
    this.progress.setProperties({
      display: switchable ? 'flex' : 'none',
      pointerEvents: switchable ? 'auto' : 'none',
      cursor: switchable ? 'pointer' : 'default',
    })
    this.kioskStatus.setProperties({ display: visible ? 'flex' : 'none' })
    if (visible) this.projectInteractionMode()
  }

  setInteractionMode(mode: StudyPanelInteractionMode): boolean {
    if (mode === 'direct' && !this.allowDirectMode) {
      this.projectInteractionMode()
      return false
    }
    if (mode === this.interactionMode) return true
    this.interactionMode = mode
    const pixelSize =
      mode === 'direct'
        ? STUDY_PANEL_PIXEL_SIZE_METERS / 6
        : STUDY_PANEL_PIXEL_SIZE_METERS
    this.root.setProperties({ pixelSize })
    this.projectInteractionMode()
    this.onInteractionModeChange?.(mode)
    return true
  }

  private projectInteractionMode(): void {
    const direct = this.allowDirectMode && this.interactionMode === 'direct'
    this.progress.setProperties({
      text: direct ? 'Direct mode' : 'Pointer mode',
      color: direct ? STUDY_UI_COLORS.accentDark : STUDY_UI_COLORS.text,
      backgroundColor: direct ? STUDY_UI_COLORS.accentSoft : STUDY_UI_COLORS.panelRaised,
      borderColor: direct ? STUDY_UI_COLORS.accent : STUDY_UI_COLORS.border,
      borderWidth: direct
        ? QUESTIONNAIRE_VISUAL_CONTRACT.button.selectedBorderWidth
        : QUESTIONNAIRE_VISUAL_CONTRACT.button.borderWidth,
    })
  }

  /**
   * Enables scrolling only for pages whose measured content requires it.
   * Resetting on page transitions prevents a prior long page from translating
   * the next page, while same-page state updates retain the participant's
   * reading position.
   */
  setBodyScrollable(scrollable: boolean, reset = false): void {
    this.body.setProperties({ overflow: scrollable ? 'scroll' : 'hidden' })
    if (scrollable && !reset) return
    this.body.scrollPosition.value = [0, 0]
    this.body.scrollVelocity.set(0, 0)
  }

  setFooter(options: {
    hint?: string
    status?: string
    tone?: StudyStatusTone
  }): void {
    this.footer.setProperties({
      height: QUESTIONNAIRE_VISUAL_CONTRACT.footer.height,
      paddingTop: QUESTIONNAIRE_VISUAL_CONTRACT.footer.paddingTop,
    })
    const defaultChildren = [this.footerHint, this.footerStatus]
    if (!defaultChildren.every((child) => child.parent === this.footer)) {
      const previousChildren = [...this.footer.children]
      this.footer.remove(...previousChildren)
      previousChildren
        .filter((child) => !defaultChildren.includes(child as Text))
        .forEach(disposeObject)
      this.footer.add(...defaultChildren)
    }
    if (options.hint !== undefined) {
      this.footerHint.setProperties({ text: options.hint })
    }
    if (options.status !== undefined) {
      this.footerStatus.setProperties({ text: options.status })
    }
    if (options.tone !== undefined) {
      this.footerStatus.setProperties({ color: statusColors[options.tone] })
    }
  }

  replaceBody(...children: Object3D[]): void {
    const previousChildren = [...this.body.children]
    previousChildren.forEach(disposeSystemTextFieldsIn)
    this.body.remove(...previousChildren)
    previousChildren.forEach(disposeObject)
    this.body.add(...children)
  }

  replaceFooter(...children: Object3D[]): void {
    this.footer.setProperties({
      height: QUESTIONNAIRE_VISUAL_CONTRACT.footer.height,
      paddingTop: QUESTIONNAIRE_VISUAL_CONTRACT.footer.paddingTop,
    })
    const previousChildren = [...this.footer.children]
    this.footer.remove(...previousChildren)
    previousChildren
      .filter((child) => child !== this.footerHint && child !== this.footerStatus)
      .forEach(disposeObject)
    this.footer.add(...children)
  }

  hideFooter(): void {
    const previousChildren = [...this.footer.children]
    this.footer.remove(...previousChildren)
    previousChildren
      .filter((child) => child !== this.footerHint && child !== this.footerStatus)
      .forEach(disposeObject)
    this.footer.setProperties({ height: 0, paddingTop: 0 })
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible
  }

  update(deltaMilliseconds: number): void {
    this.root.update(deltaMilliseconds)
  }

  dispose(): void {
    this.root.removeFromParent()
    this.root.dispose()
  }
}

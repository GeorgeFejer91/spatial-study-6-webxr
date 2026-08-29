import { Container, Text } from '@pmndrs/uikit'
import type { Object3D } from 'three'

import {
  STUDY_PANEL_CENTER_HEIGHT_METERS,
  STUDY_PANEL_DISTANCE_METERS,
  STUDY_PANEL_HEIGHT_PX,
  STUDY_PANEL_PIXEL_SIZE_METERS,
  STUDY_PANEL_WIDTH_PX,
  STUDY_UI_COLORS,
  type StudyStatusTone,
} from './constants.ts'
import { disposeSystemTextFieldsIn } from './system-text-field.ts'

export interface SpatialStudyPanelOptions {
  eyebrow?: string
  title?: string
  progress?: string
  footerHint?: string
  footerStatus?: string
  footerStatusTone?: StudyStatusTone
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
  readonly footerHint: Text
  readonly footerStatus: Text

  constructor(options: SpatialStudyPanelOptions = {}) {
    this.root = new Container({
      width: STUDY_PANEL_WIDTH_PX,
      height: STUDY_PANEL_HEIGHT_PX,
      pixelSize: STUDY_PANEL_PIXEL_SIZE_METERS,
      flexDirection: 'column',
      paddingTop: 48,
      paddingRight: 56,
      paddingBottom: 42,
      paddingLeft: 56,
      gapRow: 24,
      overflow: 'hidden',
      backgroundColor: STUDY_UI_COLORS.panel,
      borderColor: STUDY_UI_COLORS.border,
      borderWidth: 2,
      borderRadius: 28,
    })
    this.root.name = 'study6-spatial-panel'
    this.root.position.set(
      0,
      STUDY_PANEL_CENTER_HEIGHT_METERS,
      -STUDY_PANEL_DISTANCE_METERS,
    )

    this.header = new Container({
      width: '100%',
      height: 98,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gapColumn: 32,
      borderBottomWidth: 2,
      borderColor: STUDY_UI_COLORS.border,
      paddingBottom: 22,
    })

    const heading = new Container({
      flexGrow: 1,
      flexDirection: 'column',
      gapRow: 7,
    })
    this.eyebrow = new Text({
      text: options.eyebrow ?? 'SPATIAL STUDY 6 | WEBXR',
      color: STUDY_UI_COLORS.accent,
      fontSize: 17,
      fontWeight: 'bold',
      letterSpacing: 1.5,
    })
    this.title = new Text({
      text: options.title ?? '',
      color: STUDY_UI_COLORS.text,
      fontSize: 38,
      fontWeight: 'bold',
      lineHeight: '110%',
    })
    heading.add(this.eyebrow, this.title)

    this.progress = new Text({
      width: 220,
      text: options.progress ?? '',
      color: STUDY_UI_COLORS.textMuted,
      fontSize: 21,
      fontWeight: 'medium',
      textAlign: 'right',
      lineHeight: '120%',
    })
    this.header.add(heading, this.progress)

    this.body = new Container({
      width: '100%',
      flexGrow: 1,
      flexDirection: 'column',
      gapRow: 20,
      overflow: 'hidden',
    })
    this.body.name = 'study6-spatial-panel-body'

    this.footer = new Container({
      width: '100%',
      height: 70,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gapColumn: 24,
      paddingTop: 18,
      borderTopWidth: 2,
      borderColor: STUDY_UI_COLORS.border,
    })
    this.footerHint = new Text({
      flexGrow: 1,
      text: options.footerHint ?? '',
      color: STUDY_UI_COLORS.textMuted,
      fontSize: 19,
      lineHeight: '120%',
    })
    this.footerStatus = new Text({
      width: 310,
      text: options.footerStatus ?? '',
      color: statusColors[options.footerStatusTone ?? 'neutral'],
      fontSize: 19,
      fontWeight: 'semi-bold',
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
      this.title.setProperties({ text: options.title })
    }
    if (options.progress !== undefined) {
      this.progress.setProperties({ text: options.progress })
    }
  }

  setFooter(options: {
    hint?: string
    status?: string
    tone?: StudyStatusTone
  }): void {
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

import { Container, Text } from '@pmndrs/uikit'

import { STUDY_UI_COLORS } from './constants.ts'
import { QUESTIONNAIRE_VISUAL_CONTRACT } from './questionnaire-contract.ts'

export type SpatialButtonVariant = 'primary' | 'secondary' | 'danger'

export interface SpatialButtonOptions {
  label: string
  onActivate: () => void
  variant?: SpatialButtonVariant
  width?: number
  height?: number
  fontSize?: number
  disabled?: boolean
}
export interface SpatialButton {
  readonly root: Container
  readonly label: Text
  setDisabled(disabled: boolean): void
  setLabel(label: string): void
  dispose(): void
}

const buttonPalette = {
  primary: {
    background: STUDY_UI_COLORS.accentSoft,
    hover: STUDY_UI_COLORS.accentHover,
    pressed: STUDY_UI_COLORS.accentPressed,
    text: STUDY_UI_COLORS.accentDark,
    border: STUDY_UI_COLORS.accent,
    borderWidth: QUESTIONNAIRE_VISUAL_CONTRACT.button.selectedBorderWidth,
  },
  secondary: {
    background: STUDY_UI_COLORS.panelRaised,
    hover: '#f1f5f9',
    pressed: '#e2e8f0',
    text: STUDY_UI_COLORS.text,
    border: STUDY_UI_COLORS.border,
    borderWidth: QUESTIONNAIRE_VISUAL_CONTRACT.button.borderWidth,
  },
  danger: {
    background: STUDY_UI_COLORS.warningSoft,
    hover: '#ffefcf',
    pressed: '#ffe5b2',
    text: STUDY_UI_COLORS.warning,
    border: STUDY_UI_COLORS.danger,
    borderWidth: QUESTIONNAIRE_VISUAL_CONTRACT.button.borderWidth,
  },
} as const

export function createSpatialButton(options: SpatialButtonOptions): SpatialButton {
  const variant = options.variant ?? 'primary'
  const palette = buttonPalette[variant]
  let disabled = options.disabled ?? false

  const root = new Container({
    width: options.width ?? 240,
    height: options.height ?? QUESTIONNAIRE_VISUAL_CONTRACT.button.height,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.background,
    borderColor: palette.border,
    borderWidth: palette.borderWidth,
    borderRadius: QUESTIONNAIRE_VISUAL_CONTRACT.button.borderRadius,
    cursor: 'pointer',
    pointerEvents: 'auto',
    hover: { backgroundColor: palette.hover },
    active: { backgroundColor: palette.pressed },
    onClick: () => {
      if (!disabled) options.onActivate()
    },
  })

  const label = new Text({
    text: options.label,
    color: palette.text,
    fontSize: options.fontSize ?? QUESTIONNAIRE_VISUAL_CONTRACT.button.textSize,
    fontWeight: 'bold',
    textAlign: 'center',
    pointerEvents: 'none',
  })
  root.add(label)

  const setDisabled = (nextDisabled: boolean) => {
    disabled = nextDisabled
    root.setProperties({
      backgroundColor: disabled ? '#f1f5f9' : palette.background,
      borderColor: disabled ? STUDY_UI_COLORS.border : palette.border,
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.72 : 1,
      pointerEvents: disabled ? 'none' : 'auto',
    })
    label.setProperties({ color: disabled ? STUDY_UI_COLORS.textDisabled : palette.text })
  }

  setDisabled(disabled)

  return {
    root,
    label,
    setDisabled,
    setLabel: (nextLabel: string) => label.setProperties({ text: nextLabel }),
    dispose: () => root.dispose(),
  }
}

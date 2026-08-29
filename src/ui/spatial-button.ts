import { Container, Text } from '@pmndrs/uikit'

import { STUDY_UI_COLORS } from './constants.ts'

export type SpatialButtonVariant = 'primary' | 'secondary' | 'danger'

export interface SpatialButtonOptions {
  label: string
  onActivate: () => void
  variant?: SpatialButtonVariant
  width?: number
  height?: number
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
    background: STUDY_UI_COLORS.accent,
    hover: STUDY_UI_COLORS.accentHover,
    pressed: STUDY_UI_COLORS.accentPressed,
    text: '#ffffff',
    border: STUDY_UI_COLORS.accent,
  },
  secondary: {
    background: STUDY_UI_COLORS.panelRaised,
    hover: '#e9eef5',
    pressed: '#dce5f0',
    text: STUDY_UI_COLORS.text,
    border: '#9ca7b5',
  },
  danger: {
    background: STUDY_UI_COLORS.danger,
    hover: '#81232a',
    pressed: '#671b21',
    text: '#ffffff',
    border: STUDY_UI_COLORS.danger,
  },
} as const

export function createSpatialButton(options: SpatialButtonOptions): SpatialButton {
  const variant = options.variant ?? 'primary'
  const palette = buttonPalette[variant]
  let disabled = options.disabled ?? false

  const root = new Container({
    width: options.width ?? 240,
    height: options.height ?? 64,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.background,
    borderColor: palette.border,
    borderWidth: 2,
    borderRadius: 14,
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
    fontSize: 25,
    fontWeight: 'semi-bold',
    textAlign: 'center',
    pointerEvents: 'none',
  })
  root.add(label)

  const setDisabled = (nextDisabled: boolean) => {
    disabled = nextDisabled
    root.setProperties({
      backgroundColor: disabled ? '#d6d8dc' : palette.background,
      borderColor: disabled ? '#c2c5ca' : palette.border,
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.72 : 1,
      pointerEvents: disabled ? 'none' : 'auto',
    })
    label.setProperties({ color: disabled ? '#777d86' : palette.text })
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

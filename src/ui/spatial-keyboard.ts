import { Container, Text } from '@pmndrs/uikit'

import { STUDY_UI_COLORS } from './constants.ts'
import { createSpatialButton, type SpatialButton } from './spatial-button.ts'

export type SpatialKeyboardMode = 'name' | 'token' | 'number'

export interface SpatialTextFieldOptions {
  value?: string
  placeholder?: string
  width?: number
  onActivate: () => void
}

export interface SpatialTextField {
  readonly root: Container
  readonly text: Text
  setValue(value: string): void
  setDisabled(disabled: boolean): void
  dispose(): void
}

export interface SpatialKeyboardOptions {
  title: string
  initialValue?: string
  maxLength: number
  mode: SpatialKeyboardMode
  doneLabel: string
  cancelLabel: string
  clearLabel: string
  backspaceLabel: string
  spaceLabel: string
  shiftLabel: string
  onChange: (value: string) => void
  onCommit: (value: string) => void
  onCancel: () => void
}

export interface SpatialKeyboard {
  readonly root: Container
  getValue(): string
  dispose(): void
}

export function createSpatialTextField(options: SpatialTextFieldOptions): SpatialTextField {
  let disabled = false
  let value = options.value ?? ''
  const root = new Container({
    width: options.width ?? '100%',
    height: 44,
    paddingLeft: 12,
    paddingRight: 12,
    alignItems: 'center',
    backgroundColor: STUDY_UI_COLORS.panelRaised,
    borderColor: STUDY_UI_COLORS.border,
    borderWidth: 1,
    borderRadius: 6,
    cursor: 'pointer',
    pointerEvents: 'auto',
    hover: { borderColor: STUDY_UI_COLORS.focus, borderWidth: 2 },
    onClick: () => {
      if (!disabled) options.onActivate()
    },
  })
  const text = new Text({
    width: '100%',
    text: value || options.placeholder || '',
    color: value ? STUDY_UI_COLORS.text : STUDY_UI_COLORS.textMuted,
    fontSize: 18,
    pointerEvents: 'none',
  })
  root.add(text)

  const project = () => {
    root.setProperties({
      pointerEvents: disabled ? 'none' : 'auto',
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.55 : 1,
    })
    text.setProperties({
      text: value || options.placeholder || '',
      color: value ? STUDY_UI_COLORS.text : STUDY_UI_COLORS.textMuted,
    })
  }
  project()

  return {
    root,
    text,
    setValue: (nextValue: string) => {
      value = nextValue
      project()
    },
    setDisabled: (nextDisabled: boolean) => {
      disabled = nextDisabled
      project()
    },
    dispose: () => root.dispose(),
  }
}

function sanitizeKeyboardValue(value: string, mode: SpatialKeyboardMode): string {
  if (mode === 'number') return value.replace(/\D/g, '')
  if (mode === 'token') return value.toUpperCase().replace(/[^A-Z0-9_-]/g, '')
  return value.replace(/[\r\n\t]/g, ' ')
}

/**
 * WebXR-owned keyboard that never asks Meta Browser to create its immersive
 * Android overlay keyboard. Meta Browser 149 currently crashes in
 * VrShellDelegate.showOverlayKeyboard on the target Quest build.
 */
export function createSpatialKeyboard(options: SpatialKeyboardOptions): SpatialKeyboard {
  let value = sanitizeKeyboardValue(options.initialValue ?? '', options.mode).slice(
    0,
    options.maxLength,
  )
  let uppercase = options.mode !== 'name'
  const buttons: SpatialButton[] = []

  const root = new Container({
    width: '100%',
    height: '100%',
    flexDirection: 'column',
    alignItems: 'center',
    gapRow: 8,
    paddingTop: 18,
    paddingRight: 24,
    paddingBottom: 18,
    paddingLeft: 24,
    backgroundColor: STUDY_UI_COLORS.panel,
    borderColor: STUDY_UI_COLORS.accent,
    borderWidth: 2,
    borderRadius: 12,
    pointerEvents: 'auto',
  })
  root.name = 'study6-spatial-keyboard'

  const title = new Text({
    width: '100%',
    height: 34,
    text: options.title,
    color: STUDY_UI_COLORS.text,
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
  })
  const valueText = new Text({
    width: '100%',
    height: 54,
    paddingLeft: 18,
    paddingRight: 18,
    text: value,
    color: STUDY_UI_COLORS.text,
    fontSize: 25,
    backgroundColor: STUDY_UI_COLORS.panelRaised,
    borderColor: STUDY_UI_COLORS.focus,
    borderWidth: 2,
    borderRadius: 8,
    verticalAlign: 'middle',
  })

  const project = (notify: boolean) => {
    valueText.setProperties({ text: value || ' ' })
    if (notify) options.onChange(value)
  }
  const append = (raw: string) => {
    if (value.length >= options.maxLength) return
    const character = options.mode === 'name' && !uppercase ? raw.toLowerCase() : raw
    value = sanitizeKeyboardValue(`${value}${character}`, options.mode).slice(0, options.maxLength)
    project(true)
  }
  const addButton = (
    row: Container,
    label: string,
    onActivate: () => void,
    width: number,
    variant: 'primary' | 'secondary' = 'secondary',
  ) => {
    const button = createSpatialButton({
      label,
      onActivate,
      variant,
      width,
      height: 48,
      fontSize: 17,
    })
    buttons.push(button)
    row.add(button.root)
    return button
  }
  const makeRow = () =>
    new Container({
      width: '100%',
      height: 48,
      flexDirection: 'row',
      justifyContent: 'center',
      gapColumn: 6,
    })

  root.add(title, valueText)

  if (options.mode !== 'number') {
    const digitRow = makeRow()
    for (const character of '1234567890') addButton(digitRow, character, () => append(character), 88)
    root.add(digitRow)

    const letterRows = [
      ['Q', 'W', 'E', 'R', 'T', 'Z', 'U', 'I', 'O', 'P', 'Ü'],
      ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ö', 'Ä'],
      ['Y', 'X', 'C', 'V', 'B', 'N', 'M', '-', "'"],
    ]
    for (const characters of letterRows) {
      const row = makeRow()
      const width = characters.length === 11 ? 78 : 94
      for (const character of characters) addButton(row, character, () => append(character), width)
      root.add(row)
    }
  } else {
    for (const characters of [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']]) {
      const row = makeRow()
      for (const character of characters) addButton(row, character, () => append(character), 180)
      root.add(row)
    }
    const zeroRow = makeRow()
    addButton(zeroRow, '0', () => append('0'), 180)
    root.add(zeroRow)
  }

  const editRow = makeRow()
  if (options.mode === 'name') {
    const shift = addButton(
      editRow,
      options.shiftLabel,
      () => {
        uppercase = !uppercase
        shift.setLabel(`${options.shiftLabel}: ${uppercase ? 'ABC' : 'abc'}`)
      },
      150,
    )
    shift.setLabel(`${options.shiftLabel}: ${uppercase ? 'ABC' : 'abc'}`)
    addButton(editRow, options.spaceLabel, () => append(' '), 250)
  }
  addButton(editRow, options.backspaceLabel, () => {
    value = value.slice(0, -1)
    project(true)
  }, 190)
  addButton(editRow, options.clearLabel, () => {
    value = ''
    project(true)
  }, 150)
  root.add(editRow)

  const actionRow = makeRow()
  addButton(actionRow, options.cancelLabel, options.onCancel, 280)
  addButton(actionRow, options.doneLabel, () => options.onCommit(value), 360, 'primary')
  root.add(actionRow)
  project(false)

  return {
    root,
    getValue: () => value,
    dispose: () => {
      buttons.forEach((button) => button.dispose())
      root.dispose()
    },
  }
}

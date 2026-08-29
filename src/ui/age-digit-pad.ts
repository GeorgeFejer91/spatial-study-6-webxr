import { Container, Text } from '@pmndrs/uikit'

import { STUDY_UI_COLORS } from './constants.ts'
import {
  createSpatialButton,
  type SpatialButton,
} from './spatial-button.ts'

export interface AgeDigitPadCopy {
  emptyValue: string
  clear: string
  backspace: string
  confirm: string
  invalid: (minAge: number, maxAge: number) => string
}

export interface AgeDigitPadOptions {
  minAge: number
  maxAge: number
  initialValue?: number
  copy: AgeDigitPadCopy
  onChange: (age: number | undefined) => void
  onConfirm: (age: number) => void
}

export interface AgeDigitPad {
  readonly root: Container
  getValue(): number | undefined
  setValue(age: number | undefined): void
  dispose(): void
}

function parseAge(digits: string): number | undefined {
  if (digits.length === 0) return undefined
  const value = Number.parseInt(digits, 10)
  return Number.isFinite(value) ? value : undefined
}

export function createAgeDigitPad(options: AgeDigitPadOptions): AgeDigitPad {
  const maxDigits = Math.max(1, String(options.maxAge).length)
  let digits = options.initialValue === undefined ? '' : String(options.initialValue)
  const buttons: SpatialButton[] = []

  const root = new Container({
    width: 520,
    flexDirection: 'column',
    alignItems: 'center',
    gapRow: 10,
  })

  const valueText = new Text({
    width: '100%',
    height: 54,
    paddingTop: 8,
    paddingRight: 22,
    paddingBottom: 8,
    paddingLeft: 22,
    text: digits || options.copy.emptyValue,
    textAlign: 'center',
    verticalAlign: 'middle',
    color: digits ? STUDY_UI_COLORS.text : STUDY_UI_COLORS.textMuted,
    backgroundColor: STUDY_UI_COLORS.panelRaised,
    borderColor: '#9ca7b5',
    borderWidth: 2,
    borderRadius: 12,
    fontSize: 28,
    fontWeight: 'bold',
  })

  const validationText = new Text({
    width: '100%',
    height: 22,
    text: '',
    color: STUDY_UI_COLORS.danger,
    fontSize: 16,
    textAlign: 'center',
  })

  const grid = new Container({
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gapRow: 8,
    gapColumn: 8,
  })

  let confirmButton: SpatialButton

  const update = (notify: boolean) => {
    const value = parseAge(digits)
    const valid =
      value !== undefined && value >= options.minAge && value <= options.maxAge
    valueText.setProperties({
      text: digits || options.copy.emptyValue,
      color: digits ? STUDY_UI_COLORS.text : STUDY_UI_COLORS.textMuted,
      borderColor: digits && !valid ? STUDY_UI_COLORS.danger : '#9ca7b5',
    })
    validationText.setProperties({
      text: digits && !valid ? options.copy.invalid(options.minAge, options.maxAge) : '',
    })
    confirmButton.setDisabled(!valid)
    if (notify) options.onChange(valid ? value : undefined)
  }

  const appendDigit = (digit: string) => {
    if (digits.length >= maxDigits) return
    if (digits === '0') digits = digit
    else digits += digit
    update(true)
  }

  const addButton = (label: string, onActivate: () => void) => {
    const button = createSpatialButton({
      label,
      onActivate,
      variant: 'secondary',
      width: 160,
      height: 46,
    })
    buttons.push(button)
    grid.add(button.root)
  }

  for (const digit of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
    addButton(digit, () => appendDigit(digit))
  }
  addButton(options.copy.clear, () => {
    digits = ''
    update(true)
  })
  addButton('0', () => appendDigit('0'))
  addButton(options.copy.backspace, () => {
    digits = digits.slice(0, -1)
    update(true)
  })

  confirmButton = createSpatialButton({
    label: options.copy.confirm,
    onActivate: () => {
      const value = parseAge(digits)
      if (value !== undefined && value >= options.minAge && value <= options.maxAge) {
        options.onConfirm(value)
      }
    },
    width: 520,
    height: 54,
    disabled: true,
  })
  buttons.push(confirmButton)

  root.add(valueText, validationText, grid, confirmButton.root)
  update(false)

  return {
    root,
    getValue: () => {
      const value = parseAge(digits)
      return value !== undefined && value >= options.minAge && value <= options.maxAge
        ? value
        : undefined
    },
    setValue: (age: number | undefined) => {
      digits = age === undefined ? '' : String(age).slice(0, maxDigits)
      update(true)
    },
    dispose: () => root.dispose(),
  }
}

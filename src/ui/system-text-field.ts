import { Input } from '@pmndrs/uikit'
import type { Object3D } from 'three'

import { STUDY_UI_COLORS } from './constants.ts'
import { QUESTIONNAIRE_VISUAL_CONTRACT } from './questionnaire-contract.ts'

export type SystemKeyboardInputMode =
  | 'text'
  | 'email'
  | 'search'
  | 'tel'
  | 'url'

export interface SystemTextFieldOptions {
  ariaLabel: string
  placeholder?: string
  initialValue?: string
  inputMode?: SystemKeyboardInputMode
  autocomplete?: string
  maxLength?: number
  width?: number
  disabled?: boolean
  onValueChange: (value: string) => void
  onCommit?: (value: string) => void
  onFocusChange?: (focused: boolean) => void
}

export interface SystemTextField {
  readonly root: Input
  readonly element: HTMLInputElement | HTMLTextAreaElement
  focus(): void
  blur(): void
  setDisabled(disabled: boolean): void
  setValue(value: string): void
  dispose(): void
}

const systemTextFieldDisposers = new WeakMap<Object3D, () => void>()

/** Dispose keyboard bridges contained by a page before that page is replaced. */
export function disposeSystemTextFieldsIn(root: Object3D): void {
  const disposers: Array<() => void> = []
  root.traverse((object) => {
    const dispose = systemTextFieldDisposers.get(object)
    if (dispose) disposers.push(dispose)
  })
  for (const dispose of disposers) dispose()
}

/**
 * A uikit input backed by its off-screen HTMLInputElement. Focusing must be
 * called directly from a trusted pointer/pinch event so Quest Browser may open
 * the platform keyboard while the immersive session remains active.
 */
export function createSystemTextField(
  options: SystemTextFieldOptions,
): SystemTextField {
  const input = new Input({
    width: options.width ?? '100%',
    height: QUESTIONNAIRE_VISUAL_CONTRACT.textField.height,
    paddingTop: 0,
    paddingRight: QUESTIONNAIRE_VISUAL_CONTRACT.textField.horizontalPadding,
    paddingBottom: 0,
    paddingLeft: QUESTIONNAIRE_VISUAL_CONTRACT.textField.horizontalPadding,
    backgroundColor: STUDY_UI_COLORS.panelRaised,
    borderColor: STUDY_UI_COLORS.border,
    borderWidth: QUESTIONNAIRE_VISUAL_CONTRACT.textField.borderWidth,
    borderRadius: QUESTIONNAIRE_VISUAL_CONTRACT.textField.borderRadius,
    color: STUDY_UI_COLORS.text,
    caretColor: STUDY_UI_COLORS.accent,
    selectionColor: '#bdd8fa',
    fontSize: QUESTIONNAIRE_VISUAL_CONTRACT.textField.textSize,
    placeholder: options.placeholder ?? '',
    defaultValue: options.initialValue ?? '',
    autocomplete: options.autocomplete ?? 'off',
    type: 'text',
    disabled: options.disabled ?? false,
    onValueChange: (value: string) => options.onValueChange(value),
    onFocusChange: (focused: boolean) => options.onFocusChange?.(focused),
    focus: {
      borderColor: STUDY_UI_COLORS.focus,
      borderWidth: 2,
    },
  })

  const element = input.element
  element.inputMode = options.inputMode ?? 'text'
  element.autocapitalize = 'none'
  element.spellcheck = false
  element.setAttribute('aria-label', options.ariaLabel)
  element.setAttribute('enterkeyhint', 'done')
  element.style.fontSize = '16px'
  if (options.maxLength !== undefined) element.maxLength = options.maxLength

  const onKeyDown = (event: Event) => {
    if (!(event instanceof KeyboardEvent) || event.key !== 'Enter') return
    event.preventDefault()
    options.onCommit?.(element.value)
    input.blur()
  }
  element.addEventListener('keydown', onKeyDown)

  // UIKit owns the off-screen DOM input used to summon the platform keyboard,
  // but disposing an ancestor container does not otherwise remove that element.
  // Override the root's lifecycle so page replacement cannot retain participant
  // identifiers or names in detached keyboard bridges.
  const disposeRoot = input.dispose.bind(input)
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    systemTextFieldDisposers.delete(input)
    element.removeEventListener('keydown', onKeyDown)
    element.value = ''
    element.remove()
    disposeRoot()
  }
  input.dispose = dispose
  systemTextFieldDisposers.set(input, dispose)

  // Reinforce uikit's selection handler with an explicit same-gesture focus.
  // This is important for system keyboard admission in Quest Browser.
  input.setProperties({ onPointerDown: () => input.focus() })

  return {
    root: input,
    element,
    focus: () => input.focus(),
    blur: () => input.blur(),
    setDisabled: (disabled: boolean) => input.setProperties({ disabled }),
    setValue: (value: string) => {
      element.value = value
      input.setProperties({ value })
    },
    dispose,
  }
}

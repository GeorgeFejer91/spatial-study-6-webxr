import { afterEach, describe, expect, it } from 'vitest'

import { createBrowserStudyShell } from './browser-shell.ts'
import {
  createSystemTextField,
  disposeSystemTextFieldsIn,
} from './system-text-field.ts'
import { Container } from '@pmndrs/uikit'
import {
  STUDY_PANEL_HEIGHT_METERS,
  STUDY_PANEL_HEIGHT_PX,
  STUDY_PANEL_PIXEL_SIZE_METERS,
  STUDY_PANEL_WIDTH_METERS,
  STUDY_PANEL_WIDTH_PX,
} from './constants.ts'

afterEach(() => document.body.replaceChildren())

describe('physical panel contract', () => {
  it('maps the 1080 x 720 logical panel to exactly 1.35 x 0.90 metres', () => {
    expect(STUDY_PANEL_WIDTH_PX * STUDY_PANEL_PIXEL_SIZE_METERS).toBeCloseTo(
      STUDY_PANEL_WIDTH_METERS,
      12,
    )
    expect(STUDY_PANEL_HEIGHT_PX * STUDY_PANEL_PIXEL_SIZE_METERS).toBeCloseTo(
      STUDY_PANEL_HEIGHT_METERS,
      12,
    )
  })
})

describe('browser study shell', () => {
  it('supports localized labels and reflects immersive presentation state', () => {
    const shell = createBrowserStudyShell(document.body, {
      title: 'Räumliche Studie 6',
      interactiveView: 'Interaktive Ansicht der Räumlichen Studie 6',
      testOnly: 'WEBXR · NUR TEST',
      enterVR: 'VR starten',
      exitVR: 'VR beenden',
      recenter: 'Panel neu zentrieren',
      vrUnavailable: 'VR ist nicht verfügbar.',
      ready: 'Bereit',
      pauseMedia: 'Medium pausieren',
      resumeMedia: 'Medium fortsetzen',
    })

    expect(shell.canvas.getAttribute('aria-label')).toBe(
      'Interaktive Ansicht der Räumlichen Studie 6',
    )
    expect(shell.enterVRButton.disabled).toBe(true)
    expect(shell.mediaButton.hidden).toBe(true)

    shell.setMediaControl({ visible: true, paused: true })
    expect(shell.mediaButton.hidden).toBe(false)
    expect(shell.mediaButton.textContent).toBe('Medium fortsetzen')

    shell.setStatus('demographics · local-only')
    shell.setXRAvailability(false)
    expect(shell.root.querySelector('[role="status"]')?.textContent).toBe(
      'demographics · local-only',
    )

    shell.setXRAvailability(true)
    shell.setXRPresenting(true)

    expect(shell.enterVRButton.textContent).toBe('VR beenden')
    expect(shell.recenterButton.disabled).toBe(false)
    expect(shell.root.dataset.xrPresenting).toBe('true')

    shell.destroy()
    expect(document.body.children).toHaveLength(0)
  })
})

describe('system keyboard bridge', () => {
  it('clears and removes its DOM input when UIKit disposes the root', () => {
    const field = createSystemTextField({
      ariaLabel: 'Private test value',
      initialValue: 'WEBTEST-PRIVATE',
      onValueChange: () => undefined,
    })

    expect(document.body.contains(field.element)).toBe(true)
    field.root.dispose()

    expect(field.element.value).toBe('')
    expect(document.body.contains(field.element)).toBe(false)
  })

  it('clears every bridge when the study panel replaces a page', () => {
    const first = createSystemTextField({
      ariaLabel: 'First private value',
      initialValue: 'FIRST',
      onValueChange: () => undefined,
    })
    const second = createSystemTextField({
      ariaLabel: 'Second private value',
      initialValue: 'SECOND',
      onValueChange: () => undefined,
    })

    const page = new Container()
    page.add(first.root, second.root)
    disposeSystemTextFieldsIn(page)

    expect(first.element.value).toBe('')
    expect(second.element.value).toBe('')
    expect(document.body.contains(first.element)).toBe(false)
    expect(document.body.contains(second.element)).toBe(false)
  })
})

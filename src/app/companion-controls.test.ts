import { afterEach, describe, expect, it, vi } from 'vitest'

import { CompanionControls } from './companion-controls.ts'

afterEach(() => {
  document.body.replaceChildren()
})

describe('companion controls secret-first teardown', () => {
  it('clears the pairing link and QR before host signaling shutdown resolves', async () => {
    const onControlEnabledChange = vi.fn()
    const controls = new CompanionControls({
      slot: document.createElement('div'),
      canvas: document.createElement('canvas'),
      getStatus: vi.fn() as never,
      handleCommand: vi.fn() as never,
      onControlEnabledChange,
    })
    const dialog = Reflect.get(controls, 'dialog') as HTMLDialogElement
    const link = dialog.querySelector<HTMLTextAreaElement>('[data-link]')!
    const qr = dialog.querySelector<HTMLImageElement>('[data-qr]')!
    const pair = dialog.querySelector<HTMLElement>('[data-pair]')!
    link.value = 'https://example.invalid/#pair=secret'
    qr.src = 'data:image/png;base64,c2VjcmV0'
    pair.hidden = false

    let release: () => void = () => {}
    const stop = vi.fn(() => new Promise<void>((resolve) => {
      release = resolve
    }))
    Reflect.set(controls, 'host', { stop })
    let settled = false
    const stopping = controls.stop().then(() => {
      settled = true
    })

    expect(link.value).toBe('')
    expect(qr.hasAttribute('src')).toBe(false)
    expect(pair.hidden).toBe(true)
    expect(onControlEnabledChange).toHaveBeenLastCalledWith(false)
    await Promise.resolve()
    expect(settled).toBe(false)
    release()
    await stopping
    controls.destroy()
  })
})

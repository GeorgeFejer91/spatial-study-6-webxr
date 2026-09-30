import { afterEach, describe, expect, it, vi } from 'vitest'

describe('VDO.Ninja SDK loading boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete window.VDONinjaSDK
    document.querySelectorAll('[data-study6-vdo-sdk]').forEach((element) => element.remove())
    vi.resetModules()
  })

  it('preserves signaling credentials while disabling SDK caches when panel storage is denied', async () => {
    const { createVdoSdk } = await import('./vdo-sdk')
    const options = vi.fn()
    class Sdk extends EventTarget {
      constructor(value?: Record<string, unknown>) { super(); options(value) }
      _getStorage = () => { throw new Error('Storage denied') }
      _setStorage = () => { throw new Error('Storage denied') }
      async connect() {}
      async joinRoom() {}
      async announce() { return '' }
      async publish() { return '' }
      async view() { return null }
      sendData() { return true }
      async disconnect() {}
    }
    vi.stubGlobal('localStorage', undefined)
    const sdk = createVdoSdk(Sdk, true, 'fixture-key')
    expect(options).toHaveBeenCalledWith({ password: 's6-vdo-v1-fixture-key', salt: 'spatial-study-6-webxr-v1', forceTURN: true, autoPingViewer: true })
    expect(sdk._getStorage?.()).toBeNull()
    expect(() => sdk._setStorage?.()).not.toThrow()
  })

  it('does not create a signaling client or SDK script merely by importing the adapter', async () => {
    await import('./vdo-sdk')
    expect(window.VDONinjaSDK).toBeUndefined()
    expect(document.querySelector('[data-study6-vdo-sdk]')).toBeNull()
  })

  it('pins the explicitly requested local script with subresource integrity', async () => {
    const { loadVdoNinjaSdk } = await import('./vdo-sdk')
    const pending = loadVdoNinjaSdk()
    const script = document.querySelector<HTMLScriptElement>('[data-study6-vdo-sdk]')
    expect(script).not.toBeNull()
    expect(script?.src).toContain('/vendor/vdoninja/1.5.5/vdoninja-sdk.js')
    expect(script?.integrity).toBe('sha256-gJfVQg1+0kJmI9f/CPar1F8D+J5lQKbMS4a83AV9hB4=')
    script?.dispatchEvent(new Event('error'))
    await expect(pending).rejects.toThrow('failed to load')
  })
})

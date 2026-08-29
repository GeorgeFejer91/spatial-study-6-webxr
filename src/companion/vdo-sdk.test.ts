import { afterEach, describe, expect, it, vi } from 'vitest'

describe('VDO.Ninja SDK loading boundary', () => {
  afterEach(() => {
    delete window.VDONinjaSDK
    document.querySelectorAll('[data-study6-vdo-sdk]').forEach((element) => element.remove())
    vi.resetModules()
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

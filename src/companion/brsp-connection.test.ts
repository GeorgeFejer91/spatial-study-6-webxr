import { describe, expect, it } from 'vitest'

import { BrspCommandFingerprintWindow } from './brsp-connection.ts'

describe('Study 6 BRSP command replay hardening', () => {
  it('allows byte-equivalent retries and rejects a conflicting command ID', () => {
    const window = new BrspCommandFingerprintWindow()
    const first = {
      commandId: 'cmd_12345678',
      scope: 'study.media.control',
      action: 'pause_media',
      args: {},
      expectedRevision: 7,
    }
    expect(window.observe(first.commandId, first)).toBe('new')
    expect(window.observe(first.commandId, { ...first })).toBe('duplicate')
    expect(window.observe(first.commandId, { ...first, action: 'resume_media' })).toBe('conflict')
  })

  it('bounds retained command fingerprints', () => {
    const window = new BrspCommandFingerprintWindow(1)
    expect(window.observe('cmd_12345678', { value: 1 })).toBe('new')
    expect(window.observe('cmd_87654321', { value: 2 })).toBe('new')
    expect(window.observe('cmd_12345678', { value: 3 })).toBe('new')
  })
})

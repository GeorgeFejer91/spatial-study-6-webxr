import { describe, expect, it } from 'vitest'

import {
  createPairingDescriptor,
  decodePairingDescriptor,
  decryptCompanionMessage,
  encodePairingDescriptor,
  encryptCompanionMessage,
  nowIso,
  ReplayWindow,
  remoteCommandNames,
  SequenceReplayGuard,
} from './protocol'

describe('companion pairing protocol', () => {
  it('round-trips a fragment-safe pairing descriptor', () => {
    const descriptor = createPairingDescriptor(true)
    expect(decodePairingDescriptor(`#pair=${encodePairingDescriptor(descriptor)}`)).toEqual(descriptor)
  })

  it('authenticates and encrypts bounded messages', async () => {
    const descriptor = createPairingDescriptor()
    const message = {
      protocol: 'spatial-study-6-companion/v1' as const,
      kind: 'command' as const,
      sequence: 1,
      sentAt: nowIso(),
      commandId: crypto.randomUUID(),
      name: 'pause_media' as const,
      expectedRevision: 19,
    }
    const encrypted = await encryptCompanionMessage(descriptor.key, message)
    expect(JSON.stringify(encrypted)).not.toContain('pause_media')
    await expect(decryptCompanionMessage(descriptor.key, encrypted)).resolves.toEqual(message)

    const tampered = { ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -1)}A` }
    await expect(decryptCompanionMessage(descriptor.key, tampered)).rejects.toBeDefined()
  })

  it('rejects replayed nonces', async () => {
    const descriptor = createPairingDescriptor()
    const encrypted = await encryptCompanionMessage(descriptor.key, {
      protocol: 'spatial-study-6-companion/v1',
      kind: 'hello',
      role: 'experiment',
      sequence: 0,
      sentAt: nowIso(),
    })
    const replay = new ReplayWindow()
    expect(replay.accept(encrypted)).toBe(true)
    expect(replay.accept(encrypted)).toBe(false)
  })

  it('uses the same bounded command names as the study reducer seam', () => {
    expect(remoteCommandNames).toEqual([
      'request_status',
      'recenter_panel',
      'start_block',
      'pause_media',
      'resume_media',
      'advance',
      'back',
    ])
  })

  it('rejects an old application sequence even after unrelated messages', () => {
    const guard = new SequenceReplayGuard()
    const hello = {
      protocol: 'spatial-study-6-companion/v1' as const,
      kind: 'hello' as const,
      role: 'experiment' as const,
      sequence: 41,
      sentAt: nowIso(),
    }
    expect(guard.accept(hello)).toBe(true)
    expect(guard.accept({ ...hello, sequence: 42 })).toBe(true)
    expect(guard.accept(hello)).toBe(false)
  })
})

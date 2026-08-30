import { describe, expect, it } from 'vitest'

import { createPairingDescriptor } from './protocol.ts'
import {
  forgetTrustedPairing,
  loadTrustedPairing,
  saveTrustedPairing,
  TRUSTED_OPERATOR_STORAGE_KEY,
  type TrustedPairingStorage,
} from './trusted-pairing.ts'

class MemoryStorage implements TrustedPairingStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

describe('trusted operator pairing persistence', () => {
  it('round-trips the exact private descriptor without weakening its schema', () => {
    const storage = new MemoryStorage()
    const descriptor = createPairingDescriptor(true)

    expect(saveTrustedPairing(descriptor, storage)).toBe(true)
    expect(loadTrustedPairing(storage)).toEqual(descriptor)
  })

  it('revokes invalid stored credentials instead of attempting a connection', () => {
    const storage = new MemoryStorage()
    storage.setItem(TRUSTED_OPERATOR_STORAGE_KEY, 'not-a-valid-descriptor')

    expect(loadTrustedPairing(storage)).toBeNull()
    expect(storage.getItem(TRUSTED_OPERATOR_STORAGE_KEY)).toBeNull()
  })

  it('forgets a trusted controller credential explicitly', () => {
    const storage = new MemoryStorage()
    expect(saveTrustedPairing(createPairingDescriptor(), storage)).toBe(true)

    forgetTrustedPairing(storage)
    expect(loadTrustedPairing(storage)).toBeNull()
  })
})

import {
  decodePairingDescriptor,
  encodePairingDescriptor,
  PairingDescriptorSchema,
  type PairingDescriptor,
} from './protocol.ts'

export const TRUSTED_OPERATOR_STORAGE_KEY = 'study6.trusted-operator.v2'

export interface TrustedPairingStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function browserStorage(): TrustedPairingStorage | null {
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

/**
 * Load the private trusted-operator credential without ever exposing it in
 * logs or non-fragment URLs. Invalid or obsolete values are revoked locally.
 */
export function loadTrustedPairing(
  storage: TrustedPairingStorage | null = browserStorage(),
): PairingDescriptor | null {
  if (!storage) return null
  try {
    const encoded = storage.getItem(TRUSTED_OPERATOR_STORAGE_KEY)
    if (!encoded) return null
    return PairingDescriptorSchema.parse(decodePairingDescriptor(encoded))
  } catch {
    try {
      storage.removeItem(TRUSTED_OPERATOR_STORAGE_KEY)
    } catch {
      // Storage can be unavailable in private or restricted browser modes.
    }
    return null
  }
}

export function saveTrustedPairing(
  descriptor: PairingDescriptor,
  storage: TrustedPairingStorage | null = browserStorage(),
): boolean {
  if (!storage) return false
  try {
    const safe = PairingDescriptorSchema.parse(descriptor)
    storage.setItem(TRUSTED_OPERATOR_STORAGE_KEY, encodePairingDescriptor(safe))
    return true
  } catch {
    return false
  }
}

export function forgetTrustedPairing(
  storage: TrustedPairingStorage | null = browserStorage(),
): void {
  try {
    storage?.removeItem(TRUSTED_OPERATOR_STORAGE_KEY)
  } catch {
    // Forget remains best-effort when browser storage is unavailable.
  }
}

import type { VdoPeerQuality } from './vdo-sdk.ts'

export type CompanionNetworkRoute = 'direct' | 'relay' | 'unknown'

export interface CompanionNetworkQuality {
  route: CompanionNetworkRoute
  rttMs: number | null
}

/**
 * Reduce raw WebRTC statistics to the only fields the operator needs. This is
 * also the privacy boundary that prevents candidate addresses or SDK-specific
 * statistics from entering application state.
 */
export function sanitizePeerQuality(
  value: VdoPeerQuality,
): CompanionNetworkQuality {
  const route = value.relayed === true
    ? 'relay'
    : value.relayed === false ? 'direct' : 'unknown'
  const rttMs = value.rttMs === null || !Number.isFinite(value.rttMs)
    ? null
    : Math.min(60_000, Math.max(0, Math.round(value.rttMs)))
  return { route, rttMs }
}

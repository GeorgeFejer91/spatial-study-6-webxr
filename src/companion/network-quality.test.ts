import { describe, expect, it } from 'vitest'

import { sanitizePeerQuality } from './network-quality.ts'

describe('privacy-bounded WebRTC quality projection', () => {
  it('distinguishes observed direct, relay, and unknown routes', () => {
    expect(sanitizePeerQuality({ relayed: false, rttMs: 17.6 })).toEqual({
      route: 'direct',
      rttMs: 18,
    })
    expect(sanitizePeerQuality({ relayed: true, rttMs: 41.2 })).toEqual({
      route: 'relay',
      rttMs: 41,
    })
    expect(sanitizePeerQuality({ relayed: null, rttMs: null })).toEqual({
      route: 'unknown',
      rttMs: null,
    })
  })

  it('bounds invalid or extreme RTT without retaining raw statistics', () => {
    expect(sanitizePeerQuality({ relayed: false, rttMs: Number.NaN }).rttMs).toBeNull()
    expect(sanitizePeerQuality({ relayed: false, rttMs: -4 }).rttMs).toBe(0)
    expect(sanitizePeerQuality({ relayed: false, rttMs: 90_000 }).rttMs).toBe(60_000)
  })
})

import { describe, expect, it } from 'vitest'

import { isVerifiedPackagedPwa } from './immersive-launch.ts'

describe('Horizon immersive PWA launch', () => {
  it('auto-launches only from the verified packaged PWA scope', () => {
    expect(isVerifiedPackagedPwa({})).toBe(false)
    expect(isVerifiedPackagedPwa({ getDigitalGoodsService: () => undefined })).toBe(true)
  })
})

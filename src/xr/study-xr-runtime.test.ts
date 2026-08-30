import { describe, expect, it } from 'vitest'

import { createStudyXRSessionInit } from './study-xr-runtime.ts'

describe('Study XR session capabilities', () => {
  it('keeps hand tracking enabled for production sessions by default', () => {
    expect(createStudyXRSessionInit()).toEqual({
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hand-tracking', 'bounded-floor'],
    })
  })

  it('allows the no-data questionnaire preview to omit hand tracking', () => {
    expect(createStudyXRSessionInit(false)).toEqual({
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['bounded-floor'],
    })
  })
})

import { describe, expect, it, vi } from 'vitest'

import {
  configureStudyXRRenderQuality,
  DEFAULT_STUDY_XR_RENDER_QUALITY,
  resolveStudyXRRenderQuality,
} from './render-quality.ts'

describe('Study XR render quality', () => {
  it('uses the Quest questionnaire quality profile by default', () => {
    expect(resolveStudyXRRenderQuality()).toEqual({
      framebufferScaleFactor: 1.25,
      fixedFoveation: 0.25,
    })
    expect(DEFAULT_STUDY_XR_RENDER_QUALITY).toEqual({
      framebufferScaleFactor: 1.25,
      fixedFoveation: 0.25,
    })
  })

  it('clamps unsafe overrides and falls back from non-finite values', () => {
    expect(
      resolveStudyXRRenderQuality({
        framebufferScaleFactor: 4,
        fixedFoveation: -1,
      }),
    ).toEqual({
      framebufferScaleFactor: 1.5,
      fixedFoveation: 0,
    })
    expect(
      resolveStudyXRRenderQuality({
        framebufferScaleFactor: Number.NaN,
        fixedFoveation: Number.POSITIVE_INFINITY,
      }),
    ).toEqual(DEFAULT_STUDY_XR_RENDER_QUALITY)
  })

  it('applies framebuffer scale before foveation', () => {
    const calls: string[] = []
    const target = {
      setFramebufferScaleFactor: vi.fn((value: number) => calls.push(`scale:${value}`)),
      setFoveation: vi.fn((value: number) => calls.push(`foveation:${value}`)),
    }

    const quality = configureStudyXRRenderQuality(target, {
      framebufferScaleFactor: 1.4,
      fixedFoveation: 0.1,
    })

    expect(quality).toEqual({ framebufferScaleFactor: 1.4, fixedFoveation: 0.1 })
    expect(calls).toEqual(['scale:1.4', 'foveation:0.1'])
  })
})

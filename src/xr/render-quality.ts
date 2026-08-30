/**
 * Conservative Quest render-quality defaults for the questionnaire surface.
 *
 * Three.js otherwise starts WebXR at a 1.0 framebuffer scale with maximum
 * fixed foveation (1.0). The Study 6 panel spans enough of the central view
 * that both defaults make small text visibly softer than the native panel.
 * A 1.25 scale renders about 56% more projection pixels while the reduced
 * foveation preserves more detail toward the panel edges.
 */
export const DEFAULT_STUDY_XR_RENDER_QUALITY = Object.freeze({
  framebufferScaleFactor: 1.25,
  fixedFoveation: 0.25,
})

export const STUDY_XR_RENDER_QUALITY_LIMITS = Object.freeze({
  framebufferScaleFactor: Object.freeze({ minimum: 0.5, maximum: 1.5 }),
  fixedFoveation: Object.freeze({ minimum: 0, maximum: 1 }),
})

export interface StudyXRRenderQualityOptions {
  framebufferScaleFactor?: number
  fixedFoveation?: number
}

export interface StudyXRRenderQuality {
  framebufferScaleFactor: number
  fixedFoveation: number
}

export interface StudyXRRenderQualityTarget {
  setFramebufferScaleFactor(value: number): void
  setFoveation(value: number): void
}

function finiteOrDefault(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

export function resolveStudyXRRenderQuality(
  options: StudyXRRenderQualityOptions = {},
): StudyXRRenderQuality {
  const framebufferScaleFactor = finiteOrDefault(
    options.framebufferScaleFactor,
    DEFAULT_STUDY_XR_RENDER_QUALITY.framebufferScaleFactor,
  )
  const fixedFoveation = finiteOrDefault(
    options.fixedFoveation,
    DEFAULT_STUDY_XR_RENDER_QUALITY.fixedFoveation,
  )

  return {
    framebufferScaleFactor: clamp(
      framebufferScaleFactor,
      STUDY_XR_RENDER_QUALITY_LIMITS.framebufferScaleFactor.minimum,
      STUDY_XR_RENDER_QUALITY_LIMITS.framebufferScaleFactor.maximum,
    ),
    fixedFoveation: clamp(
      fixedFoveation,
      STUDY_XR_RENDER_QUALITY_LIMITS.fixedFoveation.minimum,
      STUDY_XR_RENDER_QUALITY_LIMITS.fixedFoveation.maximum,
    ),
  }
}

/**
 * Apply quality before WebXRManager.setSession(). Three.js cannot change the
 * framebuffer scale while presenting, and carries the stored foveation value
 * into the projection layer it creates for the session.
 */
export function configureStudyXRRenderQuality(
  target: StudyXRRenderQualityTarget,
  options: StudyXRRenderQualityOptions = {},
): StudyXRRenderQuality {
  const quality = resolveStudyXRRenderQuality(options)
  target.setFramebufferScaleFactor(quality.framebufferScaleFactor)
  target.setFoveation(quality.fixedFoveation)
  return quality
}

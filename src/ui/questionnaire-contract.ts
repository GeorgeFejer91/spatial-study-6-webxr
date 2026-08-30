/**
 * Measured questionnaire geometry from the pinned native Android panel.
 * Keep this projection literal so UI tests can detect accidental visual drift.
 */
export const QUESTIONNAIRE_VISUAL_AUTHORITY = {
  sourceRepository: 'MesmerPrism/spatial-study-6',
  sourceRevision: '384935890d8ba29a2851002163352019d65768f6',
  sourceTree: '3bdba70e545b7b9224c0e8469b49d64b405b24b9',
  legacyUpstreamRevision: '994498c9299b3f5d5475047eb32022b629a83473',
  sourceFile:
    'src/spatial-hand-lab-android/app/src/main/java/io/github/mesmerprism/spatialstudy6/handlab/SpatialStudy6QuestionnairePanel.kt',
} as const

export const QUESTIONNAIRE_VISUAL_CONTRACT = {
  panel: {
    width: 1080,
    height: 720,
    paddingTop: 24,
    paddingRight: 28,
    paddingBottom: 22,
    paddingLeft: 28,
    borderWidth: 1,
    borderRadius: 0,
    pointerWidthMeters: 1.35,
    pointerHeightMeters: 0.9,
    pointerDistanceMeters: 1.5,
    directWidthMeters: 0.225,
    directHeightMeters: 0.15,
    directDistanceMeters: 0.5,
    directVerticalOffsetMeters: -0.5,
  },
  header: {
    height: 72,
    paddingBottom: 8,
    compactControlWidth: 164,
    kioskControlWidth: 142,
    compactControlGap: 8,
    compactControlHeight: 52,
    titleDefaultSize: 30,
    titleMediumSize: 26,
    titleLongSize: 24,
    mediumTitleThreshold: 48,
    longTitleThreshold: 62,
  },
  body: {
    paddingTop: 8,
    paddingBottom: 16,
  },
  footer: {
    height: 66,
    paddingTop: 10,
    backWidth: 150,
    nextWidth: 230,
    messageSize: 14,
    messagePadding: 14,
  },
  button: {
    height: 56,
    compactHeight: 52,
    textSize: 15,
    scaleChoiceTextSize: 16,
    borderRadius: 8,
    borderWidth: 1,
    selectedBorderWidth: 2,
  },
  textField: {
    height: 44,
    textSize: 18,
    horizontalPadding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  text: {
    bodySize: 16,
    questionSize: 17,
    endpointSize: 14,
  },
  sam: {
    cardWidth: 72,
    cardHeight: 93,
    rowHeight: 139,
    numberStripHeight: 14,
    cardGap: 12,
    cardRadius: 7,
    optionsWidth: 744,
    sideLabelWidth: 90,
    sideLabelGap: 7,
    groupWidth: 938,
    questionSize: 15,
    sideLabelSize: 16,
    numberSize: 14,
    normalImageWidth: 56.672,
    imageAspectRatio: 1.07,
    dominanceBaseImageWidth: 36.8,
    dominanceScale: [0.825, 0.99, 1.155, 1.32, 1.54, 1.815, 2.145, 2.475, 2.805],
  },
  slider: {
    touchShellHeight: 88,
    visibleHeight: 48,
    trackHeight: 12,
    thumbSize: 30,
    valueBubbleWidth: 86,
    valueBubbleHeight: 26,
    valueBubbleTextSize: 13,
  },
} as const

export function questionnaireTitleSize(title: string): number {
  const header = QUESTIONNAIRE_VISUAL_CONTRACT.header
  if (title.length >= header.longTitleThreshold) return header.titleLongSize
  if (title.length >= header.mediumTitleThreshold) return header.titleMediumSize
  return header.titleDefaultSize
}

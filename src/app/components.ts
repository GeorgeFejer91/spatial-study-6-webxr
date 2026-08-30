import { Container, Image, Text } from '@pmndrs/uikit'

import {
  QUESTIONNAIRE_VISUAL_CONTRACT,
  STUDY_UI_COLORS,
} from '../ui/index.ts'
import { createSpatialButton } from '../ui/spatial-button.ts'

export function paragraph(
  text: string,
  options: {
    size?: number
    color?: string
    width?: number | `${number}%` | `${number}px` | 'auto'
    align?: 'left' | 'center'
  } = {},
): Text {
  return new Text({
    width: options.width ?? '100%',
    text,
    color: options.color ?? STUDY_UI_COLORS.text,
    fontSize: options.size ?? QUESTIONNAIRE_VISUAL_CONTRACT.text.bodySize,
    lineHeight: '120%',
    textAlign: options.align ?? 'left',
  })
}

export function buttonRow(...children: Container[]): Container {
  const row = new Container({
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gapColumn: 12,
    gapRow: 12,
    alignItems: 'center',
    justifyContent: 'center',
  })
  row.add(...children)
  return row
}

export function choiceButton(options: {
  label: string
  selected: boolean
  onActivate: () => void
  width?: number
  height?: number
  fontSize?: number
  disabled?: boolean
  name?: string
}): Container {
  const button = createSpatialButton({
    label: options.label,
    onActivate: options.onActivate,
    variant: options.selected ? 'primary' : 'secondary',
    width: options.width ?? 270,
    height: options.height,
    fontSize: options.fontSize,
    disabled: options.disabled,
  }).root
  if (options.name) button.name = options.name
  return button
}

export interface SpatialScaleOptions {
  question: string
  minimum: number
  maximum: number
  value: number
  touched: boolean
  lowLabel: string
  highLabel: string
  neutralLabel?: string
  width?: number
  signed?: boolean
  showFill?: boolean
  name?: string
  onChange: (value: number) => void
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function sliderValue(value: number, signed: boolean): string {
  if (signed && value > 0) return `+${value}`
  return String(value)
}

interface UIKitGestureEvent {
  uv?: { x: number }
  pointerId?: number
  stopPropagation?: () => void
  stopImmediatePropagation?: () => void
}

type PointerCaptureContainer = Container & {
  setPointerCapture?: (pointerId: number) => void
  releasePointerCapture?: (pointerId: number) => void
}

const SLIDER_HORIZONTAL_INSET = 18

function stopParentGesture(event: UIKitGestureEvent): void {
  // Mirrors Android requestDisallowInterceptTouchEvent(true): a slider or SAM
  // drag must never turn into a parent-panel scroll gesture.
  event.stopImmediatePropagation?.()
  event.stopPropagation?.()
}

function capturePointer(target: Container, pointerId: number | undefined): void {
  if (pointerId === undefined) return
  ;(target as PointerCaptureContainer).setPointerCapture?.(pointerId)
}

function releasePointer(target: Container, pointerId: number | undefined): void {
  if (pointerId === undefined) return
  ;(target as PointerCaptureContainer).releasePointerCapture?.(pointerId)
}

function finiteUvX(event: UIKitGestureEvent): number | undefined {
  const value = event.uv?.x
  return value !== undefined && Number.isFinite(value) ? value : undefined
}

/** UIKit projection of the native WideSeekBarTouchFrame. */
export function spatialScale(options: SpatialScaleOptions): Container {
  const contract = QUESTIONNAIRE_VISUAL_CONTRACT
  const width = options.width ?? 1024
  const span = options.maximum - options.minimum
  const usableWidth = Math.max(1, width - SLIDER_HORIZONTAL_INSET * 2)
  let visualValue = clamp(Math.round(options.value), options.minimum, options.maximum)
  let dragging = false
  let activePointerId: number | undefined

  const percentFor = (value: number) =>
    span === 0 ? 0 : clamp((value - options.minimum) / span, 0, 1)
  const bubbleLeftFor = (value: number) =>
    clamp(
      SLIDER_HORIZONTAL_INSET + percentFor(value) * usableWidth - contract.slider.valueBubbleWidth / 2,
      0,
      width - contract.slider.valueBubbleWidth,
    )
  const thumbLeftFor = (value: number) =>
    clamp(
      SLIDER_HORIZONTAL_INSET + percentFor(value) * usableWidth - contract.slider.thumbSize / 2,
      0,
      width - contract.slider.thumbSize,
    )
  const valueFromEvent = (event: UIKitGestureEvent): number | undefined => {
    const uvX = finiteUvX(event)
    if (uvX === undefined) return undefined
    const logicalX = clamp(uvX * width, SLIDER_HORIZONTAL_INSET, width - SLIDER_HORIZONTAL_INSET)
    const normalized = (logicalX - SLIDER_HORIZONTAL_INSET) / usableWidth
    return Math.round(options.minimum + normalized * span)
  }

  const root = new Container({
    width,
    flexDirection: 'column',
    gapRow: 0,
  })
  root.name = options.name ?? 'study6-slider'

  const question = paragraph(options.question, {
    size: contract.text.questionSize,
    width,
  })
  question.setProperties({
    paddingTop: 14,
    paddingBottom: 4,
    fontWeight: 'bold',
  })

  let fill: Container | undefined
  let thumb: Container
  let bubble: Container
  let bubbleText: Text

  const projectValue = (value: number): void => {
    visualValue = clamp(Math.round(value), options.minimum, options.maximum)
    const percent = percentFor(visualValue)
    fill?.setProperties({ width: percent * usableWidth })
    thumb?.setProperties({ positionLeft: thumbLeftFor(visualValue) })
    bubble?.setProperties({ positionLeft: bubbleLeftFor(visualValue) })
    bubbleText?.setProperties({ text: sliderValue(visualValue, options.signed ?? false) })
  }

  const belongsToActiveGesture = (event: UIKitGestureEvent): boolean =>
    dragging &&
    (activePointerId === undefined || event.pointerId === undefined || event.pointerId === activePointerId)

  const shell: Container = new Container({
    width,
    height: contract.slider.touchShellHeight,
    positionType: 'relative',
    cursor: 'pointer',
    pointerEvents: 'auto',
    overflow: 'visible',
    onPointerDown: (event: UIKitGestureEvent) => {
      stopParentGesture(event)
      if (dragging) return
      dragging = true
      activePointerId = event.pointerId
      capturePointer(shell, activePointerId)
      const value = valueFromEvent(event)
      if (value !== undefined) projectValue(value)
    },
    onPointerMove: (event: UIKitGestureEvent) => {
      if (!dragging) return
      stopParentGesture(event)
      if (!belongsToActiveGesture(event)) return
      const value = valueFromEvent(event)
      if (value !== undefined) projectValue(value)
    },
    onPointerUp: (event: UIKitGestureEvent) => {
      if (!dragging) return
      stopParentGesture(event)
      if (!belongsToActiveGesture(event)) return
      const value = valueFromEvent(event)
      if (value !== undefined) projectValue(value)
      const pointerId = activePointerId
      dragging = false
      activePointerId = undefined
      releasePointer(shell, pointerId)
      // Persist only after capture is finished. Persisting every move causes
      // the controller to rerender and dispose the captured UIKit object.
      options.onChange(visualValue)
    },
    onPointerCancel: (event: UIKitGestureEvent) => {
      if (!dragging) return
      stopParentGesture(event)
      if (!belongsToActiveGesture(event)) return
      const pointerId = activePointerId
      dragging = false
      activePointerId = undefined
      releasePointer(shell, pointerId)
      // Android's WideSeekBarTouchFrame has already applied the last MOVE when
      // it receives ACTION_CANCEL, so retain that same last visible value.
      options.onChange(visualValue)
    },
  })
  shell.name = `${root.name}-touch-shell`

  if (options.signed) {
    const midpoint = new Container({
      width: 3,
      height: 28,
      positionType: 'absolute',
      positionTop: 50,
      positionLeft: width / 2 - 1.5,
      backgroundColor: STUDY_UI_COLORS.textMuted,
      pointerEvents: 'none',
    })
    midpoint.name = `${root.name}-zero-marker`
    shell.add(midpoint)
  }

  const track = new Container({
    width: usableWidth,
    height: contract.slider.trackHeight,
    positionType: 'absolute',
    positionTop: 58,
    positionLeft: SLIDER_HORIZONTAL_INSET,
    backgroundColor: '#e2e8f0',
    borderColor: '#94a3b8',
    borderWidth: 1,
    borderRadius: 6,
    overflow: 'hidden',
    pointerEvents: 'none',
  })
  track.name = `${root.name}-track`
  if (options.showFill) {
    fill = new Container({
      width: percentFor(visualValue) * usableWidth,
      height: '100%',
      backgroundColor: STUDY_UI_COLORS.accent,
      borderRadius: 6,
      pointerEvents: 'none',
    })
    fill.name = `${root.name}-fill`
    track.add(fill)
  }

  thumb = new Container({
    width: contract.slider.thumbSize,
    height: contract.slider.thumbSize,
    positionType: 'absolute',
    positionTop: 49,
    positionLeft: thumbLeftFor(visualValue),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: STUDY_UI_COLORS.accentDark,
    borderRadius: contract.slider.thumbSize / 2,
    pointerEvents: 'none',
  })
  thumb.name = `${root.name}-thumb`
  thumb.add(
    new Container({
      width: 27,
      height: 27,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#ffffff',
      borderRadius: 13.5,
      pointerEvents: 'none',
    }),
  )
  const thumbWhite = thumb.children[0] as Container
  thumbWhite.add(
    new Container({
      width: 18,
      height: 18,
      backgroundColor: STUDY_UI_COLORS.accent,
      borderRadius: 9,
      pointerEvents: 'none',
    }),
  )

  bubble = new Container({
    width: contract.slider.valueBubbleWidth,
    height: contract.slider.valueBubbleHeight,
    positionType: 'absolute',
    positionTop: 2,
    positionLeft: bubbleLeftFor(visualValue),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: STUDY_UI_COLORS.panelRaised,
    borderColor: STUDY_UI_COLORS.border,
    borderWidth: 1,
    borderRadius: 7,
    pointerEvents: 'none',
  })
  bubble.name = `${root.name}-value-bubble`
  bubbleText = new Text({
    text: sliderValue(visualValue, options.signed ?? false),
    color: STUDY_UI_COLORS.text,
    fontSize: contract.slider.valueBubbleTextSize,
    fontWeight: 'bold',
    textAlign: 'center',
    pointerEvents: 'none',
  })
  bubble.add(bubbleText)

  shell.add(track, thumb, bubble)

  const labels = new Container({
    width,
    flexDirection: 'row',
    justifyContent: 'space-between',
  })
  labels.name = `${root.name}-endpoints`
  if (options.signed) {
    labels.add(
      paragraph(`-100\n${options.lowLabel}`, {
        size: contract.text.endpointSize,
        color: STUDY_UI_COLORS.textMuted,
        width: '33%',
      }),
      paragraph(options.neutralLabel ?? '0 (neutral)', {
        size: contract.text.endpointSize,
        color: STUDY_UI_COLORS.textMuted,
        width: '34%',
        align: 'center',
      }),
      new Text({
        width: '33%',
        text: `+100\n${options.highLabel}`,
        color: STUDY_UI_COLORS.textMuted,
        fontSize: contract.text.endpointSize,
        lineHeight: '120%',
        textAlign: 'right',
      }),
    )
  } else {
    labels.add(
      paragraph(options.lowLabel, {
        size: contract.text.endpointSize,
        color: STUDY_UI_COLORS.textMuted,
        width: '50%',
      }),
      new Text({
        width: '50%',
        text: options.highLabel,
        color: STUDY_UI_COLORS.textMuted,
        fontSize: contract.text.endpointSize,
        textAlign: 'right',
      }),
    )
  }

  root.add(question, shell, labels)
  return root
}

export function samRow(options: {
  question: string
  lowLabel: string
  highLabel: string
  dimension: 'valence' | 'arousal' | 'dominance'
  selected: number | null
  onSelect: (value: number) => void
}): Container {
  const contract = QUESTIONNAIRE_VISUAL_CONTRACT.sam
  let visualSelection = options.selected
  let committedSelection = options.selected
  let dragging = false
  let activePointerId: number | undefined
  const cards: Array<{ card: Container; number: Text; score: number }> = []
  const root = new Container({
    width: '100%',
    flexDirection: 'column',
    alignItems: 'center',
    paddingTop: 2,
    paddingBottom: 4,
    overflow: 'visible',
  })
  root.name = `study6-sam-row-${options.dimension}`

  if (options.question) {
    const question = paragraph(options.question, {
      size: contract.questionSize,
      align: 'center',
    })
    question.setProperties({ fontWeight: 'bold', paddingBottom: 3 })
    root.add(question)
  }

  const scale = new Container({
    width: contract.groupWidth,
    height: contract.rowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  })

  const sideLabel = (label: string, name: string) => {
    const text = new Text({
      width: contract.sideLabelWidth,
      height: contract.rowHeight,
      text: label,
      color: STUDY_UI_COLORS.textMuted,
      fontSize: contract.sideLabelSize,
      fontWeight: 'bold',
      textAlign: 'center',
      lineHeight: '110%',
      paddingLeft: 3,
      paddingRight: 3,
    })
    text.name = name
    return text
  }

  const choices = new Container({
    width: contract.optionsWidth,
    height: contract.rowHeight,
    positionType: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    gapColumn: contract.cardGap,
    overflow: 'visible',
  })
  choices.name = `${root.name}-choices`

  for (let score = 1; score <= 9; score += 1) {
    const selected = options.selected === score
    const imageWidth =
      options.dimension === 'dominance'
        ? contract.dominanceBaseImageWidth * contract.dominanceScale[score - 1]
        : contract.normalImageWidth
    const imageHeight = imageWidth * contract.imageAspectRatio
    const imageTop =
      (contract.cardHeight - contract.numberStripHeight) / 2 - imageHeight / 2
    const card = new Container({
      width: contract.cardWidth,
      height: contract.cardHeight,
      positionType: 'relative',
      backgroundColor: selected ? STUDY_UI_COLORS.selected : STUDY_UI_COLORS.panelRaised,
      borderColor: selected ? STUDY_UI_COLORS.selectedBorder : STUDY_UI_COLORS.border,
      borderWidth: selected ? 2 : 1,
      borderRadius: contract.cardRadius,
      overflow: 'visible',
      pointerEvents: 'none',
    })
    card.name = `${root.name}-choice-${score}`
    const source =
      options.dimension === 'dominance'
        ? `${import.meta.env.BASE_URL}assets/sam/valence/valence_05.png`
        : `${import.meta.env.BASE_URL}assets/sam/${options.dimension}/${options.dimension}_${String(score).padStart(2, '0')}.png`
    const image = new Image({
      width: imageWidth,
      height: imageHeight,
      positionType: 'absolute',
      positionTop: imageTop,
      positionLeft: (contract.cardWidth - imageWidth) / 2,
      src: source,
      objectFit: 'fill',
      pointerEvents: 'none',
    })
    // The native SAM contract intentionally lets figures extend beyond cards.
    image.material.clippingPlanes = []
    image.material.needsUpdate = true
    image.name = `${card.name}-image`
    const number = new Text({
      width: '100%',
      height: contract.numberStripHeight,
      positionType: 'absolute',
      positionBottom: 2,
      positionLeft: 0,
      text: String(score),
      color: STUDY_UI_COLORS.textMuted,
      fontSize: contract.numberSize,
      textAlign: 'center',
      pointerEvents: 'none',
    })
    number.name = `${card.name}-number`
    if (selected) {
      number.setProperties({ color: STUDY_UI_COLORS.accentDark, fontWeight: 'bold' })
    }
    card.add(image, number)
    cards.push({ card, number, score })
    choices.add(card)
  }

  const projectSelection = (value: number): void => {
    if (value < 1 || value > 9 || value === visualSelection) return
    visualSelection = value
    for (const entry of cards) {
      const selected = entry.score === value
      entry.card.setProperties({
        backgroundColor: selected ? STUDY_UI_COLORS.selected : STUDY_UI_COLORS.panelRaised,
        borderColor: selected ? STUDY_UI_COLORS.selectedBorder : STUDY_UI_COLORS.border,
        borderWidth: selected ? 2 : 1,
      })
      entry.number.setProperties({
        color: selected ? STUDY_UI_COLORS.accentDark : STUDY_UI_COLORS.textMuted,
        fontWeight: selected ? 'bold' : 'normal',
      })
    }
  }

  const valueFromEvent = (event: UIKitGestureEvent): number | undefined => {
    const uvX = finiteUvX(event)
    if (uvX === undefined) return undefined
    const logicalX = clamp(uvX, 0, 1) * contract.optionsWidth
    let nearestScore = 1
    let nearestDistance = Number.POSITIVE_INFINITY
    for (let score = 1; score <= 9; score += 1) {
      const center =
        contract.cardWidth / 2 + (score - 1) * (contract.cardWidth + contract.cardGap)
      const distance = Math.abs(logicalX - center)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestScore = score
      }
    }
    return nearestScore
  }

  const belongsToActiveGesture = (event: UIKitGestureEvent): boolean =>
    dragging &&
    (activePointerId === undefined || event.pointerId === undefined || event.pointerId === activePointerId)

  const commitSelection = (): void => {
    if (visualSelection !== null && visualSelection !== committedSelection) {
      committedSelection = visualSelection
      options.onSelect(visualSelection)
    }
  }

  // One row-wide hit overlay mirrors SamChoiceHitOverlayView. It deliberately
  // spans the full 139 px row rather than the 93 px cards, so overflow figures
  // and the gaps between them resolve to the nearest pictograph.
  const hitOverlay: Container = new Container({
    width: contract.optionsWidth,
    height: contract.rowHeight,
    positionType: 'absolute',
    positionTop: 0,
    positionLeft: 0,
    overflow: 'visible',
    cursor: 'pointer',
    pointerEvents: 'auto',
    onPointerDown: (event: UIKitGestureEvent) => {
      stopParentGesture(event)
      if (dragging) return
      dragging = true
      activePointerId = event.pointerId
      capturePointer(hitOverlay, activePointerId)
      const value = valueFromEvent(event)
      if (value !== undefined) projectSelection(value)
    },
    onPointerMove: (event: UIKitGestureEvent) => {
      if (!dragging) return
      stopParentGesture(event)
      if (!belongsToActiveGesture(event)) return
      const value = valueFromEvent(event)
      if (value !== undefined) projectSelection(value)
    },
    onPointerUp: (event: UIKitGestureEvent) => {
      if (!dragging) return
      stopParentGesture(event)
      if (!belongsToActiveGesture(event)) return
      const value = valueFromEvent(event)
      if (value !== undefined) projectSelection(value)
      const pointerId = activePointerId
      dragging = false
      activePointerId = undefined
      releasePointer(hitOverlay, pointerId)
      commitSelection()
    },
    onPointerCancel: (event: UIKitGestureEvent) => {
      if (!dragging) return
      stopParentGesture(event)
      if (!belongsToActiveGesture(event)) return
      const pointerId = activePointerId
      dragging = false
      activePointerId = undefined
      releasePointer(hitOverlay, pointerId)
      commitSelection()
    },
  })
  hitOverlay.name = `${root.name}-hit-overlay`
  choices.add(hitOverlay)

  const low = sideLabel(options.lowLabel, `${root.name}-low-label`)
  low.setProperties({ marginRight: contract.sideLabelGap })
  const high = sideLabel(options.highLabel, `${root.name}-high-label`)
  high.setProperties({ marginLeft: contract.sideLabelGap })
  scale.add(low, choices, high)
  root.add(scale)
  return root
}

export function scaleChoice(options: {
  question: string
  lowLabel: string
  highLabel: string
  selected: number | null
  name: string
  onSelect: (value: number) => void
}): Container {
  const contract = QUESTIONNAIRE_VISUAL_CONTRACT
  const root = new Container({ width: '100%', flexDirection: 'column' })
  root.name = options.name
  const question = paragraph(options.question, { size: contract.text.questionSize })
  question.setProperties({ paddingTop: 14, paddingBottom: 5, fontWeight: 'bold' })
  const endpoints = new Container({
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
  })
  endpoints.add(
    paragraph(options.lowLabel, {
      size: contract.text.endpointSize,
      color: STUDY_UI_COLORS.textMuted,
      width: '50%',
    }),
    new Text({
      width: '50%',
      text: options.highLabel,
      color: STUDY_UI_COLORS.textMuted,
      fontSize: contract.text.endpointSize,
      textAlign: 'right',
    }),
  )
  const row = new Container({
    width: '100%',
    flexDirection: 'row',
    gapColumn: 6,
    paddingTop: 5,
    paddingBottom: 8,
  })
  row.name = `${root.name}-choices`
  for (let score = 1; score <= 7; score += 1) {
    row.add(
      choiceButton({
        label: String(score),
        selected: options.selected === score,
        width: 140,
        fontSize: contract.button.scaleChoiceTextSize,
        name: `${root.name}-choice-${score}`,
        onActivate: () => options.onSelect(score),
      }),
    )
  }
  root.add(question, endpoints, row)
  return root
}

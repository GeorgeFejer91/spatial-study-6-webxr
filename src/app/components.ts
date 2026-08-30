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

/** UIKit projection of the native WideSeekBarTouchFrame. */
export function spatialScale(options: SpatialScaleOptions): Container {
  const contract = QUESTIONNAIRE_VISUAL_CONTRACT
  const width = options.width ?? 1024
  const span = options.maximum - options.minimum
  const percent = span === 0 ? 0 : clamp((options.value - options.minimum) / span, 0, 1)
  const bubbleLeft = clamp(
    percent * width - contract.slider.valueBubbleWidth / 2,
    0,
    width - contract.slider.valueBubbleWidth,
  )
  const thumbLeft = clamp(
    percent * width - contract.slider.thumbSize / 2,
    0,
    width - contract.slider.thumbSize,
  )

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

  const shell = new Container({
    width,
    height: contract.slider.touchShellHeight,
    positionType: 'relative',
    cursor: 'pointer',
    pointerEvents: 'auto',
    overflow: 'visible',
    onClick: (event) => {
      const normalized = clamp(event.uv?.x ?? 0.5, 0, 1)
      options.onChange(Math.round(options.minimum + normalized * span))
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
    width,
    height: contract.slider.trackHeight,
    positionType: 'absolute',
    positionTop: 58,
    positionLeft: 0,
    backgroundColor: '#e2e8f0',
    borderColor: '#94a3b8',
    borderWidth: 1,
    borderRadius: 6,
    overflow: 'hidden',
    pointerEvents: 'none',
  })
  track.name = `${root.name}-track`
  if (options.showFill) {
    const fill = new Container({
      width: percent * width,
      height: '100%',
      backgroundColor: STUDY_UI_COLORS.accent,
      borderRadius: 6,
      pointerEvents: 'none',
    })
    fill.name = `${root.name}-fill`
    track.add(fill)
  }

  const thumb = new Container({
    width: contract.slider.thumbSize,
    height: contract.slider.thumbSize,
    positionType: 'absolute',
    positionTop: 49,
    positionLeft: thumbLeft,
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

  const bubble = new Container({
    width: contract.slider.valueBubbleWidth,
    height: contract.slider.valueBubbleHeight,
    positionType: 'absolute',
    positionTop: 2,
    positionLeft: bubbleLeft,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: STUDY_UI_COLORS.panelRaised,
    borderColor: STUDY_UI_COLORS.border,
    borderWidth: 1,
    borderRadius: 7,
    pointerEvents: 'none',
  })
  bubble.name = `${root.name}-value-bubble`
  bubble.add(
    new Text({
      text: sliderValue(options.value, options.signed ?? false),
      color: STUDY_UI_COLORS.text,
      fontSize: contract.slider.valueBubbleTextSize,
      fontWeight: 'bold',
      textAlign: 'center',
      pointerEvents: 'none',
    }),
  )

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
      cursor: 'pointer',
      pointerEvents: 'auto',
      onClick: () => options.onSelect(score),
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
    choices.add(card)
  }

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

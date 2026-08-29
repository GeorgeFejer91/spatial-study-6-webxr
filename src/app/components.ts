import { Container, Image, Text } from '@pmndrs/uikit'

import { STUDY_UI_COLORS } from '../ui/constants.ts'
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
    fontSize: options.size ?? 23,
    lineHeight: '135%',
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
  disabled?: boolean
}): Container {
  return createSpatialButton({
    label: `${options.selected ? '[selected] ' : ''}${options.label}`,
    onActivate: options.onActivate,
    variant: options.selected ? 'primary' : 'secondary',
    width: options.width ?? 270,
    height: 58,
    disabled: options.disabled,
  }).root
}

export interface SpatialScaleOptions {
  question: string
  minimum: number
  maximum: number
  value: number
  touched: boolean
  lowLabel: string
  highLabel: string
  width?: number
  compact?: boolean
  onChange: (value: number) => void
}

export function spatialScale(options: SpatialScaleOptions): Container {
  const width = options.width ?? 850
  const span = options.maximum - options.minimum
  const percent = span === 0 ? 0 : (options.value - options.minimum) / span
  const root = new Container({
    width,
    flexDirection: 'column',
    gapRow: options.compact ? 6 : 10,
  })
  const question = paragraph(options.question, { size: options.compact ? 18 : 22, width })
  const value = new Text({
    width,
    text: options.touched ? String(options.value) : '-',
    color: options.touched ? STUDY_UI_COLORS.accent : STUDY_UI_COLORS.textMuted,
    fontSize: options.compact ? 20 : 26,
    fontWeight: 'bold',
    textAlign: 'center',
  })

  const track = new Container({
    width,
    height: options.compact ? 34 : 44,
    backgroundColor: '#d8dde4',
    borderColor: options.touched ? STUDY_UI_COLORS.accent : '#9ca7b5',
    borderWidth: options.touched ? 3 : 2,
    borderRadius: 999,
    overflow: 'hidden',
    cursor: 'pointer',
    pointerEvents: 'auto',
    onClick: (event) => {
      const normalized = Math.max(0, Math.min(1, event.uv?.x ?? 0.5))
      options.onChange(Math.round(options.minimum + normalized * span))
    },
  })
  if (options.touched) {
    const fill = new Container({
      width: `${Math.max(0.8, percent * 100)}%`,
      height: '100%',
      backgroundColor: STUDY_UI_COLORS.accent,
      borderRadius: 999,
      pointerEvents: 'none',
    })
    track.add(fill)
  }

  const labels = new Container({
    width,
    flexDirection: 'row',
    justifyContent: 'space-between',
  })
  labels.add(
    paragraph(options.lowLabel, { size: options.compact ? 15 : 18, color: STUDY_UI_COLORS.textMuted }),
    paragraph(options.highLabel, {
      size: options.compact ? 15 : 18,
      color: STUDY_UI_COLORS.textMuted,
      align: 'center',
    }),
  )

  root.add(question, value, track, labels)
  return root
}

export function samRow(options: {
  label: string
  dimension: 'valence' | 'arousal' | 'dominance'
  selected: number | null
  onSelect: (value: number) => void
}): Container {
  const root = new Container({
    width: '100%',
    height: 100,
    flexDirection: 'column',
    gapRow: 4,
  })
  root.add(paragraph(options.label, { size: 16 }))
  const choices = new Container({
    width: '100%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gapColumn: 6,
  })
  const dominanceFactors = [0.825, 0.99, 1.155, 1.32, 1.54, 1.815, 2.145, 2.475, 2.805]
  for (let score = 1; score <= 9; score += 1) {
    const selected = options.selected === score
    const card = new Container({
      width: 92,
      height: 68,
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gapRow: 2,
      backgroundColor: selected ? '#dce9fa' : STUDY_UI_COLORS.panelRaised,
      borderColor: selected ? STUDY_UI_COLORS.accent : STUDY_UI_COLORS.border,
      borderWidth: selected ? 3 : 1,
      borderRadius: 10,
      cursor: 'pointer',
      onClick: () => options.onSelect(score),
    })
    const source =
      options.dimension === 'dominance'
        ? `${import.meta.env.BASE_URL}assets/sam/valence/valence_05.png`
        : `${import.meta.env.BASE_URL}assets/sam/${options.dimension}/${options.dimension}_${String(score).padStart(2, '0')}.png`
    const imageWidth =
      options.dimension === 'dominance'
        ? Math.max(22, Math.round((dominanceFactors[score - 1] / dominanceFactors[8]) * 50))
        : 42
    const image = new Image({
      width: imageWidth,
      height: Math.round(imageWidth * 1.07),
      src: source,
      objectFit: 'fill',
      pointerEvents: 'none',
    })
    const number = new Text({
      text: String(score),
      color: STUDY_UI_COLORS.textMuted,
      fontSize: 12,
      pointerEvents: 'none',
    })
    card.add(image, number)
    choices.add(card)
  }
  root.add(choices)
  return root
}

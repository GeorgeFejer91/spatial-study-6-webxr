export const STUDY_PANEL_WIDTH_PX = 1080
export const STUDY_PANEL_HEIGHT_PX = 720
export const STUDY_PANEL_WIDTH_METERS = 1.35
export const STUDY_PANEL_HEIGHT_METERS = 0.9
export const STUDY_PANEL_DISTANCE_METERS = 1.5
export const STUDY_PANEL_CENTER_HEIGHT_METERS = 1.55
export const STUDY_PANEL_PIXEL_SIZE_METERS =
  STUDY_PANEL_WIDTH_METERS / STUDY_PANEL_WIDTH_PX

export const STUDY_UI_COLORS = {
  world: '#080b10',
  worldRaised: '#10151d',
  background: '#d9e0e8',
  panel: '#f8fafc',
  panelRaised: '#ffffff',
  panelBorder: '#b8c3cf',
  text: '#111827',
  textMuted: '#475569',
  textDisabled: '#7c8798',
  border: '#d9e2ec',
  accent: '#005cff',
  accentDark: '#0747b6',
  accentSoft: '#dbeafe',
  accentHover: '#c9defd',
  accentPressed: '#b7d2fb',
  selected: '#fff2b8',
  selectedBorder: '#b77905',
  danger: '#b45309',
  warning: '#b45309',
  warningSoft: '#fff8e8',
  success: '#107044',
  successSoft: '#eaf8ee',
  focus: '#005cff',
} as const

export type StudyStatusTone = 'neutral' | 'success' | 'warning' | 'danger'
export type StudyPanelInteractionMode = 'pointer' | 'direct'

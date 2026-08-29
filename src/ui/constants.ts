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
  panel: '#f7f5ef',
  panelRaised: '#ffffff',
  text: '#151a21',
  textMuted: '#5f6772',
  border: '#d8d4ca',
  accent: '#315f9f',
  accentHover: '#234c84',
  accentPressed: '#193960',
  danger: '#9d2d35',
  warning: '#8a5a10',
  success: '#236842',
  focus: '#68a6f3',
} as const

export type StudyStatusTone = 'neutral' | 'success' | 'warning' | 'danger'

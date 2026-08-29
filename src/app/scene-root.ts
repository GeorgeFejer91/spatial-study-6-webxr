import { Group } from 'three'

import type { StudyMediaPlayer } from '../media/player.ts'
import type { SpatialStudyPanel } from '../ui/spatial-panel.ts'

export class StudySceneRoot extends Group {
  private readonly panel: SpatialStudyPanel
  private readonly media: StudyMediaPlayer

  constructor(panel: SpatialStudyPanel, media: StudyMediaPlayer) {
    super()
    this.panel = panel
    this.media = media
    panel.root.position.set(0, 0, 0)
    media.root.position.set(0, 0, 0)
    this.add(panel.root, media.root)
  }

  update(deltaMilliseconds: number): void {
    this.panel.update(deltaMilliseconds)
    this.media.root.update(deltaMilliseconds)
  }

  dispose(): void {
    this.panel.dispose()
    this.media.dispose()
    this.removeFromParent()
  }
}

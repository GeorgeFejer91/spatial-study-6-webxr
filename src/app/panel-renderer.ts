import { Container } from '@pmndrs/uikit'

import {
  availableParticipantIds,
  conditionDescriptionKey,
  formatStudyText,
  participantIdViolation,
  studyText,
  timingLabelKey,
  validateDemographics,
  variantSpec,
  type Demographics,
  type ExperimentState,
  type Gender,
  type Handedness,
  type LanguageCode,
  type StudyConfiguration,
  type TimingMode,
  type VariantId,
} from '../study/index.ts'
import {
  createAgeDigitPad,
  createSpatialButton,
  createSystemTextField,
  SpatialStudyPanel,
  STUDY_UI_COLORS,
} from '../ui/index.ts'
import { buttonRow, choiceButton, paragraph, samRow, spatialScale } from './components.ts'

interface SetupDraft {
  languageCode: LanguageCode
  variantId: VariantId | null
  timingMode: TimingMode
}

interface DemographicsDraft {
  firstName: string
  lastName: string
  ageYears: number | undefined
  handedness: Handedness | null
  gender: Gender | null
  consentConfirmed: boolean
}

function freshSetupDraft(): SetupDraft {
  return { languageCode: 'en', variantId: null, timingMode: 'full' }
}

function freshDemographicsDraft(): DemographicsDraft {
  return {
    firstName: '',
    lastName: '',
    ageYears: undefined,
    handedness: null,
    gender: null,
    consentConfirmed: false,
  }
}

export interface StudyPanelActions {
  configure(configuration: StudyConfiguration): void
  startParticipant(participantId: string): void
  submitDemographics(demographics: Demographics): void
  startBlock(): void
  setSam(dimension: 'valence' | 'arousal' | 'dominance', value: number): void
  setAffect(dimension: 'valence' | 'arousal', value: number): void
  setEmotion(
    emotion: 'anger' | 'disgust' | 'fear' | 'happiness' | 'sadness' | 'surprise',
    value: number,
  ): void
  setHand(dimension: 'ownership' | 'agency', value: number): void
  advanceAssessment(): void
  backAssessment(): void
  exportJson(): void
  exportCsv(): void
  startNewSession(): void
}

export interface StudyPanelRenderContext {
  usedParticipantIds: readonly string[]
  localMessage: string
  storageHealthy: boolean
}

export class StudyPanelRenderer {
  private readonly panel: SpatialStudyPanel
  private readonly actions: StudyPanelActions
  private setup: SetupDraft = freshSetupDraft()
  private participantDraft = ''
  private demographics: DemographicsDraft = freshDemographicsDraft()
  private agePadOpen = false

  constructor(panel: SpatialStudyPanel, actions: StudyPanelActions) {
    this.panel = panel
    this.actions = actions
  }

  /** Clears all operator and participant text held only in the live UI tree. */
  resetTransientState(): void {
    this.setup = freshSetupDraft()
    this.participantDraft = ''
    this.demographics = freshDemographicsDraft()
    this.agePadOpen = false
  }

  render(state: ExperimentState, context: StudyPanelRenderContext): void {
    const language = state.configuration?.languageCode ?? this.setup.languageCode
    this.panel.setVisible(state.page !== 'stimulus')
    this.panel.setFooter({
      hint: studyText(language, 'app.incubator_notice'),
      status: context.localMessage || (context.storageHealthy ? 'Local storage ready' : 'Storage error'),
      tone: context.storageHealthy ? 'neutral' : 'danger',
    })
    const block = state.blocks[state.currentBlockIndex]
    this.panel.setHeader({
      eyebrow: 'SPATIAL STUDY 6 | WEBXR',
      title: studyText(language, `page.${state.page}.title` as Parameters<typeof studyText>[1]),
      progress: block ? `Block ${block.blockOrder} / 4` : '',
    })

    switch (state.page) {
      case 'operator_setup':
        this.renderSetup()
        break
      case 'participant_id':
        this.renderParticipant(state, context.usedParticipantIds)
        break
      case 'demographics':
        this.renderDemographics(language)
        break
      case 'block_ready':
        this.renderBlockReady(state, language)
        break
      case 'self_assessment_manikin':
        this.renderSam(state, language)
        break
      case 'affect_vas':
        this.renderAffect(state, language)
        break
      case 'emotion_representation_vas':
        this.renderEmotions(state, language)
        break
      case 'hand_embodiment':
        this.renderHand(state, language)
        break
      case 'technical_hold':
        this.panel.replaceBody(paragraph(studyText(language, 'technical_hold.body'), { size: 28 }))
        break
      case 'complete':
        this.renderComplete(language)
        break
      case 'stimulus':
        break
    }
  }

  private renderSetup(): void {
    const language = this.setup.languageCode
    const body = new Container({ width: '100%', flexDirection: 'column', gapRow: 16 })
    body.add(paragraph(studyText(language, 'page.operator_setup.language_body'), { size: 20 }))
    body.add(
      buttonRow(
        choiceButton({
          label: 'English',
          selected: this.setup.languageCode === 'en',
          onActivate: () => {
            this.setup.languageCode = 'en'
            this.renderSetup()
          },
        }),
        choiceButton({
          label: 'Deutsch',
          selected: this.setup.languageCode === 'de',
          onActivate: () => {
            this.setup.languageCode = 'de'
            this.renderSetup()
          },
        }),
      ),
    )
    body.add(paragraph(studyText(language, 'page.operator_setup.variant_body'), { size: 20 }))
    body.add(
      buttonRow(
        ...(['DHS', 'SHD'] as const).map((variantId) =>
          choiceButton({
            label: studyText(language, `variant.${variantId}`),
            selected: this.setup.variantId === variantId,
            onActivate: () => {
              this.setup.variantId = variantId
              this.renderSetup()
            },
          }),
        ),
      ),
    )
    body.add(
      buttonRow(
        ...(['full', 'clipped'] as const).map((timingMode) =>
          choiceButton({
            label: studyText(language, timingLabelKey(timingMode)),
            selected: this.setup.timingMode === timingMode,
            onActivate: () => {
              this.setup.timingMode = timingMode
              this.renderSetup()
            },
          }),
        ),
      ),
    )
    body.add(
      createSpatialButton({
        label: studyText(language, 'button.start_study'),
        width: 360,
        disabled: this.setup.variantId === null,
        onActivate: () => {
          if (!this.setup.variantId) return
          this.actions.configure({
            variantId: this.setup.variantId,
            languageCode: this.setup.languageCode,
            timingMode: this.setup.timingMode,
          })
        },
      }).root,
    )
    this.panel.replaceBody(body)
    this.panel.setHeader({ title: studyText(language, 'page.operator_setup.title') })
  }

  private renderParticipant(state: ExperimentState, usedIds: readonly string[]): void {
    const configuration = state.configuration
    if (!configuration) return
    const language = configuration.languageCode
    const available = availableParticipantIds(configuration.variantId, usedIds)
    if (!this.participantDraft) this.participantDraft = available[0] ?? ''
    const body = new Container({ width: '100%', flexDirection: 'column', gapRow: 18 })
    body.add(paragraph(studyText(language, 'page.participant_id.body'), { size: 21 }))
    const field = createSystemTextField({
      ariaLabel: studyText(language, 'participant.manual'),
      placeholder: variantSpec(configuration.variantId).participantPrefix,
      initialValue: this.participantDraft,
      maxLength: 32,
      onValueChange: (value) => {
        this.participantDraft = value.toUpperCase()
        start.setDisabled(
          participantIdViolation(this.participantDraft, configuration.variantId, usedIds) !== null,
        )
      },
    })
    const useNext = createSpatialButton({
      label: available[0] ? `${studyText(language, 'participant.select_unused')} | ${available[0]}` : studyText(language, 'participant.none_available'),
      variant: 'secondary',
      width: 520,
      disabled: available.length === 0,
      onActivate: () => {
        this.participantDraft = available[0] ?? ''
        field.setValue(this.participantDraft)
        start.setDisabled(this.participantDraft.length === 0)
      },
    })
    const start = createSpatialButton({
      label: studyText(language, 'button.start_participant'),
      width: 360,
      disabled:
        participantIdViolation(this.participantDraft, configuration.variantId, usedIds) !== null,
      onActivate: () => this.actions.startParticipant(this.participantDraft),
    })
    body.add(useNext.root, field.root)
    body.add(paragraph(studyText(language, 'participant.manual_note'), { size: 17, color: STUDY_UI_COLORS.textMuted }))
    body.add(start.root)
    this.panel.replaceBody(body)
  }

  private renderDemographics(language: LanguageCode): void {
    if (this.agePadOpen) {
      const digitPad = createAgeDigitPad({
        minAge: 0,
        maxAge: 120,
        initialValue: this.demographics.ageYears,
        copy: {
          emptyValue: '-',
          clear: language === 'de' ? 'Löschen' : 'Clear',
          backspace: '<-',
          confirm: studyText(language, 'button.done'),
          invalid: (minimum, maximum) => `${minimum}-${maximum}`,
        },
        onChange: (age) => {
          this.demographics.ageYears = age
        },
        onConfirm: (age) => {
          this.demographics.ageYears = age
          this.agePadOpen = false
          this.renderDemographics(language)
        },
      })
      this.panel.replaceBody(digitPad.root)
      return
    }

    const body = new Container({ width: '100%', flexDirection: 'column', gapRow: 13 })
    const nameRow = new Container({ width: '100%', flexDirection: 'row', gapColumn: 14 })
    const firstName = createSystemTextField({
      ariaLabel: studyText(language, 'demographics.first_name'),
      placeholder: studyText(language, 'demographics.first_name'),
      initialValue: this.demographics.firstName,
      width: 470,
      maxLength: 80,
      onValueChange: (value) => {
        this.demographics.firstName = value
      },
    })
    const lastName = createSystemTextField({
      ariaLabel: studyText(language, 'demographics.last_name'),
      placeholder: studyText(language, 'demographics.last_name'),
      initialValue: this.demographics.lastName,
      width: 470,
      maxLength: 80,
      onValueChange: (value) => {
        this.demographics.lastName = value
      },
    })
    nameRow.add(firstName.root, lastName.root)
    body.add(nameRow)
    body.add(
      createSpatialButton({
        label: `${studyText(language, 'demographics.age')}: ${this.demographics.ageYears ?? '-'}`,
        variant: 'secondary',
        width: 300,
        onActivate: () => {
          this.agePadOpen = true
          this.renderDemographics(language)
        },
      }).root,
    )
    body.add(
      buttonRow(
        ...(['right', 'left', 'ambidextrous', 'prefer_not_to_say'] as const).map((value) =>
          choiceButton({
            label: studyText(language, `handedness.${value}`),
            selected: this.demographics.handedness === value,
            width: 220,
            onActivate: () => {
              this.demographics.handedness = value
              this.renderDemographics(language)
            },
          }),
        ),
      ),
    )
    body.add(
      buttonRow(
        ...(['male', 'female', 'other', 'prefer_not_to_say'] as const).map((value) =>
          choiceButton({
            label: studyText(language, `gender.${value}`),
            selected: this.demographics.gender === value,
            width: 220,
            onActivate: () => {
              this.demographics.gender = value
              this.renderDemographics(language)
            },
          }),
        ),
      ),
    )
    body.add(
      choiceButton({
        label: studyText(language, 'consent.text'),
        selected: this.demographics.consentConfirmed,
        width: 760,
        onActivate: () => {
          this.demographics.consentConfirmed = !this.demographics.consentConfirmed
          this.renderDemographics(language)
        },
      }),
    )
    const candidate = this.demographicsValue()
    body.add(
      createSpatialButton({
        label: studyText(language, 'button.begin'),
        width: 320,
        disabled: candidate === null || validateDemographics(candidate).length > 0,
        onActivate: () => {
          const value = this.demographicsValue()
          if (value) this.actions.submitDemographics(value)
        },
      }).root,
    )
    this.panel.replaceBody(body)
  }

  private demographicsValue(): Demographics | null {
    if (
      this.demographics.ageYears === undefined ||
      this.demographics.handedness === null ||
      this.demographics.gender === null
    ) {
      return null
    }
    return {
      firstName: this.demographics.firstName,
      lastName: this.demographics.lastName,
      ageYears: this.demographics.ageYears,
      handedness: this.demographics.handedness,
      gender: this.demographics.gender,
      consentConfirmed: this.demographics.consentConfirmed,
    }
  }

  private renderBlockReady(state: ExperimentState, language: LanguageCode): void {
    const block = state.blocks[state.currentBlockIndex]
    if (!block) return
    const body = new Container({ width: '100%', flexDirection: 'column', gapRow: 24 })
    body.add(
      paragraph(
        formatStudyText(language, 'block.heading', {
          block: block.blockOrder,
          condition: block.conditionId,
        }),
        { size: 34 },
      ),
      paragraph(
        formatStudyText(language, 'block.assigned', {
          description: studyText(language, conditionDescriptionKey(block.conditionId)),
        }),
        { size: 25 },
      ),
      paragraph(
        formatStudyText(language, 'block.media', {
          media: block.mediaId,
          audio: block.audioVariantId,
          duration: state.configuration?.timingMode === 'clipped' ? '10 s' : '5 min',
        }),
        { size: 21, color: STUDY_UI_COLORS.textMuted },
      ),
      paragraph(studyText(language, 'block.instructions'), { size: 22 }),
      createSpatialButton({
        label: studyText(language, 'button.begin_assessment'),
        width: 400,
        onActivate: () => this.actions.startBlock(),
      }).root,
    )
    this.panel.replaceBody(body)
  }

  private renderSam(state: ExperimentState, language: LanguageCode): void {
    const draft = state.assessmentDraft
    const body = new Container({ width: '100%', flexDirection: 'column', gapRow: 7 })
    body.add(
      samRow({
        label: `${studyText(language, 'sam.valence.low')} <-> ${studyText(language, 'sam.valence.high')}`,
        dimension: 'valence',
        selected: draft.samValence,
        onSelect: (value) => this.actions.setSam('valence', value),
      }),
      samRow({
        label: studyText(language, 'sam.arousal.question'),
        dimension: 'arousal',
        selected: draft.samArousal,
        onSelect: (value) => this.actions.setSam('arousal', value),
      }),
      samRow({
        label: studyText(language, 'sam.dominance.question'),
        dimension: 'dominance',
        selected: draft.samDominance,
        onSelect: (value) => this.actions.setSam('dominance', value),
      }),
    )
    const controls = buttonRow(
      createSpatialButton({
        label: studyText(language, 'button.continue'),
        width: 280,
        disabled: draft.samValence === null || draft.samArousal === null || draft.samDominance === null,
        onActivate: () => this.actions.advanceAssessment(),
      }).root,
    )
    body.add(controls)
    this.panel.replaceBody(body)
  }

  private renderAffect(state: ExperimentState, language: LanguageCode): void {
    const draft = state.assessmentDraft
    const body = new Container({ width: '100%', flexDirection: 'column', gapRow: 14, alignItems: 'center' })
    body.add(paragraph(studyText(language, 'affect.instruction'), { size: 18 }))
    body.add(
      spatialScale({
        question: studyText(language, 'affect.valence.question'),
        minimum: -100,
        maximum: 100,
        value: draft.affectValence,
        touched: draft.affectValenceTouched,
        lowLabel: studyText(language, 'scale.unpleasant'),
        highLabel: studyText(language, 'scale.pleasant'),
        onChange: (value) => this.actions.setAffect('valence', value),
      }),
      spatialScale({
        question: studyText(language, 'affect.arousal.question'),
        minimum: -100,
        maximum: 100,
        value: draft.affectArousal,
        touched: draft.affectArousalTouched,
        lowLabel: studyText(language, 'scale.low_energy'),
        highLabel: studyText(language, 'scale.high_energy'),
        onChange: (value) => this.actions.setAffect('arousal', value),
      }),
    )
    body.add(
      buttonRow(
        createSpatialButton({
          label: studyText(language, 'button.back'),
          variant: 'secondary',
          width: 220,
          onActivate: () => this.actions.backAssessment(),
        }).root,
        createSpatialButton({
          label: studyText(language, 'button.continue'),
          width: 260,
          disabled: !draft.affectValenceTouched || !draft.affectArousalTouched,
          onActivate: () => this.actions.advanceAssessment(),
        }).root,
      ),
    )
    this.panel.replaceBody(body)
  }

  private renderEmotions(state: ExperimentState, language: LanguageCode): void {
    const draft = state.assessmentDraft
    const emotions = ['anger', 'disgust', 'fear', 'happiness', 'sadness', 'surprise'] as const
    const columns = new Container({ width: '100%', flexDirection: 'row', gapColumn: 22 })
    for (let columnIndex = 0; columnIndex < 2; columnIndex += 1) {
      const column = new Container({ width: 470, flexDirection: 'column', gapRow: 10 })
      for (const emotion of emotions.slice(columnIndex * 3, columnIndex * 3 + 3)) {
        column.add(
          spatialScale({
            question: studyText(language, `emotion.${emotion}`),
            minimum: 0,
            maximum: 100,
            value: draft[emotion],
            touched: draft[`${emotion}Touched`],
            lowLabel: studyText(language, 'emotion.not_represented'),
            highLabel: studyText(language, 'emotion.clearly_represented'),
            width: 450,
            compact: true,
            onChange: (value) => this.actions.setEmotion(emotion, value),
          }),
        )
      }
      columns.add(column)
    }
    const complete = emotions.every((emotion) => draft[`${emotion}Touched`])
    const body = new Container({ width: '100%', flexDirection: 'column', gapRow: 14 })
    body.add(columns)
    body.add(
      buttonRow(
        createSpatialButton({
          label: studyText(language, 'button.back'),
          variant: 'secondary',
          width: 220,
          onActivate: () => this.actions.backAssessment(),
        }).root,
        createSpatialButton({
          label: studyText(language, 'button.continue'),
          width: 260,
          disabled: !complete,
          onActivate: () => this.actions.advanceAssessment(),
        }).root,
      ),
    )
    this.panel.replaceBody(body)
  }

  private renderHand(state: ExperimentState, language: LanguageCode): void {
    const draft = state.assessmentDraft
    const body = new Container({ width: '100%', flexDirection: 'column', gapRow: 20, alignItems: 'center' })
    body.add(paragraph(studyText(language, 'hand.instruction'), { size: 19 }))
    body.add(
      spatialScale({
        question: studyText(language, 'hand.ownership'),
        minimum: 1,
        maximum: 7,
        value: draft.handOwnership ?? 4,
        touched: draft.handOwnership !== null,
        lowLabel: studyText(language, 'scale.strongly_disagree'),
        highLabel: studyText(language, 'scale.strongly_agree'),
        onChange: (value) => this.actions.setHand('ownership', value),
      }),
      spatialScale({
        question: studyText(language, 'hand.agency'),
        minimum: 1,
        maximum: 7,
        value: draft.handAgency ?? 4,
        touched: draft.handAgency !== null,
        lowLabel: studyText(language, 'scale.strongly_disagree'),
        highLabel: studyText(language, 'scale.strongly_agree'),
        onChange: (value) => this.actions.setHand('agency', value),
      }),
    )
    body.add(
      buttonRow(
        createSpatialButton({
          label: studyText(language, 'button.back'),
          variant: 'secondary',
          width: 220,
          onActivate: () => this.actions.backAssessment(),
        }).root,
        createSpatialButton({
          label: state.currentBlockIndex === 3 ? studyText(language, 'button.finish') : studyText(language, 'button.next_block'),
          width: 300,
          disabled: draft.handOwnership === null || draft.handAgency === null,
          onActivate: () => this.actions.advanceAssessment(),
        }).root,
      ),
    )
    this.panel.replaceBody(body)
  }

  private renderComplete(language: LanguageCode): void {
    const body = new Container({ width: '100%', flexDirection: 'column', gapRow: 24, alignItems: 'center' })
    body.add(
      paragraph(studyText(language, 'complete.heading'), { size: 36, align: 'center' }),
      paragraph(studyText(language, 'complete.body'), { size: 25, align: 'center' }),
      paragraph(studyText(language, 'complete.local_only'), {
        size: 21,
        color: STUDY_UI_COLORS.warning,
        align: 'center',
      }),
      buttonRow(
        createSpatialButton({ label: 'Export JSON', width: 230, onActivate: () => this.actions.exportJson() }).root,
        createSpatialButton({ label: 'Export CSV', variant: 'secondary', width: 230, onActivate: () => this.actions.exportCsv() }).root,
      ),
      createSpatialButton({
        label: language === 'de' ? 'Neue Sitzung' : 'Start new session',
        variant: 'secondary',
        width: 320,
        onActivate: () => this.actions.startNewSession(),
      }).root,
    )
    this.panel.replaceBody(body)
  }
}

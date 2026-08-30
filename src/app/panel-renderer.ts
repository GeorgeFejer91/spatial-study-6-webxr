import { Container, Text } from '@pmndrs/uikit'

import {
  disconnectedPolarStatus,
  polarProjectionIsReady,
  type PolarStatusProjection,
} from '../bridge/index.ts'
import {
  conditionDescriptionKey,
  formatStudyText,
  participantIdViolation,
  participantPool,
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
import type { ParticipantProgress } from '../persistence/database.ts'
import {
  createSpatialButton,
  createSystemTextField,
  QUESTIONNAIRE_VISUAL_CONTRACT,
  SpatialStudyPanel,
  STUDY_UI_COLORS,
} from '../ui/index.ts'
import {
  buttonRow,
  choiceButton,
  paragraph,
  samRow,
  scaleChoice,
  spatialScale,
} from './components.ts'

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
  setDemographicsLanguage(languageCode: LanguageCode): void
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
  participantProgress: readonly ParticipantProgress[]
  localMessage: string
  storageHealthy: boolean
  polar?: PolarStatusProjection
  startPreflightReady?: boolean
}

export class StudyPanelRenderer {
  private readonly panel: SpatialStudyPanel
  private readonly actions: StudyPanelActions
  private setup: SetupDraft = freshSetupDraft()
  private participantDraft = ''
  private demographics: DemographicsDraft = freshDemographicsDraft()

  constructor(
    panel: SpatialStudyPanel,
    actions: StudyPanelActions,
    initialDemographics?: Demographics,
  ) {
    this.panel = panel
    this.actions = actions
    if (initialDemographics) {
      this.demographics = { ...initialDemographics }
    }
  }

  /** Clears all operator and participant text held only in the live UI tree. */
  resetTransientState(): void {
    this.setup = freshSetupDraft()
    this.participantDraft = ''
    this.demographics = freshDemographicsDraft()
  }

  render(state: ExperimentState, context: StudyPanelRenderContext): void {
    const language = state.configuration?.languageCode ?? this.setup.languageCode
    const questionnairePage =
      state.page === 'self_assessment_manikin' ||
      state.page === 'affect_vas' ||
      state.page === 'emotion_representation_vas' ||
      state.page === 'hand_embodiment'
    this.panel.setVisible(state.page !== 'stimulus')
    this.panel.setDemographicsLayout(state.page === 'demographics')
    this.panel.setInteractionModeControlVisible(
      state.page !== 'operator_setup' && state.page !== 'stimulus',
    )
    this.panel.setFooter({
      hint: studyText(language, 'app.incubator_notice'),
      status: context.localMessage || (context.storageHealthy ? 'Local storage ready' : 'Storage error'),
      tone: context.storageHealthy ? 'neutral' : 'danger',
    })
    const block = state.blocks[state.currentBlockIndex]
    this.panel.setHeader({
      eyebrow: 'SPATIAL STUDY 6 | WEBXR',
      title: studyText(language, `page.${state.page}.title` as Parameters<typeof studyText>[1]),
      progress: questionnairePage ? '' : block ? `Block ${block.blockOrder} / 4` : '',
    })

    switch (state.page) {
      case 'operator_setup':
        this.renderSetup()
        break
      case 'participant_id':
        this.renderParticipant(state, context.participantProgress)
        break
      case 'demographics':
        this.renderDemographics(language, context.polar ?? disconnectedPolarStatus())
        break
      case 'block_ready':
        this.renderBlockReady(state, language, context.startPreflightReady ?? true)
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
      case 'aborted':
        this.renderAborted(language)
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

  private renderParticipant(
    state: ExperimentState,
    progressValues: readonly ParticipantProgress[],
  ): void {
    const configuration = state.configuration
    if (!configuration) return
    const language = configuration.languageCode
    const pool = participantPool(configuration.variantId)
    const progressById = new Map(
      progressValues.map((progress) => [progress.participantId, progress]),
    )
    if (!this.participantDraft) this.participantDraft = pool[0] ?? ''
    const progressText = (participantId: string) => {
      const progress = progressById.get(participantId.trim().toUpperCase())
      if (!progress) {
        return language === 'de'
          ? 'Aktueller Datensatz: 0/4 Fragebogenblöcke. Abgeschlossene Datensätze: 0.'
          : 'Current data set: 0/4 questionnaire blocks. Completed data sets: 0.'
      }
      return language === 'de'
        ? `Aktueller Datensatz: ${progress.completedBlocks}/4 Fragebogenblöcke. Abgeschlossene Datensätze: ${progress.completedDatasets}.`
        : `Current data set: ${progress.completedBlocks}/4 questionnaire blocks. Completed data sets: ${progress.completedDatasets}.`
    }
    const progressSummary = paragraph(progressText(this.participantDraft), {
      size: 17,
      color: STUDY_UI_COLORS.textMuted,
    })
    const body = new Container({ width: '100%', flexDirection: 'column', gapRow: 12 })
    body.add(paragraph(studyText(language, 'page.participant_id.body'), { size: 21 }))
    const grid = new Container({
      width: '100%',
      flexDirection: 'column',
      gapRow: 7,
    })
    const poolButtons: Array<{ participantId: string; root: Container; label: Text }> = []
    const projectSelection = () => {
      const selectedId = this.participantDraft.trim().toUpperCase()
      for (const button of poolButtons) {
        const selected = button.participantId === selectedId
        button.root.setProperties({
          backgroundColor: selected ? STUDY_UI_COLORS.accentSoft : STUDY_UI_COLORS.panelRaised,
          borderColor: selected ? STUDY_UI_COLORS.accent : STUDY_UI_COLORS.border,
          borderWidth: selected ? 2 : 1,
        })
        button.label.setProperties({
          color: selected ? STUDY_UI_COLORS.accentDark : STUDY_UI_COLORS.text,
        })
      }
      progressSummary.setProperties({ text: progressText(selectedId) })
    }
    for (let rowIndex = 0; rowIndex < 4; rowIndex += 1) {
      const row = new Container({ width: '100%', flexDirection: 'row', gapColumn: 7 })
      for (const participantId of pool.slice(rowIndex * 6, rowIndex * 6 + 6)) {
        const progress = progressById.get(participantId)
        const completedBlocks = progress?.completedBlocks ?? 0
        const completedDatasets = progress?.completedDatasets ?? 0
        const selected = participantId === this.participantDraft.trim().toUpperCase()
        const root = new Container({
          width: 158,
          height: 63,
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gapRow: 6,
          backgroundColor: selected ? STUDY_UI_COLORS.accentSoft : STUDY_UI_COLORS.panelRaised,
          borderColor: selected ? STUDY_UI_COLORS.accent : STUDY_UI_COLORS.border,
          borderWidth: selected ? 2 : 1,
          borderRadius: 6,
          cursor: 'pointer',
          pointerEvents: 'auto',
          hover: { backgroundColor: STUDY_UI_COLORS.accentHover },
          onClick: () => {
            this.participantDraft = participantId
            field.setValue(participantId)
            start.setDisabled(false)
            projectSelection()
          },
        })
        root.name = `study6-participant-${participantId}`
        const label = new Text({
          text: `${participantId}${completedDatasets > 0 ? ` · ${completedDatasets}x` : ''}`,
          color: selected ? STUDY_UI_COLORS.accentDark : STUDY_UI_COLORS.text,
          fontSize: 17,
          fontWeight: 'bold',
          pointerEvents: 'none',
        })
        const segments = new Container({
          width: 134,
          height: 6,
          flexDirection: 'row',
          gapColumn: 3,
          pointerEvents: 'none',
        })
        segments.name = `study6-participant-${participantId}-segments`
        for (let index = 0; index < 4; index += 1) {
          const segment = new Container({
            width: 31,
            height: 6,
            backgroundColor:
              index < completedBlocks ? STUDY_UI_COLORS.success : STUDY_UI_COLORS.border,
            borderRadius: 1,
            pointerEvents: 'none',
          })
          segment.name = `study6-participant-${participantId}-segment-${index + 1}`
          segments.add(segment)
        }
        root.add(label, segments)
        poolButtons.push({ participantId, root, label })
        row.add(root)
      }
      grid.add(row)
    }
    const field = createSystemTextField({
      ariaLabel: studyText(language, 'participant.manual'),
      placeholder: variantSpec(configuration.variantId).participantPrefix,
      initialValue: this.participantDraft,
      maxLength: 32,
      onValueChange: (value) => {
        this.participantDraft = value.toUpperCase()
        start.setDisabled(participantIdViolation(this.participantDraft, configuration.variantId) !== null)
        projectSelection()
      },
    })
    const start = createSpatialButton({
      label: studyText(language, 'button.start_participant'),
      width: 360,
      disabled: participantIdViolation(this.participantDraft, configuration.variantId) !== null,
      onActivate: () => this.actions.startParticipant(this.participantDraft),
    })
    body.add(grid, field.root)
    body.add(paragraph(studyText(language, 'participant.manual_note'), { size: 17, color: STUDY_UI_COLORS.textMuted }))
    body.add(progressSummary)
    body.add(start.root)
    this.panel.replaceBody(body)
  }

  private renderDemographics(language: LanguageCode, polar: PolarStatusProjection): void {
    let refreshValidity = () => undefined
    const body = new Container({ width: '100%', flexDirection: 'column', gapRow: 0 })
    body.name = 'study6-demographics'

    const ready = polarProjectionIsReady(polar)
    const statusColor = ready
      ? STUDY_UI_COLORS.success
      : polar.phase === 'fault'
        ? STUDY_UI_COLORS.danger
        : STUDY_UI_COLORS.warning
    const statusBackground = ready ? STUDY_UI_COLORS.successSoft : STUDY_UI_COLORS.warningSoft

    const polarStatus = new Container({
      width: '100%',
      height: 70,
      flexDirection: 'row',
      alignItems: 'center',
      gapColumn: 12,
      paddingTop: 8,
      paddingRight: 10,
      paddingBottom: 8,
      paddingLeft: 10,
      marginBottom: 6,
      backgroundColor: statusBackground,
      borderColor: statusColor,
      borderWidth: 1,
      borderRadius: 8,
    })
    polarStatus.name = 'study6-demographics-polar-status'
    polarStatus.add(
      new Container({
        width: 18,
        height: 18,
        marginRight: 10,
        backgroundColor: statusColor,
        borderRadius: 9,
      }),
      new Text({
        flexGrow: 1,
        text: this.polarStatusText(language, polar, ready),
        color: STUDY_UI_COLORS.text,
        fontSize: 14,
        fontWeight: 'bold',
        lineHeight: '120%',
      }),
      new Container({
        width: 300,
        height: 42,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ffffffb8',
        borderColor: statusColor,
        borderWidth: 1,
        borderRadius: 8,
      }),
    )
    const waveform = polarStatus.children[2] as Container
    waveform.name = 'study6-polar-waveform'
    this.renderPolarWaveform(waveform, polar, statusColor, language)
    body.add(polarStatus)

    const title = new Container({
      width: '100%',
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingBottom: 6,
    })
    title.add(
      new Text({
        width: '45%',
        text: studyText(language, 'page.demographics.title'),
        color: STUDY_UI_COLORS.text,
        fontSize: 17,
        fontWeight: 'bold',
      }),
      new Text({
        width: '55%',
        text: studyText(language, 'page.demographics.subtitle'),
        color: STUDY_UI_COLORS.textMuted,
        fontSize: 13,
        textAlign: 'right',
      }),
    )
    body.add(title)

    const columns = new Container({
      width: '100%',
      flexDirection: 'row',
      alignItems: 'flex-start',
      gapColumn: 18,
    })
    const left = new Container({ width: 528, flexDirection: 'column' })
    const right = new Container({ width: 478, flexDirection: 'column' })

    const labeledField = (options: {
      label: string
      value: string
      width: number
      inputMode?: 'text' | 'tel'
      maxLength: number
      changed: (value: string) => void
    }) => {
      const group = new Container({ width: options.width, flexDirection: 'column' })
      const label = paragraph(options.label, { size: 16, width: options.width })
      label.setProperties({ fontWeight: 'bold', paddingBottom: 4 })
      const field = createSystemTextField({
        ariaLabel: options.label,
        initialValue: options.value,
        width: options.width,
        inputMode: options.inputMode,
        maxLength: options.maxLength,
        onValueChange: (value) => {
          options.changed(value)
          refreshValidity()
        },
      })
      group.add(label, field.root)
      return group
    }

    const names = new Container({
      width: '100%',
      flexDirection: 'row',
      gapColumn: 8,
      paddingBottom: 8,
    })
    names.add(
      labeledField({
        label: studyText(language, 'demographics.first_name'),
        value: this.demographics.firstName,
        width: 260,
        maxLength: 80,
        changed: (value) => {
          this.demographics.firstName = value
        },
      }),
      labeledField({
        label: studyText(language, 'demographics.last_name'),
        value: this.demographics.lastName,
        width: 260,
        maxLength: 80,
        changed: (value) => {
          this.demographics.lastName = value
        },
      }),
    )
    left.add(names)
    left.add(
      labeledField({
        label: studyText(language, 'demographics.age'),
        value: this.demographics.ageYears?.toString() ?? '',
        width: 248,
        inputMode: 'tel',
        maxLength: 3,
        changed: (value) => {
          const digits = value.replace(/\D/g, '').slice(0, 3)
          this.demographics.ageYears = digits ? Number(digits) : undefined
        },
      }),
    )

    const compactChoices = <T extends string>(options: {
      label: string
      values: readonly T[]
      selected: T | null
      text: (value: T) => string
      changed: (value: T) => void
      width: number
    }) => {
      const group = new Container({ width: options.width, flexDirection: 'column' })
      const label = paragraph(options.label, { size: 14, width: options.width })
      label.setProperties({ fontWeight: 'bold', paddingTop: 6, paddingBottom: 4 })
      const row = new Container({
        width: options.width,
        height: QUESTIONNAIRE_VISUAL_CONTRACT.button.compactHeight,
        flexDirection: 'row',
        gapColumn: 6,
      })
      const controlWidth = (options.width - 6 * (options.values.length - 1)) / options.values.length
      options.values.forEach((value) =>
        row.add(
          choiceButton({
            label: options.text(value),
            selected: options.selected === value,
            width: controlWidth,
            height: QUESTIONNAIRE_VISUAL_CONTRACT.button.compactHeight,
            fontSize: 12,
            onActivate: () => options.changed(value),
          }),
        ),
      )
      group.add(label, row)
      return group
    }

    left.add(
      compactChoices({
        label: studyText(language, 'demographics.handedness'),
        values: ['right', 'left', 'ambidextrous', 'prefer_not_to_say'] as const,
        selected: this.demographics.handedness,
        text: (value) => studyText(language, `handedness.${value}`),
        width: 528,
        changed: (value) => {
          this.demographics.handedness = value
          this.renderDemographics(language, polar)
        },
      }),
      compactChoices({
        label: studyText(language, 'demographics.gender'),
        values: ['male', 'female', 'other', 'prefer_not_to_say'] as const,
        selected: this.demographics.gender,
        text: (value) => studyText(language, `gender.${value}`),
        width: 528,
        changed: (value) => {
          this.demographics.gender = value
          this.renderDemographics(language, polar)
        },
      }),
    )

    right.add(
      compactChoices({
        label: studyText(language, 'demographics.language'),
        values: ['en', 'de'] as const,
        selected: language,
        text: (value) => (value === 'en' ? 'English' : 'Deutsch'),
        width: 478,
        changed: (value) => this.actions.setDemographicsLanguage(value),
      }),
    )

    const consent = new Container({
      width: 478,
      height: QUESTIONNAIRE_VISUAL_CONTRACT.button.height,
      flexDirection: 'row',
      alignItems: 'center',
      gapColumn: 10,
      paddingLeft: 10,
      paddingRight: 10,
      marginTop: 4,
      backgroundColor: STUDY_UI_COLORS.panelRaised,
      borderColor: STUDY_UI_COLORS.border,
      borderWidth: 1,
      borderRadius: 8,
      cursor: 'pointer',
      pointerEvents: 'auto',
      onClick: () => {
        this.demographics.consentConfirmed = !this.demographics.consentConfirmed
        this.renderDemographics(language, polar)
      },
    })
    consent.name = 'study6-demographics-consent'
    const checkbox = new Container({
      width: 24,
      height: 24,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: this.demographics.consentConfirmed
        ? STUDY_UI_COLORS.accent
        : STUDY_UI_COLORS.panelRaised,
      borderColor: this.demographics.consentConfirmed
        ? STUDY_UI_COLORS.accent
        : STUDY_UI_COLORS.textMuted,
      borderWidth: 2,
      borderRadius: 3,
      pointerEvents: 'none',
    })
    checkbox.add(
      new Text({
        text: this.demographics.consentConfirmed ? 'X' : '',
        color: '#ffffff',
        fontSize: 16,
        fontWeight: 'bold',
        pointerEvents: 'none',
      }),
    )
    consent.add(
      checkbox,
      new Text({
        flexGrow: 1,
        text: studyText(language, 'consent.text'),
        color: STUDY_UI_COLORS.text,
        fontSize: 17,
        pointerEvents: 'none',
      }),
    )
    right.add(consent)

    const demographicsFooter = new Container({
      width: 478,
      height: 64,
      flexDirection: 'row',
      alignItems: 'center',
      paddingTop: 8,
    })
    const back = createSpatialButton({
      label: studyText(language, 'button.back'),
      variant: 'secondary',
      width: 78,
      disabled: true,
      onActivate: () => undefined,
    })
    const validation = new Text({
      flexGrow: 1,
      height: QUESTIONNAIRE_VISUAL_CONTRACT.button.height,
      paddingLeft: 10,
      paddingRight: 10,
      text: '',
      color: STUDY_UI_COLORS.warning,
      fontSize: 13,
      fontWeight: 'bold',
    })
    const begin = createSpatialButton({
      label: studyText(language, 'button.begin'),
      width: 190,
      onActivate: () => {
        const value = this.demographicsValue()
        if (value && validateDemographics(value).length === 0) {
          this.actions.submitDemographics(value)
        }
      },
    })
    demographicsFooter.add(back.root, validation, begin.root)
    right.add(demographicsFooter)

    refreshValidity = () => {
      const candidate = this.demographicsValue()
      const invalid = candidate === null || validateDemographics(candidate).length > 0
      begin.setDisabled(invalid)
      validation.setProperties({
        text: invalid ? studyText(language, 'validation.demographics') : '',
      })
    }
    refreshValidity()

    columns.add(left, right)
    body.add(columns)
    this.panel.replaceBody(body)
    this.panel.hideFooter()
  }

  private polarStatusText(
    language: LanguageCode,
    polar: PolarStatusProjection,
    ready: boolean,
  ): string {
    if (ready) {
      const hr = polar.heartRateBpm ?? 0
      return language === 'de'
        ? `Polar H10 ECG bereit\nHF ${hr} | ${polar.ecgSampleRateHz} Hz | ${polar.ecgSampleCount} Samples`
        : `Polar H10 ECG ready\nHR ${hr} | ${polar.ecgSampleRateHz} Hz | ${polar.ecgSampleCount} samples`
    }
    const reason = (polar.readinessReason.trim() || polar.phase.replaceAll('_', ' ')).slice(0, 72)
    return language === 'de' ? `Polar H10\nNicht bereit | ${reason}` : `Polar H10\nNot ready | ${reason}`
  }

  private renderPolarWaveform(
    target: Container,
    polar: PolarStatusProjection,
    color: string,
    language: LanguageCode,
  ): void {
    if (polar.previewKind !== 'real_samples' || polar.waveformMicrovolts.length === 0) {
      const empty = new Text({
        text: language === 'de' ? 'WARTE AUF ECHTE ECG-SAMPLES' : 'WAITING FOR REAL ECG SAMPLES',
        color: STUDY_UI_COLORS.textMuted,
        fontSize: 10,
        fontWeight: 'bold',
      })
      empty.name = 'study6-polar-waveform-empty'
      target.add(empty)
      return
    }

    const maximumBars = 48
    const step = Math.max(1, Math.ceil(polar.waveformMicrovolts.length / maximumBars))
    const samples = polar.waveformMicrovolts.filter((_, index) => index % step === 0).slice(-maximumBars)
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length
    const centered = samples.map((value) => value - mean)
    const amplitude = Math.max(1, ...centered.map((value) => Math.abs(value)))
    const graph = new Container({
      width: 280,
      height: 34,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gapColumn: 1,
    })
    graph.name = 'study6-polar-waveform-real'
    centered.forEach((value, index) => {
      const bar = new Container({
        width: 4,
        height: Math.max(2, Math.round((Math.abs(value) / amplitude) * 30)),
        backgroundColor: color,
        borderRadius: 1,
      })
      bar.name = `study6-polar-waveform-sample-${index}`
      graph.add(bar)
    })
    target.add(graph)
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

  private renderBlockReady(
    state: ExperimentState,
    language: LanguageCode,
    startPreflightReady: boolean,
  ): void {
    const block = state.blocks[state.currentBlockIndex]
    if (!block) return
    const body = new Container({ width: '100%', flexDirection: 'column', gapRow: 24 })
    const start = createSpatialButton({
      label: studyText(language, 'button.begin_assessment'),
      width: 400,
      onActivate: () => this.actions.startBlock(),
    }).root
    start.name = 'study6-block-start'
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
      ...(startPreflightReady
        ? []
        : [
            paragraph(
              language === 'de'
                ? 'ECG ist nicht bereit. Die Aufzeichnung darf fortgesetzt werden, bleibt aber als nicht ECG-qualifiziert markiert.'
                : 'ECG is not ready. Recording may continue, but this block remains marked as not ECG-qualified.',
              { size: 18, color: STUDY_UI_COLORS.warning },
            ),
          ]),
      start,
    )
    this.panel.replaceBody(body)
  }

  private renderQuestionnaireFooter(options: {
    language: LanguageCode
    back: boolean
    complete: boolean
    warning: string
    readyMessage?: string
    nextLabel: string
  }): void {
    const contract = QUESTIONNAIRE_VISUAL_CONTRACT
    const children: Array<Container | Text> = []
    if (options.back) {
      const back = createSpatialButton({
        label: studyText(options.language, 'button.back'),
        variant: 'secondary',
        width: contract.footer.backWidth,
        onActivate: () => this.actions.backAssessment(),
      }).root
      back.name = 'study6-questionnaire-back'
      children.push(back)
    }
    const message = new Text({
      flexGrow: 1,
      height: contract.button.height,
      paddingLeft: contract.footer.messagePadding,
      paddingRight: contract.footer.messagePadding,
      text: options.complete ? options.readyMessage ?? '' : options.warning,
      color: options.complete ? STUDY_UI_COLORS.textMuted : STUDY_UI_COLORS.warning,
      fontSize: contract.footer.messageSize,
      fontWeight: options.complete ? 'normal' : 'bold',
    })
    message.name = 'study6-questionnaire-validation'
    const next = createSpatialButton({
      label: options.nextLabel,
      width: contract.footer.nextWidth,
      disabled: !options.complete,
      onActivate: () => this.actions.advanceAssessment(),
    }).root
    next.name = 'study6-questionnaire-next'
    children.push(message, next)
    this.panel.replaceFooter(...children)
  }

  private renderSam(state: ExperimentState, language: LanguageCode): void {
    const draft = state.assessmentDraft
    const body = new Container({ width: '100%', flexDirection: 'column', gapRow: 0 })
    body.name = 'study6-questionnaire-sam'
    body.add(
      samRow({
        question: '',
        lowLabel: studyText(language, 'sam.valence.low'),
        highLabel: studyText(language, 'sam.valence.high'),
        dimension: 'valence',
        selected: draft.samValence,
        onSelect: (value) => this.actions.setSam('valence', value),
      }),
      samRow({
        question: studyText(language, 'sam.arousal.question'),
        lowLabel: studyText(language, 'sam.arousal.low'),
        highLabel: studyText(language, 'sam.arousal.high'),
        dimension: 'arousal',
        selected: draft.samArousal,
        onSelect: (value) => this.actions.setSam('arousal', value),
      }),
      samRow({
        question: studyText(language, 'sam.dominance.question'),
        lowLabel: studyText(language, 'sam.dominance.low'),
        highLabel: studyText(language, 'sam.dominance.high'),
        dimension: 'dominance',
        selected: draft.samDominance,
        onSelect: (value) => this.actions.setSam('dominance', value),
      }),
    )
    this.panel.replaceBody(body)
    this.renderQuestionnaireFooter({
      language,
      back: false,
      complete:
        draft.samValence !== null &&
        draft.samArousal !== null &&
        draft.samDominance !== null,
      warning: studyText(language, 'validation.sam'),
      readyMessage: studyText(language, 'sam.instruction.footer'),
      nextLabel: studyText(language, 'button.continue'),
    })
  }

  private renderAffect(state: ExperimentState, language: LanguageCode): void {
    const draft = state.assessmentDraft
    const body = new Container({ width: '100%', flexDirection: 'column', gapRow: 0, alignItems: 'center' })
    body.name = 'study6-questionnaire-affect'
    body.add(paragraph(studyText(language, 'affect.instruction'), { size: 16 }))
    body.add(
      spatialScale({
        question: studyText(language, 'affect.valence.question'),
        minimum: -100,
        maximum: 100,
        value: draft.affectValence,
        touched: draft.affectValenceTouched,
        lowLabel: studyText(language, 'scale.unpleasant'),
        highLabel: studyText(language, 'scale.pleasant'),
        neutralLabel: studyText(language, 'scale.neutral'),
        signed: true,
        name: 'study6-affect-valence',
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
        neutralLabel: studyText(language, 'scale.neutral'),
        signed: true,
        name: 'study6-affect-arousal',
        onChange: (value) => this.actions.setAffect('arousal', value),
      }),
    )
    this.panel.replaceBody(body)
    this.renderQuestionnaireFooter({
      language,
      back: true,
      complete: draft.affectValenceTouched && draft.affectArousalTouched,
      warning: studyText(language, 'validation.affect'),
      nextLabel: studyText(language, 'button.continue'),
    })
  }

  private renderEmotions(state: ExperimentState, language: LanguageCode): void {
    const draft = state.assessmentDraft
    const emotions = ['anger', 'disgust', 'fear', 'happiness', 'sadness', 'surprise'] as const
    const body = new Container({ width: '100%', flexDirection: 'column', gapRow: 2 })
    body.name = 'study6-questionnaire-emotions'
    body.add(paragraph(studyText(language, 'emotion.instruction'), { size: 16 }))
    for (let rowIndex = 0; rowIndex < 2; rowIndex += 1) {
      const row = new Container({ width: '100%', flexDirection: 'row', gapColumn: 20 })
      row.name = `study6-emotion-row-${rowIndex + 1}`
      for (const emotion of emotions.slice(rowIndex * 3, rowIndex * 3 + 3)) {
        row.add(
          spatialScale({
            question: studyText(language, `emotion.${emotion}`),
            minimum: 0,
            maximum: 100,
            value: draft[emotion],
            touched: draft[`${emotion}Touched`],
            lowLabel: studyText(language, 'emotion.not_represented'),
            highLabel: studyText(language, 'emotion.clearly_represented'),
            width: 328,
            showFill: true,
            name: `study6-emotion-${emotion}`,
            onChange: (value) => this.actions.setEmotion(emotion, value),
          }),
        )
      }
      body.add(row)
    }
    const complete = emotions.every((emotion) => draft[`${emotion}Touched`])
    this.panel.replaceBody(body)
    this.renderQuestionnaireFooter({
      language,
      back: true,
      complete,
      warning: studyText(language, 'validation.emotions'),
      nextLabel: studyText(language, 'button.continue'),
    })
  }

  private renderHand(state: ExperimentState, language: LanguageCode): void {
    const draft = state.assessmentDraft
    const body = new Container({ width: '100%', flexDirection: 'column', gapRow: 0 })
    body.name = 'study6-questionnaire-hand'
    body.add(paragraph(studyText(language, 'hand.instruction'), { size: 16 }))
    body.add(
      scaleChoice({
        question: studyText(language, 'hand.ownership'),
        lowLabel: studyText(language, 'scale.strongly_disagree'),
        highLabel: studyText(language, 'scale.strongly_agree'),
        selected: draft.handOwnership,
        name: 'study6-hand-ownership',
        onSelect: (value) => this.actions.setHand('ownership', value),
      }),
      scaleChoice({
        question: studyText(language, 'hand.agency'),
        lowLabel: studyText(language, 'scale.strongly_disagree'),
        highLabel: studyText(language, 'scale.strongly_agree'),
        selected: draft.handAgency,
        name: 'study6-hand-agency',
        onSelect: (value) => this.actions.setHand('agency', value),
      }),
    )
    this.panel.replaceBody(body)
    this.renderQuestionnaireFooter({
      language,
      back: true,
      complete: draft.handOwnership !== null && draft.handAgency !== null,
      warning: studyText(language, 'validation.hand'),
      nextLabel:
        state.currentBlockIndex === 3
          ? studyText(language, 'button.finish')
          : studyText(language, 'button.next_block'),
    })
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

  private renderAborted(language: LanguageCode): void {
    const body = new Container({
      width: '100%',
      flexDirection: 'column',
      gapRow: 24,
      alignItems: 'center',
    })
    body.add(
      paragraph(studyText(language, 'aborted.heading'), { size: 36, align: 'center' }),
      paragraph(studyText(language, 'aborted.body'), { size: 25, align: 'center' }),
      buttonRow(
        createSpatialButton({
          label: 'Export JSON',
          width: 230,
          onActivate: () => this.actions.exportJson(),
        }).root,
        createSpatialButton({
          label: 'Export CSV',
          variant: 'secondary',
          width: 230,
          onActivate: () => this.actions.exportCsv(),
        }).root,
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

import type { ConditionId, LanguageCode, TimingMode } from "./types"

export const COPY_PROVENANCE = {
  sourceRepository: "MesmerPrism/spatial-study-6",
  sourceRevision: "dd41646e02e4a1d73b990626b74048d34ce8f26a",
  sourceTree: "0764bcfad349aee20724b3a8fe50c776410fe3d3",
  upstreamAuthorityRepository: "MesmerPrism/study-6",
  upstreamAuthorityRevision: "994498c9299b3f5d5475047eb32022b629a83473",
  questionnaireSchemaId: "study6-questionnaire-v8",
  english: "Current v1 native questionnaire-panel wording",
  german:
    "Complete German projection; native v1 supplied demographics, titles, and SAM wording, with the remaining native English strings translated without changing response fields or scales.",
} as const

const ENGLISH_COPY = {
  "app.title": "Spatial Study 6",
  "app.incubator_notice":
    "WebXR incubator | test-only | not eligible for participant or release evidence",
  "page.operator_setup.title": "Study configuration",
  "page.operator_setup.language_title": "Language",
  "page.operator_setup.language_body":
    "Choose the questionnaire and instruction language before a participant session is created.",
  "page.operator_setup.variant_title": "Choose the particle-role variant",
  "page.operator_setup.variant_body":
    "DHS uses the Hand media set. SHD uses the Env media set. This choice is fixed for the participant session.",
  "variant.DHS": "DHS | Hand",
  "variant.SHD": "SHD | Environment",
  "timing.title": "Block timing",
  "timing.full": "Full study (5 min)",
  "timing.clipped": "Web test (10 s)",
  "page.participant_id.title": "Participant ID",
  "page.participant_id.body":
    "Choose the next unused Study 6 id in this browser, or enter a manual id before this app creates its local durable session and questionnaire data.",
  "participant.available": "Available {prefix} ids",
  "participant.select_unused": "Select unused {prefix} id",
  "participant.none_available": "No unused {prefix} ids remain",
  "participant.manual": "Manual participant id",
  "participant.manual_note":
    "Manual ids are allowed, but cannot match an id already recorded in this browser. Use a non-pool manual id for testing so PI/PH allocations are not consumed.",
  "page.demographics.title": "Demographics",
  "page.demographics.subtitle": "Participant details and consent",
  "demographics.first_name": "First name",
  "demographics.last_name": "Last name",
  "demographics.age": "Age",
  "demographics.handedness": "Handedness",
  "demographics.gender": "Gender",
  "demographics.language": "Language",
  "handedness.right": "Right",
  "handedness.left": "Left",
  "handedness.ambidextrous": "Ambidextrous",
  "handedness.prefer_not_to_say": "Prefer not to say",
  "gender.male": "Male",
  "gender.female": "Female",
  "gender.other": "Other",
  "gender.prefer_not_to_say": "Prefer not to say",
  "consent.text": "I consent to participate in this study.",
  "page.block_ready.title": "Assessment block",
  "block.heading": "Block {block} | {condition}",
  "block.assigned": "Assigned condition: {description}.",
  "block.media": "Media: {media} | Audio: {audio} | {duration}.",
  "block.instructions":
    "Keep your attention on the labelled stimulus for the complete block. Press Begin assessment once; the app starts the assigned placeholder video and its guided audio, then hides this panel.",
  "condition.HC_HE": "high coherence / high energy",
  "condition.LC_HE": "low coherence / high energy",
  "condition.HC_LE": "high coherence / low energy",
  "condition.LC_LE": "low coherence / low energy",
  "page.stimulus.title": "Stimulus in progress",
  "stimulus.pause": "Pause",
  "stimulus.resume": "Resume",
  "stimulus.remaining": "Remaining {time}",
  "page.self_assessment_manikin.title":
    "How did you feel during the last session?",
  "sam.instruction.footer":
    "For each row, choose the picture that best matches how you felt.",
  "sam.valence.low": "Unpleasant",
  "sam.valence.high": "Pleasant",
  "sam.arousal.question": "How activated did you feel?",
  "sam.arousal.low": "Low Energy",
  "sam.arousal.high": "High Energy",
  "sam.dominance.question":
    "How much control did you feel during your experience?",
  "sam.dominance.low": "Not in control",
  "sam.dominance.high": "In control",
  "page.affect_vas.title":
    "How pleasant and activated did the last session feel?",
  "affect.instruction":
    "Each scale starts at 0 (neutral). Touch each slider once to confirm your answer; 0 is allowed after you touch the slider.",
  "affect.valence.question":
    "How pleasant did the previous experience feel?",
  "affect.arousal.question":
    "How activated did you feel in the previous experience?",
  "scale.unpleasant": "Unpleasant",
  "scale.pleasant": "Pleasant",
  "scale.low_energy": "Low Energy",
  "scale.high_energy": "High Energy",
  "scale.neutral": "0 (neutral)",
  "page.emotion_representation_vas.title":
    "Which emotions were represented by the particle movement?",
  "emotion.instruction":
    "Move every scale once to indicate how strongly the particle movement represented that emotion, including if your answer remains 0.",
  "emotion.anger": "Anger",
  "emotion.disgust": "Disgust",
  "emotion.fear": "Fear",
  "emotion.happiness": "Happiness",
  "emotion.sadness": "Sadness",
  "emotion.surprise": "Surprise",
  "emotion.not_represented": "Not represented",
  "emotion.clearly_represented": "Clearly represented",
  "page.hand_embodiment.title":
    "Did the virtual hands feel like they are your hands?",
  "hand.instruction": "Rate how much you agree or disagree with each statement.",
  "hand.ownership": "The virtual hands felt like my own hands.",
  "hand.agency": "I felt in control of the virtual hands.",
  "scale.strongly_disagree": "Strongly disagree",
  "scale.strongly_agree": "Strongly agree",
  "page.technical_hold.title": "Session paused",
  "technical_hold.body":
    "The session is preserved locally. An operator must resolve the problem before continuing.",
  "page.complete.title": "Complete",
  "complete.heading": "Questionnaire complete",
  "complete.body":
    "All four block questionnaires have been completed and written to durable browser storage.",
  "complete.local_only":
    "This WebXR incubator run remains test-only and participant-ineligible.",
  "button.start_study": "Start Study 6",
  "button.start_participant": "Start participant",
  "button.begin": "Begin",
  "button.begin_assessment": "Begin assessment",
  "button.continue": "Continue",
  "button.back": "Back",
  "button.next_block": "Next block",
  "button.finish": "Finish",
  "button.done": "Done",
  "validation.variant": "Choose DHS or SHD.",
  "validation.participant_required": "Required: participant id.",
  "validation.participant_malformed":
    "Participant id may only use letters, numbers, dash, or underscore.",
  "validation.participant_other_variant":
    "Participant id belongs to the other Study 6 variant.",
  "validation.participant_used":
    "Participant id has already been recorded in this browser.",
  "validation.demographics":
    "Complete first name, last name, age, handedness, gender, and consent.",
  "validation.sam": "Select all three SAM values.",
  "validation.affect": "Touch both affect sliders once.",
  "validation.emotions": "Touch all six emotion sliders once.",
  "validation.hand": "Answer both hand embodiment items.",
} as const

export type CopyKey = keyof typeof ENGLISH_COPY

const GERMAN_COPY = {
  "app.title": "Spatial Study 6",
  "app.incubator_notice":
    "WebXR-Inkubator | nur zu Testzwecken | nicht als Teilnehmer- oder Freigabenachweis geeignet",
  "page.operator_setup.title": "Studienkonfiguration",
  "page.operator_setup.language_title": "Sprache",
  "page.operator_setup.language_body":
    "Wählen Sie die Sprache des Fragebogens und der Anweisungen, bevor eine Teilnehmersitzung erstellt wird.",
  "page.operator_setup.variant_title": "Partikelrollen-Variante auswählen",
  "page.operator_setup.variant_body":
    "DHS verwendet den Hand-Mediensatz. SHD verwendet den Umgebungs-Mediensatz. Diese Auswahl gilt für die gesamte Teilnehmersitzung.",
  "variant.DHS": "DHS | Hand",
  "variant.SHD": "SHD | Umgebung",
  "timing.title": "Blockdauer",
  "timing.full": "Vollständige Studie (5 Min.)",
  "timing.clipped": "Webtest (10 Sek.)",
  "page.participant_id.title": "Teilnehmer-ID",
  "page.participant_id.body":
    "Wählen Sie die nächste unbenutzte Study-6-ID in diesem Browser oder geben Sie eine manuelle ID ein, bevor die App die lokale dauerhafte Sitzung und Fragebogendaten erstellt.",
  "participant.available": "Verfügbare {prefix}-IDs",
  "participant.select_unused": "Unbenutzte {prefix}-ID auswählen",
  "participant.none_available": "Keine unbenutzten {prefix}-IDs mehr verfügbar",
  "participant.manual": "Manuelle Teilnehmer-ID",
  "participant.manual_note":
    "Manuelle IDs sind zulässig, dürfen aber keiner bereits in diesem Browser erfassten ID entsprechen. Verwenden Sie für Tests eine manuelle ID außerhalb des Pools, damit keine PI-/PH-Zuteilung verbraucht wird.",
  "page.demographics.title": "Demografische Angaben",
  "page.demographics.subtitle": "Teilnehmerdaten und Einwilligung",
  "demographics.first_name": "Vorname",
  "demographics.last_name": "Nachname",
  "demographics.age": "Alter",
  "demographics.handedness": "Händigkeit",
  "demographics.gender": "Geschlecht",
  "demographics.language": "Sprache",
  "handedness.right": "Rechts",
  "handedness.left": "Links",
  "handedness.ambidextrous": "Beidhändig",
  "handedness.prefer_not_to_say": "Keine Angabe",
  "gender.male": "Männlich",
  "gender.female": "Weiblich",
  "gender.other": "Divers",
  "gender.prefer_not_to_say": "Keine Angabe",
  "consent.text": "Ich willige ein, an dieser Studie teilzunehmen.",
  "page.block_ready.title": "Bewertungsblock",
  "block.heading": "Block {block} | {condition}",
  "block.assigned": "Zugewiesene Bedingung: {description}.",
  "block.media": "Medium: {media} | Audio: {audio} | {duration}.",
  "block.instructions":
    "Richten Sie Ihre Aufmerksamkeit während des gesamten Blocks auf den beschrifteten Stimulus. Drücken Sie einmal auf Bewertung beginnen; die App startet das zugewiesene Platzhaltervideo und die gesprochenen Anweisungen und blendet anschließend dieses Panel aus.",
  "condition.HC_HE": "hohe Kohärenz / hohe Energie",
  "condition.LC_HE": "niedrige Kohärenz / hohe Energie",
  "condition.HC_LE": "hohe Kohärenz / niedrige Energie",
  "condition.LC_LE": "niedrige Kohärenz / niedrige Energie",
  "page.stimulus.title": "Stimulus läuft",
  "stimulus.pause": "Pausieren",
  "stimulus.resume": "Fortsetzen",
  "stimulus.remaining": "Verbleibend {time}",
  "page.self_assessment_manikin.title":
    "Wie haben Sie sich während der letzten Sitzung gefühlt?",
  "sam.instruction.footer":
    "Wählen Sie in jeder Zeile das Bild aus, das am besten beschreibt, wie Sie sich gefühlt haben.",
  "sam.valence.low": "Unangenehm",
  "sam.valence.high": "Angenehm",
  "sam.arousal.question": "Wie aktiviert fühlten Sie sich?",
  "sam.arousal.low": "Wenig aktiviert",
  "sam.arousal.high": "Stark aktiviert",
  "sam.dominance.question":
    "Wie viel Kontrolle hatten Sie während Ihrer Erfahrung?",
  "sam.dominance.low": "Keine Kontrolle",
  "sam.dominance.high": "Viel Kontrolle",
  "page.affect_vas.title":
    "Wie angenehm und aktiviert fühlte sich die letzte Sitzung an?",
  "affect.instruction":
    "Jede Skala beginnt bei 0 (neutral). Berühren Sie jeden Schieberegler einmal, um Ihre Antwort zu bestätigen; 0 ist nach dem Berühren zulässig.",
  "affect.valence.question":
    "Wie angenehm fühlte sich die vorherige Erfahrung an?",
  "affect.arousal.question":
    "Wie aktiviert fühlten Sie sich bei der vorherigen Erfahrung?",
  "scale.unpleasant": "Unangenehm",
  "scale.pleasant": "Angenehm",
  "scale.low_energy": "Niedrige Energie",
  "scale.high_energy": "Hohe Energie",
  "scale.neutral": "0 (neutral)",
  "page.emotion_representation_vas.title":
    "Welche Emotionen wurden durch die Partikelbewegung dargestellt?",
  "emotion.instruction":
    "Bewegen Sie jede Skala einmal, um anzugeben, wie stark die Partikelbewegung diese Emotion darstellte, auch wenn Ihre Antwort 0 bleibt.",
  "emotion.anger": "Ärger",
  "emotion.disgust": "Ekel",
  "emotion.fear": "Angst",
  "emotion.happiness": "Freude",
  "emotion.sadness": "Traurigkeit",
  "emotion.surprise": "Überraschung",
  "emotion.not_represented": "Nicht dargestellt",
  "emotion.clearly_represented": "Deutlich dargestellt",
  "page.hand_embodiment.title":
    "Fühlten sich die virtuellen Hände wie Ihre eigenen Hände an?",
  "hand.instruction":
    "Geben Sie an, wie sehr Sie jeder Aussage zustimmen oder widersprechen.",
  "hand.ownership": "Die virtuellen Hände fühlten sich wie meine eigenen Hände an.",
  "hand.agency": "Ich hatte das Gefühl, die virtuellen Hände zu kontrollieren.",
  "scale.strongly_disagree": "Stimme überhaupt nicht zu",
  "scale.strongly_agree": "Stimme voll und ganz zu",
  "page.technical_hold.title": "Sitzung pausiert",
  "technical_hold.body":
    "Die Sitzung ist lokal gesichert. Eine Bedienperson muss das Problem beheben, bevor die Sitzung fortgesetzt werden kann.",
  "page.complete.title": "Abgeschlossen",
  "complete.heading": "Fragebogen abgeschlossen",
  "complete.body":
    "Alle vier Blockfragebögen wurden abgeschlossen und im dauerhaften Browserspeicher gespeichert.",
  "complete.local_only":
    "Dieser WebXR-Inkubatorlauf bleibt ein reiner Testlauf und ist nicht als Teilnehmerdatensatz zugelassen.",
  "button.start_study": "Study 6 starten",
  "button.start_participant": "Teilnehmersitzung starten",
  "button.begin": "Beginnen",
  "button.begin_assessment": "Bewertung beginnen",
  "button.continue": "Weiter",
  "button.back": "Zurück",
  "button.next_block": "Nächster Block",
  "button.finish": "Abschließen",
  "button.done": "Fertig",
  "validation.variant": "Wählen Sie DHS oder SHD.",
  "validation.participant_required": "Erforderlich: Teilnehmer-ID.",
  "validation.participant_malformed":
    "Die Teilnehmer-ID darf nur Buchstaben, Zahlen, Bindestriche oder Unterstriche enthalten.",
  "validation.participant_other_variant":
    "Die Teilnehmer-ID gehört zur anderen Study-6-Variante.",
  "validation.participant_used":
    "Die Teilnehmer-ID wurde bereits in diesem Browser erfasst.",
  "validation.demographics":
    "Vervollständigen Sie Vorname, Nachname, Alter, Händigkeit, Geschlecht und Einwilligung.",
  "validation.sam": "Wählen Sie alle drei SAM-Werte aus.",
  "validation.affect": "Berühren Sie beide Affektregler einmal.",
  "validation.emotions": "Berühren Sie alle sechs Emotionsregler einmal.",
  "validation.hand": "Beantworten Sie beide Fragen zur Handverkörperung.",
} satisfies Record<CopyKey, string>

export const STUDY_COPY: Record<LanguageCode, Record<CopyKey, string>> = {
  en: ENGLISH_COPY,
  de: GERMAN_COPY,
}

export function studyText(language: LanguageCode, key: CopyKey): string {
  return STUDY_COPY[language][key]
}

export function formatStudyText(
  language: LanguageCode,
  key: CopyKey,
  replacements: Record<string, string | number>,
): string {
  return Object.entries(replacements).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    studyText(language, key),
  )
}

export function conditionDescriptionKey(
  conditionId: ConditionId,
): Extract<CopyKey, `condition.${string}`> {
  return `condition.${conditionId}`
}

export function timingLabelKey(
  timingMode: TimingMode,
): Extract<CopyKey, `timing.${string}`> {
  return `timing.${timingMode}`
}

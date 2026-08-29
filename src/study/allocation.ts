import {
  AUDIO_VARIANT_IDS,
  CONDITION_IDS,
  type AudioVariantId,
  type ConditionId,
  type LanguageCode,
  type PlannedBlock,
  type VariantId,
  type VariantSpec,
} from "./types"

export const ALLOCATION_SOURCE_REVISION =
  "994498c9299b3f5d5475047eb32022b629a83473" as const
export const ALLOCATION_LOOKUP_BLOB_SHA1 =
  "dbfdd87fd15fc8934151ef050efc74fa25b2612a" as const
export const PARTICIPANT_POOL_SIZE = 24

const VARIANT_SPECS: Record<VariantId, VariantSpec> = {
  DHS: {
    participantPrefix: "PH",
    dataFolder: "Study6_dynamic_hands_static_icosphere_data",
    apkFileCode: "DYN_HANDS_STAT_ICO",
    mappingTarget: "hand_avatar",
    mediaSurface: "Hand",
  },
  SHD: {
    participantPrefix: "PI",
    dataFolder: "Study6_static_hands_dynamic_icosphere_data",
    apkFileCode: "STAT_HANDS_DYN_ICO",
    mappingTarget: "background_environment",
    mediaSurface: "Env",
  },
}

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length <= 1) return [Array.from(values)]
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidate) => candidate !== index)).map(
      (tail) => [value, ...tail],
    ),
  )
}

export const CONDITION_PERMUTATIONS: readonly (readonly ConditionId[])[] =
  permutations(CONDITION_IDS)
export const AUDIO_PERMUTATIONS: readonly (readonly AudioVariantId[])[] =
  permutations(AUDIO_VARIANT_IDS)

export function normalizeParticipantId(value: string): string {
  return value.trim().toUpperCase()
}

/** Java's String.hashCode(), including signed 32-bit overflow and UTF-16 units. */
export function javaStringHashCode(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(31, hash) + value.charCodeAt(index)) | 0
  }
  return hash
}

function positiveTrailingJavaInt(value: string): number | null {
  const match = /(\d+)$/.exec(value)
  if (!match) return null
  const parsed = Number(match[1])
  if (!Number.isSafeInteger(parsed) || parsed > 2_147_483_647 || parsed <= 0) {
    return null
  }
  return parsed
}

export function permutationNumber(participantId: string): number {
  const normalized = normalizeParticipantId(participantId)
  const numeric = positiveTrailingJavaInt(normalized)
  const participantNumber =
    numeric ?? Math.abs(javaStringHashCode(normalized) % 100_000) + 1
  return ((participantNumber - 1) % CONDITION_PERMUTATIONS.length) + 1
}

export function variantSpec(variantId: VariantId): VariantSpec {
  return VARIANT_SPECS[variantId]
}

export function participantPool(variantId: VariantId): string[] {
  const prefix = variantSpec(variantId).participantPrefix
  return Array.from(
    { length: PARTICIPANT_POOL_SIZE },
    (_, index) => `${prefix}${index + 1}`,
  )
}

export function availableParticipantIds(
  variantId: VariantId,
  usedParticipantIds: readonly string[],
): string[] {
  const used = new Set(usedParticipantIds.map(normalizeParticipantId))
  return participantPool(variantId).filter((participantId) => !used.has(participantId))
}

export function participantIdViolation(
  participantId: string,
  variantId: VariantId,
  usedParticipantIds: readonly string[] = [],
): string | null {
  const normalized = normalizeParticipantId(participantId)
  if (!normalized) return "participant_id_required"
  if (!/^[A-Z0-9_-]{1,32}$/.test(normalized)) return "participant_id_malformed"

  const officialPrefix = /^(PI|PH)\d+$/.exec(normalized)?.[1]
  if (officialPrefix && officialPrefix !== variantSpec(variantId).participantPrefix) {
    return "participant_id_other_variant"
  }
  const used = new Set(usedParticipantIds.map(normalizeParticipantId))
  if (used.has(normalized)) return "participant_id_already_used"
  return null
}

export function conditionOrder(participantId: string): ConditionId[] {
  return Array.from(CONDITION_PERMUTATIONS[permutationNumber(participantId) - 1])
}

export function audioOrder(participantId: string): AudioVariantId[] {
  return Array.from(AUDIO_PERMUTATIONS[permutationNumber(participantId) - 1])
}

export function blockPlan(
  participantId: string,
  variantId: VariantId,
  languageCode: LanguageCode,
  blockOrder: number,
): PlannedBlock {
  if (!Number.isInteger(blockOrder) || blockOrder < 1 || blockOrder > 4) {
    throw new RangeError("Study 6 block order must be 1 through 4")
  }
  const permutation = permutationNumber(participantId)
  const conditionId = CONDITION_PERMUTATIONS[permutation - 1][blockOrder - 1]
  const audioVariantId = AUDIO_PERMUTATIONS[permutation - 1][blockOrder - 1]
  const mediaId = `${variantSpec(variantId).mediaSurface}_${conditionId}`
  const language = languageCode.toUpperCase()
  return {
    permutationId: `perm_${String(permutation).padStart(2, "0")}`,
    blockOrder,
    conditionId,
    audioVariantId,
    audioFile: `study6_neutral_hand_audio_${audioVariantId}_${language}.mp3`,
    mediaId,
    videoFile: `${mediaId}.mp4`,
  }
}

export function completeBlockPlan(
  participantId: string,
  variantId: VariantId,
  languageCode: LanguageCode,
): PlannedBlock[] {
  return [1, 2, 3, 4].map((order) =>
    blockPlan(participantId, variantId, languageCode, order),
  )
}

export function coherenceLevel(conditionId: ConditionId): "high" | "low" {
  return conditionId === "HC_HE" || conditionId === "HC_LE" ? "high" : "low"
}

export function energyLevel(conditionId: ConditionId): "high" | "low" {
  return conditionId === "HC_HE" || conditionId === "LC_HE" ? "high" : "low"
}

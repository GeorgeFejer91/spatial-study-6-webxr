import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

import { asJsonValue, canonicalJson, sha256, type JsonValue } from './json'

export const STUDY_DATABASE_NAME = 'spatial-study-6-webxr'
export const STUDY_DATABASE_VERSION = 2

export interface ParticipantReservation {
  participantId: string
  pool: 'PH' | 'PI'
  permutation: number
  sessionId: string
  reservedAt: string
}

export interface ParticipantProgress {
  participantId: string
  completedBlocks: number
  completedDatasets: number
  hasIncompleteDataset: boolean
  completedConditions: string[]
  resumableSessionId: string | null
}

export interface SessionHeader {
  sessionId: string
  participantId: string
  createdAt: string
  updatedAt: string
  latestRevision: number
  nextEventSequence: number
  finalized: boolean
}

export interface SessionRevision {
  sessionId: string
  revision: number
  savedAt: string
  checksumSha256: string
  state: JsonValue
}

export interface StudyEvent {
  sessionId: string
  sequence: number
  recordedAt: string
  type: string
  payload: JsonValue
}

export interface ResponseRecord {
  sessionId: string
  responseId: string
  attemptOrdinal: number
  page: string
  recordedAt: string
  answer: JsonValue
}

export interface TerminalReceipt {
  sessionId: string
  ordinal: number
  outcome: 'complete' | 'incomplete' | 'abandoned'
  createdAt: string
  finalRevision: number
  stateChecksumSha256: string
}

export interface ExportRevision {
  sessionId: string
  revision: number
  createdAt: string
  checksumSha256: string
  payload: JsonValue
}

interface MetaRecord {
  key: string
  value: JsonValue
}

interface StudyDatabaseSchema extends DBSchema {
  meta: {
    key: string
    value: MetaRecord
  }
  participants: {
    key: string
    value: ParticipantReservation
    indexes: { 'by-session': string }
  }
  participantDatasets: {
    key: string
    value: ParticipantReservation
    indexes: { 'by-participant': string }
  }
  sessions: {
    key: string
    value: SessionHeader
    indexes: { 'by-updated': string }
  }
  sessionRevisions: {
    key: [string, number]
    value: SessionRevision
    indexes: { 'by-session': string }
  }
  events: {
    key: [string, number]
    value: StudyEvent
    indexes: { 'by-session': string }
  }
  responses: {
    key: [string, string]
    value: ResponseRecord
    indexes: { 'by-session': string }
  }
  receipts: {
    key: [string, number]
    value: TerminalReceipt
    indexes: { 'by-session': string }
  }
  exports: {
    key: [string, number]
    value: ExportRevision
    indexes: { 'by-session': string }
  }
}

const ACTIVE_SESSION_KEY = 'active-session-id'

function timestamp(): string {
  return new Date().toISOString()
}

function objectField(value: JsonValue, key: string): JsonValue | undefined {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return undefined
  return value[key]
}

function assertStateOwnership(
  state: JsonValue,
  sessionId: string,
  participantId?: string,
): void {
  const stateSessionId = objectField(state, 'sessionId')
  if (stateSessionId !== undefined && stateSessionId !== sessionId) {
    throw new Error('State ownership does not match the target session.')
  }
  const stateParticipantId = objectField(state, 'participantId')
  if (
    participantId !== undefined &&
    stateParticipantId !== undefined &&
    stateParticipantId !== participantId
  ) {
    throw new Error('State participant ownership does not match the reservation.')
  }
}

async function stateRevision(
  sessionId: string,
  revision: number,
  state: JsonValue,
  savedAt = timestamp(),
): Promise<SessionRevision> {
  return {
    sessionId,
    revision,
    savedAt,
    checksumSha256: await sha256(canonicalJson(state)),
    state,
  }
}

function questionnaireProgress(state: JsonValue): {
  completedBlocks: number
  completedConditions: string[]
  dataSetComplete: boolean
} {
  const blocks = objectField(state, 'blocks')
  if (!Array.isArray(blocks)) {
    return { completedBlocks: 0, completedConditions: [], dataSetComplete: false }
  }
  const completedConditions: string[] = []
  for (const block of blocks) {
    if (block === null || Array.isArray(block) || typeof block !== 'object') continue
    if (block.questionnaire === null || block.questionnaire === undefined) continue
    if (typeof block.conditionId === 'string') completedConditions.push(block.conditionId)
  }
  return {
    completedBlocks: completedConditions.length,
    completedConditions,
    dataSetComplete: blocks.length === 4 && completedConditions.length === 4,
  }
}

export class StudyDatabase {
  private readonly database: IDBPDatabase<StudyDatabaseSchema>

  private constructor(database: IDBPDatabase<StudyDatabaseSchema>) {
    this.database = database
  }

  static async open(name = STUDY_DATABASE_NAME): Promise<StudyDatabase> {
    const database = await openDB<StudyDatabaseSchema>(name, STUDY_DATABASE_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('meta', { keyPath: 'key' })

          const participants = db.createObjectStore('participants', { keyPath: 'participantId' })
          participants.createIndex('by-session', 'sessionId', { unique: true })

          const sessions = db.createObjectStore('sessions', { keyPath: 'sessionId' })
          sessions.createIndex('by-updated', 'updatedAt')

          const revisions = db.createObjectStore('sessionRevisions', {
            keyPath: ['sessionId', 'revision'],
          })
          revisions.createIndex('by-session', 'sessionId')

          const events = db.createObjectStore('events', { keyPath: ['sessionId', 'sequence'] })
          events.createIndex('by-session', 'sessionId')

          const responses = db.createObjectStore('responses', {
            keyPath: ['sessionId', 'responseId'],
          })
          responses.createIndex('by-session', 'sessionId')

          const receipts = db.createObjectStore('receipts', {
            keyPath: ['sessionId', 'ordinal'],
          })
          receipts.createIndex('by-session', 'sessionId')

          const exports = db.createObjectStore('exports', {
            keyPath: ['sessionId', 'revision'],
          })
          exports.createIndex('by-session', 'sessionId')
        }
        if (oldVersion < 2) {
          const datasets = db.createObjectStore('participantDatasets', { keyPath: 'sessionId' })
          datasets.createIndex('by-participant', 'participantId')
        }
      },
    })
    const study = new StudyDatabase(database)
    await study.migrateLegacyParticipantReservations()
    return study
  }

  private async migrateLegacyParticipantReservations(): Promise<void> {
    const transaction = this.database.transaction(
      ['participants', 'participantDatasets'],
      'readwrite',
    )
    const legacy = await transaction.objectStore('participants').getAll()
    const datasets = transaction.objectStore('participantDatasets')
    for (const reservation of legacy) {
      if (!(await datasets.get(reservation.sessionId))) await datasets.put(reservation)
    }
    await transaction.done
  }

  close(): void {
    this.database.close()
  }

  async beginSession(
    reservation: Omit<ParticipantReservation, 'reservedAt'>,
    initialState: unknown,
  ): Promise<SessionRevision> {
    const state = asJsonValue(initialState)
    assertStateOwnership(state, reservation.sessionId, reservation.participantId)
    const now = timestamp()
    const revision = await stateRevision(reservation.sessionId, 0, state, now)
    const transaction = this.database.transaction(
      ['participantDatasets', 'sessions', 'sessionRevisions', 'receipts', 'meta'],
      'readwrite',
    )

    const sessions = transaction.objectStore('sessions')
    if (await transaction.objectStore('participantDatasets').get(reservation.sessionId)) {
      throw new Error(`Participant data set ${reservation.sessionId} already exists.`)
    }
    if (await sessions.get(reservation.sessionId)) {
      throw new Error(`Session ${reservation.sessionId} already exists.`)
    }

    const active = await transaction.objectStore('meta').get(ACTIVE_SESSION_KEY)
    if (active && typeof active.value !== 'string') {
      throw new Error('The active-session pointer is damaged; allocation was stopped.')
    }
    if (typeof active?.value === 'string') {
      const activeHeader = await sessions.get(active.value)
      if (!activeHeader) {
        throw new Error('The active-session pointer references a missing session; allocation was stopped.')
      }
      if (!activeHeader.finalized) {
        throw new Error(
          `Session ${activeHeader.sessionId} is still active; allocation cannot replace it.`,
        )
      }
      const terminalReceipts = await transaction
        .objectStore('receipts')
        .index('by-session')
        .getAll(activeHeader.sessionId)
      if (terminalReceipts.length !== 1) {
        throw new Error(
          `Finalized session ${activeHeader.sessionId} has an invalid terminal receipt set; allocation was stopped.`,
        )
      }
    }

    await transaction
      .objectStore('participantDatasets')
      .add({ ...reservation, reservedAt: now })
    await sessions.add({
      sessionId: reservation.sessionId,
      participantId: reservation.participantId,
      createdAt: now,
      updatedAt: now,
      latestRevision: 0,
      nextEventSequence: 0,
      finalized: false,
    })
    await transaction.objectStore('sessionRevisions').add(revision)
    await transaction.objectStore('meta').put({ key: ACTIVE_SESSION_KEY, value: reservation.sessionId })
    await transaction.done
    return revision
  }

  async appendRevision(
    sessionId: string,
    expectedRevision: number,
    stateValue: unknown,
  ): Promise<SessionRevision> {
    const state = asJsonValue(stateValue)
    assertStateOwnership(state, sessionId)
    const revision = await stateRevision(sessionId, expectedRevision + 1, state)
    const transaction = this.database.transaction(['sessions', 'sessionRevisions'], 'readwrite')
    const sessions = transaction.objectStore('sessions')
    const header = await sessions.get(sessionId)
    if (!header) {
      throw new Error(`Unknown session ${sessionId}.`)
    }
    assertStateOwnership(state, sessionId, header.participantId)
    if (header.finalized) {
      throw new Error(`Session ${sessionId} is finalized and cannot be changed.`)
    }
    if (header.latestRevision !== expectedRevision) {
      throw new Error(
        `Stale session revision: expected ${expectedRevision}, durable revision is ${header.latestRevision}.`,
      )
    }
    await transaction.objectStore('sessionRevisions').add(revision)
    await sessions.put({
      ...header,
      latestRevision: revision.revision,
      updatedAt: revision.savedAt,
    })
    await transaction.done
    return revision
  }

  async appendRevisionWithResponse(
    sessionId: string,
    expectedRevision: number,
    stateValue: unknown,
    responseValue: Omit<ResponseRecord, 'recordedAt' | 'answer'> & { answer: unknown },
  ): Promise<SessionRevision> {
    if (responseValue.sessionId !== sessionId) {
      throw new Error('Response ownership does not match the session revision.')
    }
    const state = asJsonValue(stateValue)
    assertStateOwnership(state, sessionId)
    const revision = await stateRevision(sessionId, expectedRevision + 1, state)
    const response: ResponseRecord = {
      ...responseValue,
      recordedAt: timestamp(),
      answer: asJsonValue(responseValue.answer),
    }
    const transaction = this.database.transaction(
      ['sessions', 'sessionRevisions', 'responses'],
      'readwrite',
    )
    const sessions = transaction.objectStore('sessions')
    const responses = transaction.objectStore('responses')
    const header = await sessions.get(sessionId)
    if (!header) throw new Error(`Unknown session ${sessionId}.`)
    assertStateOwnership(state, sessionId, header.participantId)
    if (header.finalized) throw new Error(`Session ${sessionId} is finalized and cannot be changed.`)
    if (header.latestRevision !== expectedRevision) {
      throw new Error(
        `Stale session revision: expected ${expectedRevision}, durable revision is ${header.latestRevision}.`,
      )
    }
    if (await responses.get([sessionId, response.responseId])) {
      throw new Error(`Response ${response.responseId} already exists and cannot be overwritten.`)
    }
    await responses.add(response)
    await transaction.objectStore('sessionRevisions').add(revision)
    await sessions.put({
      ...header,
      latestRevision: revision.revision,
      updatedAt: revision.savedAt,
    })
    await transaction.done
    return revision
  }

  async appendEvent(sessionId: string, type: string, payloadValue: unknown): Promise<StudyEvent> {
    const payload = asJsonValue(payloadValue)
    const transaction = this.database.transaction(['sessions', 'events'], 'readwrite')
    const sessions = transaction.objectStore('sessions')
    const header = await sessions.get(sessionId)
    if (!header) {
      throw new Error(`Unknown session ${sessionId}.`)
    }
    if (header.finalized) {
      throw new Error(`Session ${sessionId} is finalized and cannot receive events.`)
    }
    const event: StudyEvent = {
      sessionId,
      sequence: header.nextEventSequence,
      recordedAt: timestamp(),
      type: type.slice(0, 80),
      payload,
    }
    await transaction.objectStore('events').add(event)
    await sessions.put({ ...header, nextEventSequence: header.nextEventSequence + 1 })
    await transaction.done
    return event
  }

  async addResponse(
    record: Omit<ResponseRecord, 'recordedAt' | 'answer'> & { answer: unknown },
  ): Promise<void> {
    const transaction = this.database.transaction(['sessions', 'responses'], 'readwrite')
    const header = await transaction.objectStore('sessions').get(record.sessionId)
    if (!header) throw new Error(`Unknown session ${record.sessionId}.`)
    if (header.finalized) {
      throw new Error(`Session ${record.sessionId} is finalized and cannot receive responses.`)
    }
    try {
      await transaction.objectStore('responses').add({
        ...record,
        recordedAt: timestamp(),
        answer: asJsonValue(record.answer),
      })
      await transaction.done
    } catch (error) {
      try {
        transaction.abort()
      } catch {
        // A failed uniqueness request may already have aborted the transaction.
      }
      await transaction.done.catch(() => undefined)
      throw error
    }
  }

  async finalizeSession(
    sessionId: string,
    outcome: TerminalReceipt['outcome'],
  ): Promise<TerminalReceipt> {
    const transaction = this.database.transaction(
      ['sessions', 'sessionRevisions', 'receipts', 'meta'],
      'readwrite',
    )
    const sessions = transaction.objectStore('sessions')
    const header = await sessions.get(sessionId)
    if (!header) {
      throw new Error(`Unknown session ${sessionId}.`)
    }
    if (header.finalized) {
      throw new Error(`Session ${sessionId} is already finalized.`)
    }
    const revisions = transaction.objectStore('sessionRevisions')
    const finalRevision = await revisions.get([sessionId, header.latestRevision])
    if (!finalRevision) {
      throw new Error(`Session ${sessionId} is missing its latest durable revision.`)
    }
    const existing = await transaction.objectStore('receipts').index('by-session').getAll(sessionId)
    if (existing.length > 0) {
      throw new Error(`Session ${sessionId} already has a terminal receipt.`)
    }
    const receipt: TerminalReceipt = {
      sessionId,
      ordinal: existing.length + 1,
      outcome,
      createdAt: timestamp(),
      finalRevision: header.latestRevision,
      stateChecksumSha256: finalRevision.checksumSha256,
    }
    await transaction.objectStore('receipts').add(receipt)
    await sessions.put({ ...header, finalized: true, updatedAt: receipt.createdAt })
    const active = await transaction.objectStore('meta').get(ACTIVE_SESSION_KEY)
    if (active?.value === sessionId) await transaction.objectStore('meta').delete(ACTIVE_SESSION_KEY)
    await transaction.done
    return receipt
  }

  async recoverActiveSession(): Promise<{
    header: SessionHeader
    revision: SessionRevision
  } | null> {
    const transaction = this.database.transaction(
      ['meta', 'sessions', 'sessionRevisions', 'participantDatasets', 'participants', 'receipts'],
      'readonly',
    )
    const active = await transaction.objectStore('meta').get(ACTIVE_SESSION_KEY)
    if (!active) {
      await transaction.done
      return null
    }
    if (typeof active.value !== 'string') {
      throw new Error('The active-session pointer is damaged.')
    }
    const header = await transaction.objectStore('sessions').get(active.value)
    if (!header) {
      throw new Error('The active-session pointer references a missing session.')
    }
    if (header.finalized) {
      throw new Error('A finalized session is incorrectly marked active.')
    }
    const [revision, reservation, receipts] = await Promise.all([
      transaction
        .objectStore('sessionRevisions')
        .get([header.sessionId, header.latestRevision]),
      transaction.objectStore('participantDatasets').get(header.sessionId),
      transaction.objectStore('receipts').index('by-session').getAll(header.sessionId),
    ])
    await transaction.done
    if (!revision) {
      throw new Error(`Session ${header.sessionId} is missing its latest durable revision.`)
    }
    const legacyReservation = reservation
      ? null
      : await this.database.get('participants', header.participantId)
    if (
      (!reservation || reservation.participantId !== header.participantId) &&
      (!legacyReservation || legacyReservation.sessionId !== header.sessionId)
    ) {
      throw new Error(`Session ${header.sessionId} has no matching participant reservation.`)
    }
    if (receipts.length > 0) {
      throw new Error(`Active session ${header.sessionId} already has a terminal receipt.`)
    }
    const checksum = await sha256(canonicalJson(revision.state))
    if (checksum !== revision.checksumSha256) {
      throw new Error(`Session ${header.sessionId} failed its recovery checksum.`)
    }
    assertStateOwnership(revision.state, header.sessionId, header.participantId)
    return { header, revision }
  }

  async participantIsReserved(participantId: string): Promise<boolean> {
    return (
      (await this.database.getAllFromIndex(
        'participantDatasets',
        'by-participant',
        participantId,
      )).length > 0
    )
  }

  async listParticipants(): Promise<ParticipantReservation[]> {
    return this.database.getAll('participantDatasets')
  }

  async listParticipantProgress(pool?: 'PH' | 'PI'): Promise<ParticipantProgress[]> {
    const [datasets, headers] = await Promise.all([
      this.database.getAll('participantDatasets'),
      this.database.getAll('sessions'),
    ])
    const headersBySession = new Map(headers.map((header) => [header.sessionId, header]))
    const revisions = await Promise.all(
      datasets.filter((dataset) => pool === undefined || dataset.pool === pool).map(async (dataset) => {
        const header = headersBySession.get(dataset.sessionId)
        if (!header) return null
        const revision = await this.database.get('sessionRevisions', [
          header.sessionId,
          header.latestRevision,
        ])
        return revision ? { dataset, header, revision } : null
      }),
    )

    const grouped = new Map<string, NonNullable<(typeof revisions)[number]>[]>()
    for (const candidate of revisions) {
      if (!candidate) continue
      const key = candidate.dataset.participantId.trim().toUpperCase()
      const values = grouped.get(key) ?? []
      values.push(candidate)
      grouped.set(key, values)
    }

    return Array.from(grouped, ([participantId, values]) => {
      const projected = values.map((value) => ({
        ...value,
        progress: questionnaireProgress(value.revision.state),
      }))
      const completedDatasets = projected.filter(
        (value) => value.progress.dataSetComplete,
      ).length
      const incomplete = projected
        .filter((value) => !value.progress.dataSetComplete && !value.header.finalized)
        .sort((left, right) => right.header.updatedAt.localeCompare(left.header.updatedAt))[0]
      const display =
        incomplete ??
        projected
          .filter((value) => value.progress.dataSetComplete)
          .sort((left, right) => right.header.updatedAt.localeCompare(left.header.updatedAt))[0]
      return {
        participantId,
        completedBlocks: display?.progress.completedBlocks ?? 0,
        completedDatasets,
        hasIncompleteDataset: incomplete !== undefined,
        completedConditions: display?.progress.completedConditions ?? [],
        resumableSessionId: incomplete?.header.sessionId ?? null,
      }
    }).sort((left, right) => left.participantId.localeCompare(right.participantId))
  }

  async recoverParticipantSession(participantId: string, pool?: 'PH' | 'PI'): Promise<{
    header: SessionHeader
    revision: SessionRevision
  } | null> {
    const normalized = participantId.trim().toUpperCase()
    const progress = (await this.listParticipantProgress(pool)).find(
      (candidate) => candidate.participantId === normalized,
    )
    if (!progress?.resumableSessionId) return null

    const transaction = this.database.transaction(['meta', 'sessions'], 'readwrite')
    const sessions = transaction.objectStore('sessions')
    const target = await sessions.get(progress.resumableSessionId)
    if (!target || target.finalized || target.participantId !== normalized) {
      throw new Error('The selected incomplete data set is no longer resumable.')
    }
    const active = await transaction.objectStore('meta').get(ACTIVE_SESSION_KEY)
    if (typeof active?.value === 'string' && active.value !== target.sessionId) {
      const activeHeader = await sessions.get(active.value)
      if (activeHeader && !activeHeader.finalized) {
        throw new Error('A different unfinished data set is already active.')
      }
    }
    await transaction
      .objectStore('meta')
      .put({ key: ACTIVE_SESSION_KEY, value: target.sessionId })
    await transaction.done
    return this.recoverActiveSession()
  }

  async createExportRevision(sessionId: string): Promise<ExportRevision> {
    const transaction = this.database.transaction(
      ['sessions', 'sessionRevisions', 'events', 'responses', 'receipts', 'exports'],
      'readonly',
    )
    const header = await transaction.objectStore('sessions').get(sessionId)
    if (!header) throw new Error(`Unknown session ${sessionId}.`)
    const [revisions, events, responses, receipts, existingExports] = await Promise.all([
      transaction.objectStore('sessionRevisions').index('by-session').getAll(sessionId),
      transaction.objectStore('events').index('by-session').getAll(sessionId),
      transaction.objectStore('responses').index('by-session').getAll(sessionId),
      transaction.objectStore('receipts').index('by-session').getAll(sessionId),
      transaction.objectStore('exports').index('by-session').getAll(sessionId),
    ])
    await transaction.done
    const payload = asJsonValue({
      format: 'spatial-study-6-webxr-export',
      formatVersion: 1,
      exportRevision: existingExports.length + 1,
      generatedAt: timestamp(),
      participantIneligible: true,
      header,
      revisions,
      events,
      responses,
      receipts,
    })
    const exported: ExportRevision = {
      sessionId,
      revision: existingExports.length + 1,
      createdAt: timestamp(),
      checksumSha256: await sha256(canonicalJson(payload)),
      payload,
    }
    await this.database.add('exports', exported)
    return exported
  }

  async listSessionHeaders(): Promise<SessionHeader[]> {
    return this.database.getAll('sessions')
  }
}

export function exportJsonBlob(revision: ExportRevision): Blob {
  return new Blob([JSON.stringify(revision, null, 2)], { type: 'application/json;charset=utf-8' })
}

function csvCell(value: unknown): string {
  const stringValue = value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value)
  return `"${stringValue.replaceAll('"', '""')}"`
}

export function exportResponsesCsv(payload: JsonValue): Blob {
  const root = payload !== null && !Array.isArray(payload) && typeof payload === 'object' ? payload : {}
  const responses = Array.isArray(root.responses) ? root.responses : []
  const rows = ['session_id,response_id,attempt_ordinal,page,recorded_at,answer']
  for (const value of responses) {
    if (value === null || Array.isArray(value) || typeof value !== 'object') continue
    rows.push(
      [
        value.sessionId,
        value.responseId,
        value.attemptOrdinal,
        value.page,
        value.recordedAt,
        value.answer,
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return new Blob([`${rows.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

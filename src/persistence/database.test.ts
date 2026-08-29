import { deleteDB, openDB } from 'idb'
import { afterEach, describe, expect, it } from 'vitest'

import { StudyDatabase } from './database'

const names: string[] = []

async function freshDatabase(): Promise<StudyDatabase> {
  const name = `study6-test-${crypto.randomUUID()}`
  names.push(name)
  return StudyDatabase.open(name)
}

afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => deleteDB(name)))
})

describe('StudyDatabase', () => {
  it('atomically reserves a participant and recovers the active revision', async () => {
    const database = await freshDatabase()
    await database.beginSession(
      { participantId: 'PH1', pool: 'PH', permutation: 1, sessionId: 'session-1' },
      { page: 'demographics' },
    )

    await expect(
      database.beginSession(
        { participantId: 'PH1', pool: 'PH', permutation: 1, sessionId: 'session-2' },
        { page: 'demographics' },
      ),
    ).rejects.toThrow('already reserved')

    const recovered = await database.recoverActiveSession()
    expect(recovered?.revision.revision).toBe(0)
    expect(recovered?.revision.state).toEqual({ page: 'demographics' })
    database.close()
  })

  it('never replaces an unfinished active-session pointer with a new allocation', async () => {
    const database = await freshDatabase()
    await database.beginSession(
      { participantId: 'PH1', pool: 'PH', permutation: 1, sessionId: 'session-1' },
      { sessionId: 'session-1', participantId: 'PH1', page: 'demographics' },
    )

    await expect(
      database.beginSession(
        { participantId: 'PH2', pool: 'PH', permutation: 2, sessionId: 'session-2' },
        { sessionId: 'session-2', participantId: 'PH2', page: 'demographics' },
      ),
    ).rejects.toThrow('still active')

    expect((await database.recoverActiveSession())?.header.sessionId).toBe('session-1')
    expect(await database.participantIsReserved('PH2')).toBe(false)
    database.close()
  })

  it('rejects cross-session and cross-participant state ownership', async () => {
    const database = await freshDatabase()
    await expect(
      database.beginSession(
        { participantId: 'PH1', pool: 'PH', permutation: 1, sessionId: 'session-1' },
        { sessionId: 'session-other', participantId: 'PH1' },
      ),
    ).rejects.toThrow('State ownership')
    await expect(
      database.beginSession(
        { participantId: 'PH1', pool: 'PH', permutation: 1, sessionId: 'session-1' },
        { sessionId: 'session-1', participantId: 'PH2' },
      ),
    ).rejects.toThrow('participant ownership')
    expect(await database.participantIsReserved('PH1')).toBe(false)
    database.close()
  })

  it('keeps immutable revisions and rejects stale writes', async () => {
    const database = await freshDatabase()
    await database.beginSession(
      { participantId: 'PI4', pool: 'PI', permutation: 4, sessionId: 'session-1' },
      { step: 0 },
    )
    const revision = await database.appendRevision('session-1', 0, { step: 1 })
    expect(revision.revision).toBe(1)
    await expect(database.appendRevision('session-1', 0, { step: 2 })).rejects.toThrow('Stale')
    await expect(
      database.appendRevision('session-1', 1, {
        sessionId: 'session-1',
        participantId: 'PI5',
        step: 2,
      }),
    ).rejects.toThrow('participant ownership')
    database.close()
  })

  it('allows a new active allocation only after the previous session is finalized', async () => {
    const database = await freshDatabase()
    await database.beginSession(
      { participantId: 'PH1', pool: 'PH', permutation: 1, sessionId: 'session-1' },
      { sessionId: 'session-1', participantId: 'PH1', page: 'complete' },
    )
    await database.finalizeSession('session-1', 'complete')
    await database.beginSession(
      { participantId: 'PH2', pool: 'PH', permutation: 2, sessionId: 'session-2' },
      { sessionId: 'session-2', participantId: 'PH2', page: 'demographics' },
    )

    expect((await database.recoverActiveSession())?.header.sessionId).toBe('session-2')
    database.close()
  })

  it('never overwrites a response key and emits immutable export revisions', async () => {
    const database = await freshDatabase()
    await database.beginSession(
      { participantId: 'PH2', pool: 'PH', permutation: 2, sessionId: 'session-1' },
      { step: 0 },
    )
    const response = {
      sessionId: 'session-1',
      responseId: 'attempt-1:sam',
      attemptOrdinal: 1,
      page: 'sam',
      answer: { valence: 5 },
    }
    await database.addResponse(response)
    await expect(database.addResponse(response)).rejects.toBeDefined()

    const first = await database.createExportRevision('session-1')
    const second = await database.createExportRevision('session-1')
    expect(first.revision).toBe(1)
    expect(second.revision).toBe(2)
    expect(first.checksumSha256).not.toBe(second.checksumSha256)
    database.close()
  })

  it('atomically appends the questionnaire response with its owning state revision', async () => {
    const database = await freshDatabase()
    await database.beginSession(
      { participantId: 'PH3', pool: 'PH', permutation: 3, sessionId: 'session-1' },
      { page: 'hand_embodiment' },
    )
    const response = {
      sessionId: 'session-1',
      responseId: 'attempt-1:questionnaire',
      attemptOrdinal: 1,
      page: 'hand_embodiment',
      answer: { complete: true },
    }
    const revision = await database.appendRevisionWithResponse(
      'session-1',
      0,
      { page: 'block_ready' },
      response,
    )
    expect(revision.revision).toBe(1)
    await expect(
      database.appendRevisionWithResponse('session-1', 1, { page: 'complete' }, response),
    ).rejects.toBeDefined()
    const recovered = await database.recoverActiveSession()
    expect(recovered?.revision.revision).toBe(1)
    database.close()
  })

  it('makes finalization terminal for events, responses, revisions, and receipts', async () => {
    const database = await freshDatabase()
    await database.beginSession(
      { participantId: 'PI5', pool: 'PI', permutation: 5, sessionId: 'session-1' },
      { sessionId: 'session-1', participantId: 'PI5', page: 'complete' },
    )
    await database.finalizeSession('session-1', 'complete')

    await expect(database.appendEvent('session-1', 'late', {})).rejects.toThrow('finalized')
    await expect(
      database.addResponse({
        sessionId: 'session-1',
        responseId: 'late-response',
        attemptOrdinal: 1,
        page: 'sam',
        answer: { value: 5 },
      }),
    ).rejects.toThrow('finalized')
    await expect(
      database.appendRevision('session-1', 0, {
        sessionId: 'session-1',
        participantId: 'PI5',
        page: 'changed',
      }),
    ).rejects.toThrow('finalized')
    await expect(database.finalizeSession('session-1', 'complete')).rejects.toThrow(
      'already finalized',
    )
    database.close()
  })

  it('detects a changed durable revision during checksum-bound recovery', async () => {
    const name = `study6-test-${crypto.randomUUID()}`
    names.push(name)
    const database = await StudyDatabase.open(name)
    await database.beginSession(
      { participantId: 'PH6', pool: 'PH', permutation: 6, sessionId: 'session-1' },
      { sessionId: 'session-1', participantId: 'PH6', step: 0 },
    )

    const raw = await openDB(name)
    const revision = await raw.get('sessionRevisions', ['session-1', 0])
    await raw.put('sessionRevisions', { ...revision, state: { step: 999 } })
    raw.close()

    await expect(database.recoverActiveSession()).rejects.toThrow('checksum')
    database.close()
  })
})

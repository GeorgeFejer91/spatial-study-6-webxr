import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

import type { AnySchema } from 'ajv'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'

import {
  parseBridgeInboundEnvelope,
  parseBridgeExperimentMarker,
  parseBridgeOutboundEnvelope,
  STUDY_BRIDGE_PROTOCOL,
  STUDY_BRIDGE_SCHEMA_REVISION,
} from './contract.ts'

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(
    await readFile(resolve(process.cwd(), 'contracts', path), 'utf8'),
  ) as unknown
}

async function sha256(path: string): Promise<string> {
  const bytes = await readFile(resolve(process.cwd(), 'contracts', path))
  return createHash('sha256').update(bytes).digest('hex').toUpperCase()
}

describe('vendored native study6.bridge.v2 fixtures', () => {
  it.each([
    ['fixtures/apk-hello.json', 'hello'],
    ['fixtures/apk-snapshot.json', 'snapshot'],
    ['fixtures/apk-polar-status.json', 'polar_status'],
  ] as const)('parses %s with the TypeScript decoder', async (path, type) => {
    const parsed = parseBridgeInboundEnvelope(await readJson(path))
    expect(parsed).toMatchObject({ protocol: STUDY_BRIDGE_PROTOCOL, type })
  })

  it.each([
    ['fixtures/webxr-hello.json', 'hello'],
    ['fixtures/begin-recording-command.json', 'command'],
    ['fixtures/record-experiment-marker-command.json', 'command'],
    ['fixtures/request-status-command.json', 'command'],
  ] as const)('parses outbound %s with the TypeScript decoder', async (path, type) => {
    const parsed = parseBridgeOutboundEnvelope(await readJson(path))
    expect(parsed).toMatchObject({ protocol: STUDY_BRIDGE_PROTOCOL, type })
  })

  it('keeps the vendored schema identity and APK hello revision pinned', async () => {
    const schema = (await readJson('study6-bridge-v2.schema.json')) as {
      properties?: { protocol?: { const?: string } }
      $defs?: {
        apkHelloPayload?: { properties?: { schemaRevision?: { const?: number } } }
        webxrHelloPayload?: { properties?: { authority?: { const?: string } } }
      }
    }
    expect(schema.properties?.protocol?.const).toBe(STUDY_BRIDGE_PROTOCOL)
    expect(schema.$defs?.apkHelloPayload?.properties?.schemaRevision?.const).toBe(
      STUDY_BRIDGE_SCHEMA_REVISION,
    )
    expect(schema.$defs?.webxrHelloPayload?.properties?.authority?.const).toBe(
      'webxr_experiment_owner',
    )
  })

  it('executes the canonical JSON Schema against positive and negative direction fixtures', async () => {
    const schema = (await readJson('study6-bridge-v2.schema.json')) as AnySchema
    const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false })
    addFormats(ajv)
    const validate = ajv.compile(schema)
    for (const path of [
      'fixtures/apk-hello.json',
      'fixtures/apk-snapshot.json',
      'fixtures/apk-polar-status.json',
      'fixtures/webxr-hello.json',
      'fixtures/begin-recording-command.json',
      'fixtures/record-experiment-marker-command.json',
      'fixtures/request-status-command.json',
    ]) {
      expect(validate(await readJson(path)), `${path}: ${ajv.errorsText(validate.errors)}`).toBe(true)
    }

    const webXrHello = await readJson('fixtures/webxr-hello.json') as Record<string, unknown>
    const apkSnapshot = await readJson('fixtures/apk-snapshot.json') as Record<string, unknown>
    const mutate = (apply: (candidate: Record<string, unknown>) => void) => {
      const candidate = structuredClone(webXrHello)
      apply(candidate)
      return candidate
    }
    const invalid = [
      mutate((candidate) => {
        const payload = candidate.payload as Record<string, unknown>
        payload.authority = 'sensor_recorder_provider'
      }),
      mutate((candidate) => {
        candidate.target = 'webxr'
      }),
      mutate((candidate) => {
        const sender = candidate.sender as Record<string, unknown>
        sender.role = 'controller'
      }),
      mutate((candidate) => {
        delete (candidate.payload as Record<string, unknown>).buildId
      }),
      mutate((candidate) => {
        candidate.type = 'snapshot'
        candidate.payload = structuredClone(apkSnapshot.payload)
      }),
    ]
    for (const candidate of invalid) expect(validate(candidate)).toBe(false)
  })

  it('is byte-identical to the pinned canonical native schema and fixtures', async () => {
    const expected = {
      'study6-bridge-v2.schema.json':
        '4B984196501F9981B7C751FB14F1BC59DB853C966D8F7EDF997DA6990D9BC695',
      'fixtures/apk-hello.json':
        'F83919FABC81FB3A45CF02564586D251AF097B93875B955207CBE60B37585889',
      'fixtures/apk-polar-status.json':
        'E6F7D7E41C457CC0B6A1602870A184091D4ED40E8C65469E2FFA8D2E2FF77F22',
      'fixtures/apk-snapshot.json':
        '38CD3B5197E4A3A9E06EF62C1F2603EAD8FCC38879F1F29B55197DF7B7A3AECC',
      'fixtures/begin-recording-command.json':
        'F574C1F6055DDA3E8A19EE4C1CB48F2287CD9240CE77C76DEE8E49852422BE77',
      'fixtures/record-experiment-marker-command.json':
        '0B11FD4A6079A66629CD2C1A70441C3D7FE304DB721F0B1B33AFF636D81804B2',
      'fixtures/request-status-command.json':
        'D1F59B83BF2F05B60204AE54D11BB7AE6CC404BB609F8D5C332DC9AF48E58860',
      'fixtures/webxr-hello.json':
        'B84C6843FD4C8DBE2589583CE1C66F28A591BE32A456AA3B91E31316AC5CDEF8',
    } as const
    for (const [path, hash] of Object.entries(expected)) {
      await expect(sha256(path), path).resolves.toBe(hash)
    }
  })

  it('accepts the native session-owned begin_recording fixture', async () => {
    const command = parseBridgeOutboundEnvelope(
      await readJson('fixtures/begin-recording-command.json'),
    )
    expect(command).toMatchObject({
      sessionId: 'session-001',
      payload: {
        action: 'begin_recording',
        sessionId: 'session-001',
        webxrRevision: 7,
        recordingRequestId: 'recording-request-001',
      },
    })
  })

  it('accepts the native privacy-minimized experiment-marker fixture', async () => {
    const command = (await readJson('fixtures/record-experiment-marker-command.json')) as {
      payload?: { action?: string; marker?: unknown }
    }
    expect(command.payload?.action).toBe('record_experiment_marker')
    expect(parseBridgeExperimentMarker(command.payload?.marker)).toMatchObject({
      eventType: 'media_started',
      webxrRevision: 8,
      conditionId: 'HC_HE',
    })
  })
})

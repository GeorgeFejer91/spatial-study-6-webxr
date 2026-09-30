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
        'FB068BF88D694AC88D6928E89D3F775F6B524FF09AF8E946F53687F45210F2C6',
      'fixtures/apk-hello.json':
        '0725C36DAD2DAF261274A35A53343C58048CB0C541822CFE08989EA87563F63D',
      'fixtures/apk-polar-status.json':
        'DC5A2AFAA6494EB42FB031328C4C162540025F358FAA45F0CC1ACDF944F6F2AD',
      'fixtures/apk-snapshot.json':
        '53666FF881014C328F22C564824A6675562572FBD8E68953B6EE0A759C0D2F00',
      'fixtures/begin-recording-command.json':
        'F574C1F6055DDA3E8A19EE4C1CB48F2287CD9240CE77C76DEE8E49852422BE77',
      'fixtures/record-experiment-marker-command.json':
        '0B11FD4A6079A66629CD2C1A70441C3D7FE304DB721F0B1B33AFF636D81804B2',
      'fixtures/record-for-command.json':
        '624A0F4A757AE72C3EAF69015271B7069750879A45CBA2C37AD4511B63BE19DC',
      'fixtures/request-status-command.json':
        'D1F59B83BF2F05B60204AE54D11BB7AE6CC404BB609F8D5C332DC9AF48E58860',
      'fixtures/webxr-hello.json':
        '57C339BD75E3F4A66FE985004255AEB103C9D7A4BDCE78D74CFDF8C80333A4A5',
      'fixtures/verify-recording-artifact-command.json':
        'C0EC3BC047E7F924E90BEA52A7019B102712FACEF50DCB289414EE19F6EC7123',
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

  it('accepts the native timed recording and artifact verification fixtures', async () => {
    const timed = parseBridgeOutboundEnvelope(await readJson('fixtures/record-for-command.json'))
    expect(timed.payload).toMatchObject({
      action: 'record_for',
      jobId: 'ecg-attempt-001',
      artifactStem: 'ecg_PH1_HC_HE_b1_attempt001',
      durationMs: 10_000,
    })
    const verify = parseBridgeOutboundEnvelope(
      await readJson('fixtures/verify-recording-artifact-command.json'),
    )
    expect(verify.payload).toMatchObject({
      action: 'verify_recording_artifact',
      jobId: 'ecg-attempt-001',
      artifactStem: 'ecg_PH1_HC_HE_b1_attempt001',
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

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { AnySchema } from 'ajv'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'

import {
  parseBridgeInboundEnvelope,
  parseBridgeExperimentMarker,
  STUDY_BRIDGE_PROTOCOL,
  STUDY_BRIDGE_SCHEMA_REVISION,
} from './contract.ts'

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(
    await readFile(resolve(process.cwd(), 'contracts', path), 'utf8'),
  ) as unknown
}

describe('vendored native study6.bridge.v1 fixtures', () => {
  it.each([
    ['fixtures/apk-hello.json', 'hello'],
    ['fixtures/apk-snapshot.json', 'snapshot'],
    ['fixtures/apk-polar-status.json', 'polar_status'],
  ] as const)('parses %s with the TypeScript decoder', async (path, type) => {
    const parsed = parseBridgeInboundEnvelope(await readJson(path))
    expect(parsed).toMatchObject({ protocol: STUDY_BRIDGE_PROTOCOL, type })
  })

  it('keeps the vendored schema identity and APK hello revision pinned', async () => {
    const schema = (await readJson('study6-bridge-v1.schema.json')) as {
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
    const schema = (await readJson('study6-bridge-v1.schema.json')) as AnySchema
    const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false })
    addFormats(ajv)
    const validate = ajv.compile(schema)
    for (const path of [
      'fixtures/apk-hello.json',
      'fixtures/apk-snapshot.json',
      'fixtures/apk-polar-status.json',
      'fixtures/webxr-hello.json',
      'fixtures/record-experiment-marker-command.json',
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

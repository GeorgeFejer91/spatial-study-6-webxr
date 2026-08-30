import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  BRSP_CONTROL_MAX_BYTES,
  BRSP_PROTOCOL,
  BRSP_VERSION,
  canonicalStringify,
  createHelloEnvelope,
  createProofEnvelope,
  decodeEnvelope,
  encodeEnvelope,
  isNewerSequence,
  negotiateSession,
  verifyProofEnvelope,
} from './vendor/browser-remote-sync-protocol/brsp.js'

const pinnedCoreSha256 = '59e3c02ed15042e70b1b11e77bc2c6bd835a3839ee04b1b617dd529137261ef9'

describe('vendored BRSP/1 core', () => {
  it('matches the pinned upstream source after line-ending normalization', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/companion/vendor/browser-remote-sync-protocol/brsp.js'),
      'utf8',
    ).replaceAll('\r\n', '\n')

    expect(createHash('sha256').update(source).digest('hex')).toBe(pinnedCoreSha256)
  })

  it('keeps canonical bounded envelopes and wrap-safe sequence ordering', () => {
    expect(BRSP_PROTOCOL).toBe('brsp')
    expect(BRSP_VERSION).toBe(1)
    expect(canonicalStringify({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}')

    const hello = createHelloEnvelope({
      role: 'target',
      sessionId: 'session_12345678',
      senderId: 'target_12345678',
      senderEpoch: 7,
      capabilities: ['state', 'ack'],
      grantedScopes: ['study.status.read'],
    })

    expect(decodeEnvelope(encodeEnvelope(hello))).toEqual(hello)
    expect(decodeEnvelope('x'.repeat(BRSP_CONTROL_MAX_BYTES + 1))).toBeUndefined()
    expect(isNewerSequence(0, 0xffff_ffff)).toBe(true)
    expect(isNewerSequence(10, 10)).toBe(false)
  })

  it('binds mutual proof to both roles and negotiates only intersecting scopes', async () => {
    const targetHello = createHelloEnvelope({
      role: 'target',
      sessionId: 'session_study_6',
      senderId: 'target_study_6',
      senderEpoch: 11,
      capabilities: ['command-ack', 'latest-state'],
      grantedScopes: ['study.status.read'],
    })
    const controllerHello = createHelloEnvelope({
      role: 'controller',
      sessionId: 'session_study_6',
      senderId: 'controller_study_6',
      senderEpoch: 22,
      capabilities: ['command-ack', 'latest-intent'],
      requestedScopes: ['study.status.read', 'study.session.abort'],
    })
    const secret = 'generated-pairing-secret-with-enough-entropy'
    const proof = await createProofEnvelope({
      localHello: targetHello,
      remoteHello: controllerHello,
      secret,
      sequence: 1,
    })

    await expect(verifyProofEnvelope({
      proof,
      localHello: controllerHello,
      remoteHello: targetHello,
      secret,
    })).resolves.toBe(true)
    await expect(verifyProofEnvelope({
      proof,
      localHello: controllerHello,
      remoteHello: targetHello,
      secret: 'different-generated-secret-with-enough-entropy',
    })).resolves.toBe(false)
    expect(negotiateSession(targetHello, controllerHello)).toEqual({
      capabilities: ['command-ack'],
      acceptedScopes: ['study.status.read'],
    })
  })
})

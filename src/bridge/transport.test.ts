import { describe, expect, it } from 'vitest'

import { resolveStudyBridgeLaunchConfig } from './transport.ts'

function location(overrides: Partial<Location> = {}): Pick<
  Location,
  'protocol' | 'hostname' | 'host' | 'search' | 'hash'
> {
  return {
    protocol: 'https:',
    hostname: 'georgefejer91.github.io',
    host: 'georgefejer91.github.io',
    search: '',
    hash: '',
    ...overrides,
  }
}

describe('Sensor Bridge launch descriptor', () => {
  it('consumes the APK fragment names and puts the secret only in the WebSocket handshake', () => {
    const token = 'A'.repeat(43)
    const launch = resolveStudyBridgeLaunchConfig(
      location({
        hash: `#bridgeWs=${encodeURIComponent('ws://127.0.0.1:8766/bridge')}&bridgeToken=${token}`,
      }),
    )
    expect(launch).toEqual({
      url: `ws://127.0.0.1:8766/bridge?token=${token}`,
      token,
      fromFragment: true,
    })
  })

  it('rejects a partial descriptor, malformed token, and cleartext non-loopback endpoint', () => {
    expect(() =>
      resolveStudyBridgeLaunchConfig(location({ hash: '#bridgeWs=ws%3A%2F%2F127.0.0.1%2Fbridge' })),
    ).toThrow(/requires both/u)
    expect(() =>
      resolveStudyBridgeLaunchConfig(
        location({ hash: '#bridgeWs=ws%3A%2F%2F127.0.0.1%2Fbridge&bridgeToken=short' }),
      ),
    ).toThrow(/256-bit base64url/u)
    const token = 'A'.repeat(43)
    expect(() =>
      resolveStudyBridgeLaunchConfig(
        location({
          hash: `#bridgeWs=ws%3A%2F%2F192.168.1.4%3A8766%2Fbridge&bridgeToken=${token}`,
        }),
      ),
    ).toThrow(/only on loopback/u)
  })

  it('defaults GitHub Pages to the fixed local APK endpoint', () => {
    expect(resolveStudyBridgeLaunchConfig(location())).toMatchObject({
      url: 'ws://127.0.0.1:8766/bridge',
      token: null,
      fromFragment: false,
    })
  })
})

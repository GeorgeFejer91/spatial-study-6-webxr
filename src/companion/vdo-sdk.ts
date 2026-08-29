export interface VdoTrackDetail {
  track?: MediaStreamTrack
  streams?: MediaStream[]
  uuid?: string
  streamID?: string
}

export interface VdoDataDetail {
  data?: unknown
  uuid?: string
  streamID?: string
}

export interface VdoChannelDetail {
  uuid?: string
  UUID?: string
  streamID?: string
  type?: string
}

export interface VdoNinjaSdk extends EventTarget {
  connect(options?: Record<string, unknown>): Promise<void>
  joinRoom(options: { room: string; password?: string | false }): Promise<void>
  publish(
    stream: MediaStream,
    options: { streamID: string; label: string; room?: string; password?: string | false },
  ): Promise<string>
  view(
    streamId: string,
    options: { audio: boolean; video: boolean; label?: string },
  ): Promise<RTCPeerConnection | null>
  sendData(
    data: unknown,
    target?: { uuid?: string; streamID?: string; preference?: 'publisher' | 'viewer' | 'any' | 'all' },
  ): boolean
  disconnect(): Promise<void>
}

interface VdoNinjaConstructor {
  new (options?: Record<string, unknown>): VdoNinjaSdk
  readonly VERSION?: string
}

declare global {
  interface Window {
    VDONinjaSDK?: VdoNinjaConstructor
  }
}

let loading: Promise<VdoNinjaConstructor> | undefined

function validatedConstructor(value: VdoNinjaConstructor | undefined): VdoNinjaConstructor {
  if (!value || value.VERSION !== '1.5.5') {
    throw new Error('The bundled VDO.Ninja SDK is missing or has an unexpected version.')
  }
  return value
}

export async function loadVdoNinjaSdk(): Promise<VdoNinjaConstructor> {
  if (window.VDONinjaSDK) return validatedConstructor(window.VDONinjaSDK)
  if (loading) return loading
  const created = new Promise<VdoNinjaConstructor>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `${import.meta.env.BASE_URL}vendor/vdoninja/1.5.5/vdoninja-sdk.js`
    script.async = true
    script.integrity = 'sha256-gJfVQg1+0kJmI9f/CPar1F8D+J5lQKbMS4a83AV9hB4='
    script.crossOrigin = 'anonymous'
    script.dataset.study6VdoSdk = '1.5.5'
    script.addEventListener('load', () => {
      try {
        resolve(validatedConstructor(window.VDONinjaSDK))
      } catch (error) {
        script.remove()
        reject(error)
      }
    })
    script.addEventListener('error', () => {
      script.remove()
      reject(new Error('The bundled VDO.Ninja SDK failed to load.'))
    })
    document.head.append(script)
  }).catch((error: unknown) => {
    loading = undefined
    throw error
  })
  loading = created
  return created
}

export function eventDetail<T>(event: Event): T {
  return (event as Event & { detail?: T }).detail ?? ({} as T)
}

export function createVdoSdk(
  Constructor: VdoNinjaConstructor,
  forceTurn: boolean,
  pairingKey: string,
): VdoNinjaSdk {
  return new Constructor({
    // The SDK hashes room/stream identifiers and encrypts SDP/ICE signaling when
    // a password is present. Application messages remain independently protected
    // by the protocol module's authenticated AES-GCM envelope.
    password: `s6-vdo-v1-${pairingKey}`,
    salt: 'spatial-study-6-webxr-v1',
    forceTURN: forceTurn,
    autoPingViewer: true,
  })
}

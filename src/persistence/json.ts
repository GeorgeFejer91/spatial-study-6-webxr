export type JsonPrimitive = boolean | number | string | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)]),
    )
  }
  return value
}

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(sortJson(value))
}

export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function asJsonValue(value: unknown): JsonValue {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new TypeError('Value is not JSON serializable')
  return JSON.parse(encoded) as JsonValue
}

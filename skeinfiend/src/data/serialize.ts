/**
 * Projects as plain JSON, for a backup file or a server: their grids'
 * cells are bytes (`Uint8Array`), written as base64 and read back as bytes.
 * Everything else is already plain data.
 */
const BYTES = '$bytes'

export function toJSON(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (v instanceof Uint8Array ? { [BYTES]: toBase64(v) } : v))
}

export function fromJSON<T>(text: string): T {
  return JSON.parse(text, (_key, v: unknown) =>
    v && typeof v === 'object' && BYTES in v && typeof (v as Record<string, unknown>)[BYTES] === 'string'
      ? fromBase64((v as Record<string, string>)[BYTES]!)
      : v,
  ) as T
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  // In chunks: a large chart's cells are too many arguments for one call.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

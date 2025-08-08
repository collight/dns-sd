// MARK: nameEquals
const capitalLetterRegex = /[A-Z]/g

/**
 * Compares two strings for equality in a case-insensitive manner,
 * but only ASCII uppercase letters (`A-Z`) are converted to lowercase before comparison.
 */
export function nameEquals(a: string, b: string): boolean {
  const aFormatted = a.replace(capitalLetterRegex, s => s.toLowerCase())
  const bFormatted = b.replace(capitalLetterRegex, s => s.toLowerCase())
  return aFormatted === bFormatted
}

// MARK: TXT
/**
 * Encodes a record of key-value string pairs into an array of Buffer objects,
 * where each buffer contains a string in the format `"key=value"`.
 *
 * @param data - An object whose string keys and values will be encoded.
 *               Defaults to an empty object.
 * @returns An array of Buffer instances, each representing one `"key=value"` pair.
 *
 * @example
 * ```ts
 * encodeTXT({ foo: "bar", baz: "qux" })
 * // [Buffer.from("foo=bar"), Buffer.from("baz=qux")]
 * ```
 */
export function encodeTXT(data: Record<string, string | number | boolean | Buffer> = {}): Buffer[] {
  const buffers: Buffer[] = []
  for (const [key, value] of Object.entries(data)) {
    buffers.push(Buffer.from(`${key}=${value}`))
  }
  return buffers
}

/**
 * Decodes an input buffer or array of buffers (or strings) containing
 * `"key=value"` pairs into a single object mapping keys to values.
 *
 * Each input item is expected to be a string or Buffer representing one key-value pair.
 * Items that do not match the `"key=value"` pattern are ignored.
 *
 * @param buffer - A string, Buffer, or an array of these, each containing `"key=value"` format data.
 * @returns An object where each key is mapped to its corresponding decoded value.
 *
 * @example
 * ```ts
 * decodeTXT([Buffer.from("foo=bar"), "baz=qux"])
 * // { foo: "bar", baz: "qux" }
 *
 * decodeTXT(Buffer.from("hello=world"))
 * // { hello: "world" }
 *
 * decodeTXT(["invalid", "key=value"])
 * //  { key: "value" }  // "invalid" ignored
 * ```
 */
export function decodeTXT(buffer: string | Buffer | (string | Buffer)[], binary: false): Record<string, string>
export function decodeTXT(buffer: string | Buffer | (string | Buffer)[], binary: true): Record<string, Buffer>
export function decodeTXT(
  buffer: string | Buffer | (string | Buffer)[],
  binary: boolean,
): Record<string, string | Buffer> {
  function decode(buffer: string | Buffer, binary: boolean): Record<string, string | Buffer> {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)

    const asciiStr = buf.toString('ascii')
    const eqIndex = asciiStr.indexOf('=')
    if (eqIndex === -1) {
      if (binary) {
        return { [asciiStr]: Buffer.alloc(0) }
      } else {
        return { [asciiStr]: '' }
      }
    }

    const key = asciiStr.slice(0, eqIndex)
    const valueBuf = buf.subarray(eqIndex + 1)
    const value = binary ? valueBuf : valueBuf.toString('utf8')

    return { [key]: value }
  }

  const buffers = [buffer].flat()
  const result: Record<string, string | Buffer> = {}
  for (const buffer of buffers) {
    const entry = decode(buffer, binary)
    const entries = Object.entries(entry)
    if (entries.length === 1) {
      const [key, value] = entries[0]!
      result[key] = value
    }
  }

  return result
}

import { createHash, randomBytes } from 'node:crypto'

export const ID_PREFIX = {
  session: 'ses',
  run: 'run',
  message: 'msg',
  item: 'itm',
  thread: 'thr',
  task: 'task',
  interaction: 'int',
  file: 'file',
  change: 'chg',
  request: 'req',
} as const

export type IdPrefix = (typeof ID_PREFIX)[keyof typeof ID_PREFIX]

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ID_LENGTH = 26

/** Platform-issued IDs sort by creation time, like a ULID. */
export function newId(prefix: IdPrefix, now = Date.now()): string {
  const time = Buffer.alloc(6)
  time.writeUIntBE(now, 0, 6)
  return `${prefix}_${base32(Buffer.concat([time, randomBytes(11)])).slice(0, ID_LENGTH)}`
}

/**
 * IDs for objects that originate in a native transcript. The same native key
 * must yield the same ID in live events and in history reads.
 */
export function derivedId(prefix: IdPrefix, key: string): string {
  const digest = createHash('sha256').update(`${prefix}:${key}`).digest()
  return `${prefix}_${base32(digest).slice(0, ID_LENGTH)}`
}

export function hasPrefix(id: string, prefix: IdPrefix): boolean {
  return id.startsWith(`${prefix}_`) && id.length > prefix.length + 1
}

function base32(bytes: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += CROCKFORD[(value >>> (bits - 5)) & 31] ?? ''
      bits -= 5
    }
    value &= (1 << bits) - 1
  }
  if (bits > 0) output += CROCKFORD[(value << (5 - bits)) & 31] ?? ''
  return output
}

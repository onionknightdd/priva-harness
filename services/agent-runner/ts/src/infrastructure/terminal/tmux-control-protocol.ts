/**
 * Line-level codec for tmux control mode (`tmux -C`).
 *
 * In control mode tmux speaks a text protocol on stdout: command replies are
 * bracketed by `%begin`/`%end` (or `%error`) lines carrying a sequence
 * number, and pane output arrives as `%output %<pane> <escaped bytes>` where
 * control bytes are written as backslash octal escapes. Other bytes are raw,
 * and a UTF-8 character may span multiple %output messages.
 * Everything here is pure so the framing can be tested without a tmux.
 */

/**
 * `fromClient` mirrors tmux's reply flag: replies to commands this client
 * wrote carry 1; the unsolicited block tmux emits right after attaching
 * carries 0 and must not be matched against a pending command.
 */
export interface ControlReply {
  readonly seq: number
  readonly fromClient: boolean
}

export type ControlMessage =
  | ({ readonly kind: 'begin' | 'end' | 'error' } & ControlReply)
  | { readonly kind: 'output'; readonly paneId: string; readonly data: Uint8Array }
  | { readonly kind: 'exit'; readonly reason: string }
  | { readonly kind: 'notification'; readonly name: string; readonly body: string }
  | { readonly kind: 'body'; readonly text: string }

const REPLY_LINE = /^%(begin|end|error) (\d+) (\d+) (\d+)$/u

/**
 * Command output is not escaped by tmux, so inside a reply block a body line
 * may itself start with `%output` or any other protocol-looking text. tmux
 * does not interleave notifications inside replies; only the matching reply
 * terminator is a protocol line there.
 */
export function parseControlLine(bytes: Buffer, activeReply?: ControlReply): ControlMessage {
  const line = bytes.toString('utf8')
  const marker = REPLY_LINE.exec(line)
  const reply = marker === null ? undefined : {
    kind: marker[1] as 'begin' | 'end' | 'error',
    seq: Number(marker[3]),
    fromClient: marker[4] === '1',
  }
  if (activeReply !== undefined) {
    if (reply !== undefined && reply.kind !== 'begin'
      && reply.seq === activeReply.seq && reply.fromClient === activeReply.fromClient) return reply
    return { kind: 'body', text: line }
  }
  if (reply !== undefined) return reply
  if (line.startsWith('%output ')) {
    const paneEnd = bytes.indexOf(0x20, 8)
    if (paneEnd === -1) return { kind: 'output', paneId: line.slice(8), data: new Uint8Array() }
    return {
      kind: 'output',
      paneId: line.slice(8, paneEnd),
      data: decodeOctalEscapes(bytes.subarray(paneEnd + 1)),
    }
  }
  if (line === '%exit' || line.startsWith('%exit ')) {
    return { kind: 'exit', reason: line.slice(5).trim() }
  }
  if (line.startsWith('%')) {
    const nameEnd = line.indexOf(' ')
    return nameEnd === -1
      ? { kind: 'notification', name: line.slice(1), body: '' }
      : { kind: 'notification', name: line.slice(1, nameEnd), body: line.slice(nameEnd + 1) }
  }
  return { kind: 'body', text: line }
}

/**
 * Decode tmux's `\ooo` octal escapes (and `\\`) back into raw bytes.
 *
 * Never decode the payload as text: even one raw leading/continuation byte
 * must survive so the terminal can compose UTF-8 across output messages.
 */
export function decodeOctalEscapes(input: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(input.length)
  let length = 0
  for (let index = 0; index < input.length; index += 1) {
    const code = input[index] ?? 0
    const next = input[index + 1] ?? 0
    const second = input[index + 2] ?? 0
    const third = input[index + 3] ?? 0
    if (code === 0x5c && next === 0x5c) {
      bytes[length++] = 0x5c
      index += 1
      continue
    }
    if (code === 0x5c && next >= 0x30 && next <= 0x37
      && second >= 0x30 && second <= 0x37 && third >= 0x30 && third <= 0x37) {
      bytes[length++] = (next - 0x30) * 64 + (second - 0x30) * 8 + third - 0x30
      index += 3
      continue
    }
    bytes[length++] = code
  }
  return bytes.subarray(0, length)
}

/** Hex tokens for `send-keys -H`, one per byte. */
export function hexKeyTokens(bytes: Uint8Array): string[] {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
}

/** Quote one argument for a tmux command line (single quotes, tmux syntax). */
export function quoteTmuxArgument(argument: string): string {
  if (argument === '') return "''"
  if (/^[A-Za-z0-9_@%.:/=+,-]+$/u.test(argument)) return argument
  return `'${argument.replaceAll("'", "'\\''")}'`
}

export function formatTmuxCommand(parts: readonly string[]): string {
  return parts.map(quoteTmuxArgument).join(' ')
}

/**
 * Split a byte stream into complete lines, keeping a trailing partial line
 * for the next chunk. Control mode never emits a raw newline inside an
 * `%output` payload, so line framing is safe.
 */
export class LineSplitter {
  private pending: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): Buffer[] {
    const combined = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk])
    const lines: Buffer[] = []
    let start = 0
    let end: number
    while ((end = combined.indexOf(0x0a, start)) !== -1) {
      lines.push(combined.subarray(start, end))
      start = end + 1
    }
    this.pending = combined.subarray(start)
    return lines
  }

  flush(): Buffer[] {
    const rest = this.pending
    this.pending = Buffer.alloc(0)
    return rest.length === 0 ? [] : [rest]
  }
}

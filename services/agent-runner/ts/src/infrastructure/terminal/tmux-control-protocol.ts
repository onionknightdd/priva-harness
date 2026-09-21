/**
 * Line-level codec for tmux control mode (`tmux -C`).
 *
 * In control mode tmux speaks a text protocol on stdout: command replies are
 * bracketed by `%begin`/`%end` (or `%error`) lines carrying a sequence
 * number, and pane output arrives as `%output %<pane> <escaped bytes>` where
 * every byte outside printable ASCII is written as a backslash octal escape.
 * Everything here is pure so the framing can be tested without a tmux.
 */

/**
 * `fromClient` mirrors tmux's reply flag: replies to commands this client
 * wrote carry 1; the unsolicited block tmux emits right after attaching
 * carries 0 and must not be matched against a pending command.
 */
export type ControlMessage =
  | { readonly kind: 'begin'; readonly seq: number; readonly fromClient: boolean }
  | { readonly kind: 'end'; readonly seq: number; readonly fromClient: boolean }
  | { readonly kind: 'error'; readonly seq: number; readonly fromClient: boolean }
  | { readonly kind: 'output'; readonly paneId: string; readonly data: Uint8Array }
  | { readonly kind: 'exit'; readonly reason: string }
  | { readonly kind: 'notification'; readonly name: string; readonly body: string }
  | { readonly kind: 'body'; readonly text: string }

const REPLY_LINE = /^%(begin|end|error) (\d+) (\d+) (\d+)$/u
const NOTIFICATION_LINE = /^%[a-z][a-z-]*(?: |$)/u

/**
 * Command output is not escaped by tmux, so inside a reply block a body line
 * may itself start with `%` (a pane id such as `%0`). While `inReply` is set
 * only real protocol lines — `%word ...` — are treated as such.
 */
export function parseControlLine(line: string, inReply = false): ControlMessage {
  const reply = REPLY_LINE.exec(line)
  if (reply !== null) {
    const kind = reply[1] as 'begin' | 'end' | 'error'
    return { kind, seq: Number(reply[3]), fromClient: reply[4] === '1' }
  }
  if (inReply && !NOTIFICATION_LINE.test(line)) return { kind: 'body', text: line }
  if (line.startsWith('%output ')) {
    const paneEnd = line.indexOf(' ', 8)
    if (paneEnd === -1) return { kind: 'output', paneId: line.slice(8), data: new Uint8Array() }
    return {
      kind: 'output',
      paneId: line.slice(8, paneEnd),
      data: decodeOctalEscapes(line.slice(paneEnd + 1)),
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

/** Decode tmux's `\ooo` octal escapes (and `\\`) back into raw bytes. */
export function decodeOctalEscapes(text: string): Uint8Array {
  const bytes: number[] = []
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code !== 0x5c) {
      bytes.push(code)
      continue
    }
    const next = text.charCodeAt(index + 1)
    if (next === 0x5c) {
      bytes.push(0x5c)
      index += 1
      continue
    }
    const digits = text.slice(index + 1, index + 4)
    if (/^[0-7]{3}$/u.test(digits)) {
      bytes.push(Number.parseInt(digits, 8))
      index += 3
      continue
    }
    bytes.push(code)
  }
  return Uint8Array.from(bytes)
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
  private pending = ''

  push(chunk: string): string[] {
    const combined = this.pending + chunk
    const lines = combined.split('\n')
    this.pending = lines.pop() ?? ''
    return lines
  }

  flush(): string[] {
    const rest = this.pending
    this.pending = ''
    return rest === '' ? [] : [rest]
  }
}

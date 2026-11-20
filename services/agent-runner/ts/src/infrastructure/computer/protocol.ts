import { lstat, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { Duplex } from 'node:stream'
import { z } from 'zod'

// A registered computer runs the same desktop worker as a local session. Its
// MCP stream travels to the Runner over the device's SSH channel:
//
//   device channel     one line per message. A line starting with "=" is one
//                      worker MCP message; any other line is a JSON control message.
//   local worker       after a successful `open` reply the client socket carries
//   stream             raw worker MCP lines both ways. A final line starting
//                      with "!" tells the client why the worker ended.
export const WORKER_LINE = '='
export const EXIT_LINE = '!'
/** Control messages are small; worker lines carry screenshots. */
export const CONTROL_LINE_BYTES = 32 * 1024
export const WORKER_LINE_BYTES = 32 * 1024 * 1024

export const deviceIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u)
const id = z.string().min(1).max(80)
const name = z.string().min(1).max(96).regex(/^[^\p{Cc}\p{Cf}]+$/u)
const reason = z.string().min(1).max(2048)
export const deviceInfoSchema = z.strictObject({ deviceId: deviceIdSchema, name, platform: z.literal('darwin') })
export type DeviceInfo = z.infer<typeof deviceInfoSchema>
export const helloSchema = z.strictObject({ type: z.literal('hello'), version: z.literal(2), name, platform: z.literal('darwin') })

/** `status` reads availability; `open` starts the device's worker for this connection. */
export const deviceMethodSchema = z.enum(['status', 'open'])
export type DeviceMethod = z.infer<typeof deviceMethodSchema>
export const clientRequestSchema = z.union([
  z.strictObject({ id, method: z.literal('list') }),
  z.strictObject({ id, deviceId: deviceIdSchema, method: deviceMethodSchema }),
])
const success = z.strictObject({ id, ok: z.literal(true), value: z.json() })
const failure = z.strictObject({ id, ok: z.literal(false), error: reason })
export const clientReplySchema = z.discriminatedUnion('ok', [success, failure])
/** What a device sends beside its worker's output. */
export const deviceMessageSchema = z.union([
  success.extend({ type: z.literal('result') }),
  failure.extend({ type: z.literal('result') }),
  z.strictObject({ type: z.literal('worker-exit'), reason }),
])

export function computerDirectory(): string {
  if (!process.getuid) throw new Error('Computer control needs a POSIX user account')
  return process.env['PRIVA_COMPUTER_DIR'] ?? join(tmpdir(), `priva-computer-${process.getuid()}`)
}

export async function controlPath(directory: string, create = false): Promise<string> {
  if (!isAbsolute(directory)) throw new Error('PRIVA_COMPUTER_DIR must be an absolute path')
  if (create) await mkdir(directory, { mode: 0o700, recursive: true })
  const dir = await lstat(directory)
  if (!dir.isDirectory() || dir.uid !== process.getuid?.() || (dir.mode & 0o777) !== 0o700) {
    throw new Error('Computer control directory must be a private 0700 directory owned by this user')
  }
  const path = join(directory, 'clients.sock')
  if (Buffer.byteLength(path) > 103) throw new Error('Computer control socket path exceeds 103 bytes')
  if (!create) {
    const socket = await lstat(path)
    if (!socket.isSocket() || socket.uid !== dir.uid || (socket.mode & 0o777) !== 0o600) {
      throw new Error('Computer control socket must be a private socket owned by this user')
    }
  }
  return path
}

export function frame(value: unknown): string {
  return JSON.stringify(value) + '\n'
}

/** Bound a partial line before decoding; a peer may split UTF-8 anywhere. */
export function readLines(stream: Duplex, onLine: (line: string) => void, fail: () => void, maxBytes: number): void {
  let parts: Buffer[] = []
  let size = 0
  const decoder = new TextDecoder('utf-8', { fatal: true })
  function onData(chunk: Buffer): void {
    try {
      let offset = 0
      while (offset < chunk.length) {
        const newline = chunk.indexOf(10, offset)
        const end = newline === -1 ? chunk.length : newline
        size += end - offset
        if (size > maxBytes) throw new Error(`Computer message exceeds ${maxBytes} bytes`)
        parts.push(chunk.subarray(offset, end))
        if (newline === -1) break
        const line = decoder.decode(Buffer.concat(parts, size))
        parts = []
        size = 0
        onLine(line)
        offset = newline + 1
      }
    } catch {
      stream.off('data', onData)
      fail()
    }
  }
  stream.on('data', onData)
}

import { lstat, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { Duplex } from 'node:stream'
import { z } from 'zod'

export const methodSchema = z.enum(['status', 'calculator-check'])
export type ComputerMethod = z.infer<typeof methodSchema>
export const deviceIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u)
const id = z.string().min(1).max(80)
const name = z.string().min(1).max(96).regex(/^[^\p{Cc}\p{Cf}]+$/u)
export const deviceInfoSchema = z.strictObject({ deviceId: deviceIdSchema, name, platform: z.literal('darwin') })
export type DeviceInfo = z.infer<typeof deviceInfoSchema>
export const helloSchema = z.strictObject({ type: z.literal('hello'), version: z.literal(1), name, platform: z.literal('darwin') })
export const clientRequestSchema = z.union([
  z.strictObject({ id, method: z.literal('list') }),
  z.strictObject({ id, deviceId: deviceIdSchema, method: methodSchema }),
])
const success = z.strictObject({ id, ok: z.literal(true), value: z.json() })
const failure = z.strictObject({ id, ok: z.literal(false), error: z.string().min(1).max(2048) })
export const clientReplySchema = z.discriminatedUnion('ok', [success, failure])
export const deviceReplySchema = z.discriminatedUnion('ok', [
  success.extend({ type: z.literal('result') }), failure.extend({ type: z.literal('result') }),
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

const MAX_FRAME_BYTES = 32 * 1024

/** Bound partial frames before decoding; a peer may split UTF-8 anywhere. */
export function readFrames(stream: Duplex, onFrame: (value: unknown) => void, fail: () => void): void {
  let buffer = Buffer.alloc(0)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  function onData(chunk: Buffer): void {
    try {
      let offset = 0
      while (offset < chunk.length) {
        const newline = chunk.indexOf(10, offset)
        const end = newline === -1 ? chunk.length : newline
        const size = buffer.length + end - offset
        if (size > MAX_FRAME_BYTES) throw new Error('Computer message exceeds 32 KiB')
        const bytes = chunk.subarray(offset, end)
        buffer = Buffer.concat([buffer, bytes], size)
        if (newline === -1) break
        const value: unknown = JSON.parse(decoder.decode(buffer))
        buffer = Buffer.alloc(0)
        onFrame(value)
        offset = newline + 1
      }
    } catch {
      stream.off('data', onData)
      fail()
    }
  }
  stream.on('data', onData)
}

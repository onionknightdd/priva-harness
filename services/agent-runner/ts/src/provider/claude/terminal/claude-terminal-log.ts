import { open, stat } from 'node:fs/promises'

import { hasErrorCode } from '../../../core/util/errors.js'

const READ_WINDOW_BYTES = 4 * 1024 * 1024
// One hook record can embed a whole file (an Edit result carries the original).
const MAX_RECORD_BYTES = 64 * 1024 * 1024

export interface TerminalLogBatch {
  /** Where the next read starts: just past the last complete line consumed. */
  readonly offset: number
  readonly records: readonly unknown[]
}

/**
 * Read the complete JSON lines appended to a terminal log since `offset`.
 * A partial trailing line stays behind the cursor until its newline arrives.
 * A complete line too large to hold is skipped whole, so it cannot stall every
 * later record; a line that is not JSON is an error the caller reports.
 * Returns undefined while the log does not exist yet.
 */
export async function readTerminalLog(path: string, offset: number): Promise<TerminalLogBatch | undefined> {
  let file
  try {
    // Open terminals are polled many times a second and are mostly quiet, so
    // a log with nothing new is answered from its size alone.
    if ((await stat(path)).size === offset) return { offset, records: [] }
    file = await open(path, 'r')
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return undefined
    throw error
  }
  try {
    const size = (await file.stat()).size
    // A shorter file was truncated or replaced; start over.
    const start = offset > size ? 0 : offset
    const available = size - start
    for (const window of [READ_WINDOW_BYTES, MAX_RECORD_BYTES]) {
      const bytes = Buffer.alloc(Math.min(available, window))
      const { bytesRead } = await file.read(bytes, 0, bytes.length, start)
      const end = bytes.subarray(0, bytesRead).lastIndexOf(10) + 1
      if (end > 0) return { offset: start + end, records: parseLines(bytes.subarray(0, end)) }
      // No newline and nothing left unread: the last line is still being written.
      if (bytesRead === available) return { offset: start, records: [] }
    }
    // The record exceeds what can be held. Skip to the line after it, once
    // its newline has been written.
    const chunk = Buffer.alloc(READ_WINDOW_BYTES)
    for (let position = start + MAX_RECORD_BYTES; position < size;) {
      const { bytesRead } = await file.read(chunk, 0, chunk.length, position)
      if (bytesRead === 0) break
      const newline = chunk.subarray(0, bytesRead).indexOf(10)
      if (newline >= 0) return { offset: position + newline + 1, records: [] }
      position += bytesRead
    }
    return { offset: start, records: [] }
  } finally {
    await file.close()
  }
}

function parseLines(bytes: Buffer): unknown[] {
  return bytes.toString('utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as unknown)
}

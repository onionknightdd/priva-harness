import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { TerminalTextBatch } from '../../core/contract/terminal-service.js'

const displaySchema = z.object({
  session_id: z.string(), turn_id: z.string(), message_id: z.string(),
  index: z.number().int().nonnegative(), delta: z.string(), final: z.boolean(),
  agent_id: z.string().optional(),
})

/** Consume complete UTF-8 records only; a partial append stays behind the cursor. */
export async function readClaudeTerminalText(scratchDir: string, offset: number): Promise<TerminalTextBatch> {
  let file
  try { file = await open(join(scratchDir, 'claude-terminal-text.jsonl'), 'r') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { offset, deltas: [] }
    throw error
  }
  try {
    const size = (await file.stat()).size
    const start = size < offset ? 0 : offset
    const buffer = Buffer.alloc(size - start)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start)
    const end = buffer.subarray(0, bytesRead).lastIndexOf(10) + 1
    const lines = buffer.subarray(0, end).toString('utf8').split('\n').filter(Boolean)
    return { offset: start + end, deltas: lines.flatMap((line) => {
      const value = displaySchema.parse(JSON.parse(line) as unknown)
      return value.agent_id ? [] : [{ sessionId: value.session_id, turnId: value.turn_id,
        messageId: value.message_id, index: value.index, text: value.delta, final: value.final }]
    }) }
  } finally { await file.close() }
}

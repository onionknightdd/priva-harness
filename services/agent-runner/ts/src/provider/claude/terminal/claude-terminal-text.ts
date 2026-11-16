import { join } from 'node:path'
import { z } from 'zod'
import type { TerminalTextBatch } from '../../../core/contract/terminal-service.js'
import { readTerminalLog } from './claude-terminal-log.js'

const displaySchema = z.object({
  session_id: z.string(), turn_id: z.string(), message_id: z.string(),
  index: z.number().int().nonnegative(), delta: z.string(), final: z.boolean(),
  agent_id: z.string().optional(),
})

/** Consume complete UTF-8 records only; a partial append stays behind the cursor. */
export async function readClaudeTerminalText(scratchDir: string, offset: number): Promise<TerminalTextBatch> {
  const log = await readTerminalLog(join(scratchDir, 'claude-terminal-text.jsonl'), offset)
  if (log === undefined) return { offset, deltas: [] }
  return { offset: log.offset, deltas: log.records.flatMap((record) => {
    const value = displaySchema.parse(record)
    return value.agent_id ? [] : [{ sessionId: value.session_id, turnId: value.turn_id,
      messageId: value.message_id, index: value.index, text: value.delta, final: value.final }]
  }) }
}

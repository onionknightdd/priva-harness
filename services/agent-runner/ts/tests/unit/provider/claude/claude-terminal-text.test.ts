import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { readClaudeTerminalText } from '../../../../src/provider/claude/claude-terminal-text.js'

it('reads only complete UTF-8 append records and surfaces invalid records', async () => {
  const root = await mkdtemp(join(tmpdir(), 'priva-text-'))
  try {
    const path = join(root, 'claude-terminal-text.jsonl')
    const record = Buffer.from(JSON.stringify({ session_id: 's', turn_id: 't', message_id: 'm', index: 0, delta: '中文🦀\n', final: false }) + '\n')
    const split = record.indexOf(Buffer.from('中文')) + 1
    await writeFile(path, record.subarray(0, split))
    expect(await readClaudeTerminalText(root, 0)).toEqual({ offset: 0, deltas: [] })
    await appendFile(path, record.subarray(split))
    const batch = await readClaudeTerminalText(root, 0)
    expect(batch.deltas[0]).toMatchObject({ text: '中文🦀\n', index: 0, final: false })
    expect((await readClaudeTerminalText(root, batch.offset)).deltas).toEqual([])
    await appendFile(path, 'invalid\n')
    await expect(readClaudeTerminalText(root, batch.offset)).rejects.toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})

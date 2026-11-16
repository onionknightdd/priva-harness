import { appendFile, mkdtemp, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readTerminalLog } from '../../../../../src/provider/claude/terminal/claude-terminal-log.js'

describe('readTerminalLog', () => {
  let root: string
  let path: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'priva-terminal-log-'))
    path = join(root, 'events.jsonl')
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('returns undefined until the log exists and leaves a partial line behind the cursor', async () => {
    expect(await readTerminalLog(path, 0)).toBeUndefined()
    await writeFile(path, '{"a":1}\n{"b":')
    const first = await readTerminalLog(path, 0)
    expect(first).toEqual({ offset: 8, records: [{ a: 1 }] })
    await appendFile(path, '2}\n')
    expect(await readTerminalLog(path, first?.offset ?? 0)).toEqual({ offset: 16, records: [{ b: 2 }] })
  })

  it('starts over when the log was truncated and reports a line that is not JSON', async () => {
    await writeFile(path, '{"a":1}\n{"b":2}\n')
    await truncate(path, 0)
    await appendFile(path, '{"c":3}\n')
    expect(await readTerminalLog(path, 16)).toEqual({ offset: 8, records: [{ c: 3 }] })
    await appendFile(path, 'invalid\n')
    await expect(readTerminalLog(path, 8)).rejects.toThrow(SyntaxError)
  })

  it('answers a poll with nothing new without moving the cursor', async () => {
    await writeFile(path, '{"a":1}\n')
    expect(await readTerminalLog(path, 8)).toEqual({ offset: 8, records: [] })
    await appendFile(path, '{"b":2}\n')
    expect(await readTerminalLog(path, 8)).toEqual({ offset: 16, records: [{ b: 2 }] })
  })

  it('reads a record larger than one read window', async () => {
    const large = JSON.stringify({ content: 'x'.repeat(5 * 1024 * 1024) })
    await writeFile(path, `${large}\n{"after":true}\n`)
    const batch = await readTerminalLog(path, 0)
    expect(batch?.records).toHaveLength(2)
    expect(batch?.records[1]).toEqual({ after: true })
    expect(batch?.offset).toBe(Buffer.byteLength(large) + 1 + 15)
  })
})

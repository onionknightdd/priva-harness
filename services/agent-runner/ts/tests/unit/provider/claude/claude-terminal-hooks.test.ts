import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

import { readClaudeTerminalState, recordClaudeTerminalState, writeClaudeTerminalHooks } from '../../../../src/provider/claude/claude-terminal-hooks.js'

it('resets launch state and rejects late lifecycle records from a replaced Claude process', async () => {
  const root = await mkdtemp(join(tmpdir(), 'priva-hook-state-'))
  try {
    await writeClaudeTerminalHooks(root, 'http://127.0.0.1/events')
    const oldInstance = await readFile(join(root, 'claude-terminal-instance'), 'utf8')
    const state = { sessionId: 'session', instanceId: oldInstance, cwd: root, phase: 'running', event: 'prompt', prompt: 'hello', updatedAt: 1 } as const
    await recordClaudeTerminalState(root, state)
    expect(await readClaudeTerminalState(root)).toEqual(state)
    await writeClaudeTerminalHooks(root, 'http://127.0.0.1/events')
    expect(await readClaudeTerminalState(root)).toBeUndefined()
    const newInstance = await readFile(join(root, 'claude-terminal-instance'), 'utf8')
    expect(newInstance).not.toBe(oldInstance)
    await recordClaudeTerminalState(root, { ...state, phase: 'exited', event: 'exit', updatedAt: 2 })
    expect(await readClaudeTerminalState(root)).toBeUndefined()
    await recordClaudeTerminalState(root, { ...state, instanceId: newInstance, phase: 'idle', event: 'ready', updatedAt: 3 })
    expect(await readClaudeTerminalState(root)).toMatchObject({ instanceId: newInstance, event: 'ready' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

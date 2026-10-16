import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
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

it('reports the terminal error sentence instead of the error code', async () => {
  const root = await mkdtemp(join(tmpdir(), 'priva-hook-failure-'))
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      response.writeHead(204)
      response.end()
      server.emit('posted', JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('hook test server has no port')
  try {
    await writeClaudeTerminalHooks(root, `http://127.0.0.1:${String(address.port)}/events`)
    const instanceId = await readFile(join(root, 'claude-terminal-instance'), 'utf8')
    const posted = new Promise<Record<string, unknown>>((resolve) => server.once('posted', resolve))
    const child = spawn(process.execPath, [
      join(root, 'claude-terminal-hook.cjs'),
      `http://127.0.0.1:${String(address.port)}/events`,
      join(root, 'claude-terminal-state.json'),
      join(root, 'claude-terminal-instance'),
      instanceId,
      'terminal',
    ], { stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdin.end(JSON.stringify({
      hook_event_name: 'StopFailure',
      session_id: 'session',
      cwd: root,
      error: 'model_not_found',
      error_details: 'raw api body',
      last_assistant_message: 'There is an issue with the selected model (deepseek-flash).',
    }))
    const body = await posted
    expect(body).toMatchObject({
      event: 'failure',
      message: 'There is an issue with the selected model (deepseek-flash).',
    })
    expect(await new Promise<number>((resolve) => child.once('exit', resolve))).toBe(0)
  } finally {
    server.close()
    await rm(root, { recursive: true, force: true })
  }
})

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'
import { nativeClaudeAvailable, nativeClaudeFixture, modelMessage } from '../../../fixtures/terminal/claude-tui-fixture.js'

it.skipIf(!nativeClaudeAvailable())('answers a real native MCP elicitation in the existing bubble form', async () => {
  let calls = 0
  const fixture = await nativeClaudeFixture((body, reply) => modelMessage(body, reply, calls++ === 0
    ? [{ type: 'tool_use', id: 'native-form', name: 'mcp__migrationForm__form', input: {} }]
    : [{ type: 'text', text: 'Form received.' }], `form-${calls}`))
  try {
    await mkdir(join(fixture.root, '.claude'))
    await writeFile(join(fixture.root, '.claude/settings.json'), JSON.stringify({ enableAllProjectMcpServers: true }))
    await writeFile(join(fixture.root, '.mcp.json'), JSON.stringify({ mcpServers: { migrationForm: {
      type: 'stdio', command: process.execPath, alwaysLoad: true, args: ['--import', createRequire(import.meta.url).resolve('tsx'),
        fileURLToPath(new URL('../../../fixtures/terminal/elicitation-server.ts', import.meta.url))],
    } } }))
    fixture.send('Use the native form', 'form')
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'permission.requested'), { timeout: 15000 }).toBe(true)
    const frame = fixture.frames.find((frame) => frame.type === 'permission.requested')
    if (frame?.type !== 'permission.requested') throw new Error('MCP form was not mirrored')
    expect(frame.request.tool).toBe('mcp__migrationForm__elicitation')
    fixture.socket.send(JSON.stringify({ type: 'permission.respond', harness: 'claude', sessionId: fixture.ref.id, requestId: frame.request.requestId,
      decision: 'allow', answers: { q0: { selected: [], text: '3' }, q1: { selected: ['true'], text: '' } } }))
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed'), { timeout: 10000 }).toBe(true)
    expect(JSON.stringify(fixture.requests.at(-1)?.messages.at(-1))).toContain('accept')
    expect(JSON.stringify(fixture.requests.at(-1)?.messages.at(-1))).toContain('count')
    expect(fixture.sdkOpen).not.toHaveBeenCalled()
  } finally { await fixture.dispose() }
}, 40000)

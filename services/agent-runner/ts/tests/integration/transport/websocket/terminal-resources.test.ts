import { expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { nativeClaudeAvailable, nativeClaudeFixture, modelMessage } from '../../../fixtures/terminal/claude-tui-fixture.js'

it.skipIf(!nativeClaudeAvailable())('reloads resources at an empty idle prompt, preserves native drafts and keeps the session', async () => {
  let calls = 0
  const fixture = await nativeClaudeFixture((body, reply) => modelMessage(body, reply, [{ type: 'text', text: `Resource answer ${++calls}` }], `resource-${calls}`))
  try {
    fixture.send('Before resource refresh', 'before')
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed'), { timeout: 15000 }).toBe(true)
    const original = await fixture.terminals.state(fixture.ref)
    await mkdir(join(fixture.root, '.claude'))
    await writeFile(join(fixture.root, '.claude/settings.json'), JSON.stringify({ enableAllProjectMcpServers: true }))
    await writeFile(join(fixture.root, '.mcp.json'), JSON.stringify({ mcpServers: { refreshed: {
      type: 'stdio', command: process.execPath, alwaysLoad: true, args: ['--import', createRequire(import.meta.url).resolve('tsx'),
        fileURLToPath(new URL('../../../fixtures/terminal/elicitation-server.ts', import.meta.url))],
    } } }))
    await fixture.terminals.paste(fixture.ref, 'keep this draft')
    await expect.poll(() => fixture.terminals.capture(fixture.ref)).toContain('keep this draft')
    await fixture.harness.invalidateResources()
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect((await fixture.terminals.state(fixture.ref))?.instanceId).toBe(original?.instanceId)
    expect(await fixture.terminals.capture(fixture.ref)).toContain('keep this draft')
    await fixture.terminals.sendKeys(fixture.ref, ['C-c'])
    await expect.poll(async () => (await fixture.terminals.state(fixture.ref))?.instanceId, { timeout: 10000 }).not.toBe(original?.instanceId)
    fixture.send('After resource refresh', 'after')
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'after'), { timeout: 15000 }).toBe(true)
    expect(fixture.ref.id).toBe(original?.sessionId)
    expect(JSON.stringify(fixture.requests.at(-1)?.messages)).toContain('Before resource refresh')
    expect(fixture.requests.at(-1)?.tools?.map((tool) => tool['name'])).toContain('mcp__refreshed__form')
    expect(fixture.sdkOpen).not.toHaveBeenCalled()
  } catch (error) {
    throw new Error(`${String(error)}\n${await fixture.terminals.capture(fixture.ref)}\n${JSON.stringify(fixture.frames.filter((frame) => frame.type !== 'session.snapshot'))}`, { cause: error })
  } finally { await fixture.dispose() }
}, 45000)

it.skipIf(!nativeClaudeAvailable())('finishes /context locally, rejects empty compaction and mirrors short conversation compaction', async () => {
  let calls = 0
  const fixture = await nativeClaudeFixture((body, reply) => modelMessage(body, reply, [{ type: 'text', text: `A useful summary ${++calls}` }], `command-${calls}`))
  try {
    fixture.send('/compact', 'empty-compact')
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.failed' && frame.runId === 'empty-compact' && frame.message.includes('Not enough messages')), { timeout: 10000 }).toBe(true)
    expect(calls).toBe(0)
    fixture.send('Some conversation to inspect', 'before')
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'before'), { timeout: 15000 }).toBe(true)
    const callsBeforeContext = calls
    fixture.send('/context', 'context')
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'context'), { timeout: 10000 }).toBe(true)
    expect(calls).toBe(callsBeforeContext)
    fixture.send('/compact', 'short-compact')
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'short-compact'), { timeout: 10000 }).toBe(true)
    fixture.send('More conversation to compact', 'more')
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'more'), { timeout: 10000 }).toBe(true)
    fixture.send('/compact', 'compact')
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === 'compact'), { timeout: 10000 }).toBe(true)
    for (const runId of ['short-compact', 'compact']) {
      const lifecycle = fixture.frames.filter((frame) => frame.runId === runId
        && ['session.compacting', 'session.compacted', 'run.completed', 'run.failed', 'run.aborted'].includes(frame.type))
      expect(lifecycle.map((frame) => frame.type)).toEqual(['session.compacting', 'session.compacted', 'run.completed'])
      expect(lifecycle.find((frame) => frame.type === 'session.compacted')?.summary).toMatch(/^A useful summary \d+$/u)
    }
    expect(fixture.sdkOpen).not.toHaveBeenCalled()
  } catch (error) {
    throw new Error(`${String(error)}\n${await fixture.terminals.capture(fixture.ref)}\n${JSON.stringify(fixture.frames.filter((frame) => frame.type !== 'session.snapshot'))}`, { cause: error })
  } finally { await fixture.dispose() }
}, 40000)

import { join, resolve } from 'node:path'

import { expect, it } from 'vitest'

import { LocalResourceService } from '../../../../src/infrastructure/resources/local-resource-service.js'
import { modelMessage, nativeClaudeAvailable, nativeClaudeFixture } from '../../../fixtures/terminal/claude-tui-fixture.js'

it.skipIf(!nativeClaudeAvailable())('applies saved MCP switches to the native model tool inventory across idle reloads', async () => {
  const fixture = await nativeClaudeFixture((body, reply) => modelMessage(body, reply, [{ type: 'text', text: 'MCP configuration checked.' }]))
  const resources = new LocalResourceService({ activeCwd: fixture.root, claudeDir: fixture.configDir,
    claudeConfigFilePath: join(fixture.configDir, '.claude.json'), piDir: join(fixture.root, 'pi'), discoverProjects: () => Promise.resolve([]) })
  const query = { harness: 'claude' as const, cwd: fixture.root }
  const reload = async () => {
    const original = (await fixture.terminals.state(fixture.ref))?.instanceId
    await fixture.harness.invalidateResources()
    await expect.poll(async () => (await fixture.terminals.state(fixture.ref))?.instanceId, { timeout: 15000 }).not.toBe(original)
  }
  const turn = async (id: string) => {
    fixture.send(`Check configuration ${id}`, id)
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed' && frame.runId === id), { timeout: 15000 }).toBe(true)
    return fixture.requests.at(-1)?.tools?.map((tool) => tool['name']) ?? []
  }
  try {
    const detail = await resources.mcp.create(query, { scope: 'project', name: 'files.test', definition: {
      type: 'stdio', command: process.execPath, args: ['--import', import.meta.resolve('tsx'), resolve('tests/fixtures/resources/mcp-server.ts')], alwaysLoad: true,
    } })
    await resources.mcp.toggleTool(query, detail.id, 'echo', false)
    const initial = await turn('tool-disabled')
    expect(initial).toContain('mcp__files_test__second')
    expect(initial).not.toContain('mcp__files_test__echo')
    await resources.mcp.toggle(query, detail.id, false)
    await reload()
    expect((await turn('server-disabled')).filter((name) => String(name).startsWith('mcp__files_test__'))).toEqual([])
    await resources.mcp.toggle(query, detail.id, true)
    await reload()
    const restored = await turn('server-restored')
    expect(restored).toContain('mcp__files_test__second')
    expect(restored).not.toContain('mcp__files_test__echo')
    await resources.mcp.toggleTool(query, detail.id, 'echo', true)
    await reload()
    expect(await turn('tool-restored')).toContain('mcp__files_test__echo')
    expect(fixture.sdkOpen).not.toHaveBeenCalled()
  } catch (error) {
    throw new Error(`${String(error)}\n${await fixture.terminals.capture(fixture.ref)}`, { cause: error })
  } finally { await fixture.dispose() }
}, 80000)

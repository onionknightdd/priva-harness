// Opt-in: reads a real application on this machine's desktop through the runtime installed in the
// computer-use plugin. The test sends no input.
//
//   COMPUTER_USE_PROBE_APP=Calculator TMPDIR=/tmp npx vitest run tests/integration/transport/websocket/terminal-computer-use.test.ts
import { expect, it } from 'vitest'
import { enabledPluginMcpServers } from '../../../../src/core/plugin/plugin-mcp.js'
import { modelMessage, nativeClaudeAvailable, nativeClaudeFixture } from '../../../fixtures/terminal/claude-tui-fixture.js'

const app = process.env['COMPUTER_USE_PROBE_APP']

it.skipIf(!app || !nativeClaudeAvailable())('reads an application through the native terminal with the Computer Use plugin', async () => {
  if (!app) throw new Error('COMPUTER_USE_PROBE_APP is required')
  const advertised = new Set<string>()
  const toolUseId = 'open-application'
  let asked = false
  let replies = 0
  const fixture = await nativeClaudeFixture((body, reply) => {
    const tools = (body.tools ?? []).map((tool) => String(tool['name']))
    for (const name of tools) advertised.add(name)
    if (!asked && tools.includes('mcp__cua_repl__js')) {
      asked = true
      return modelMessage(body, reply, [{ type: 'tool_use', id: toolUseId, name: 'mcp__cua_repl__js',
        input: { title: `Opening ${app}`, code: `let app = await cua.getApp(${JSON.stringify(app)});` } }], 'open-application')
    }
    return modelMessage(body, reply, [{ type: 'text', text: 'Done.' }], `reply-${++replies}`)
  })
  try {
    fixture.send(`Open ${app} and read its window.`, 'computer-use', 'claude-sonnet-4-6', { enabledPluginIds: ['computer-use'] })
    await expect.poll(() => fixture.frames.some((candidate) => candidate.type === 'run.completed'), { timeout: 60000 }).toBe(true)
    // Applications are used without asking: neither an approval card nor the terminal's own dialog.
    expect(fixture.frames.filter((candidate) => candidate.type === 'permission.requested' || candidate.type === 'terminal.focus')).toEqual([])

    const last = fixture.requests.at(-1)?.messages.at(-1)?.content
    const result = (Array.isArray(last) ? last : []).find((block) => block['type'] === 'tool_result' && block['tool_use_id'] === toolUseId)
    if (!result) throw new Error('The model never received the application state')
    expect(result['is_error']).not.toBe(true)
    const text = (result['content'] as { type: string; text?: string }[]).map((part) => part.text ?? '').join('\n')
    expect(text.split('\n').filter((line) => /^\s*\d+\s+\S/u.test(line)).length).toBeGreaterThan(0)

    expect([...advertised]).toEqual(expect.arrayContaining(['mcp__cua_repl__js', 'mcp__cua_repl__js_reset', 'mcp__node_repl__js']))
    for (const server of enabledPluginMcpServers(['computer-use'])) {
      for (const tool of server.hiddenTools) expect(advertised.has(`mcp__${server.name}__${tool}`)).toBe(false)
    }
    expect(fixture.sdkOpen).not.toHaveBeenCalled()
  } catch (error) {
    if (fixture.ref.id) console.error(await fixture.terminals.capture(fixture.ref))
    throw error
  } finally { await fixture.dispose() }
}, 120000)

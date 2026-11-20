import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as pluginMcp from '../../../../src/core/plugin/plugin-mcp.js'
import { resolveClaudeQueryOptions } from '../../../../src/provider/claude/claude-runtime.js'
import { claudeTerminalLaunch } from '../../../../src/provider/claude/terminal/claude-terminal-launch.js'
import { testRunSpec } from '../../../support/run-spec.js'

const servers: pluginMcp.PluginMcpServer[] = [
  { name: 'desktop', command: '/runtime/bin/node', args: ['/runtime/launch.mjs'], env: { MODE: 'computer' },
    hiddenTools: ['debug', 'turn_ended'], turnEndTool: 'turn_ended' },
  { name: 'notes', command: '/runtime/bin/notes', args: [], env: {}, hiddenTools: [] },
]
const stdio = {
  desktop: { type: 'stdio', command: '/runtime/bin/node', args: ['/runtime/launch.mjs'], env: { MODE: 'computer' }, alwaysLoad: true },
  notes: { type: 'stdio', command: '/runtime/bin/notes', args: [], env: {}, alwaysLoad: true },
}
const hidden = ['mcp__desktop__debug', 'mcp__desktop__turn_ended']
const turnEnd = (event: 'Stop' | 'SubagentStop') => ({ hooks: [{
  type: 'mcp_tool', server: 'desktop', tool: 'turn_ended',
  input: { hook_event_name: '${hook_event_name}', session_id: event === 'Stop' ? '${session_id}' : '${agent_id}', turn_id: '${prompt_id}' },
}] })

describe('Claude sessions with plugin MCP servers', () => {
  let scratchDir: string
  beforeEach(async () => {
    scratchDir = await mkdtemp(join(tmpdir(), 'priva-claude-plugin-mcp-'))
    vi.spyOn(pluginMcp, 'enabledPluginMcpServers').mockReturnValue(servers)
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(scratchDir, { recursive: true, force: true })
  })

  it('gives SDK sessions the declared servers, hides host-only tools and reports turn ends to stateful servers', () => {
    const spec = testRunSpec({ cwd: scratchDir, enabledPluginIds: ['computer-use'] })
    const options = resolveClaudeQueryOptions(spec)
    expect(pluginMcp.enabledPluginMcpServers).toHaveBeenCalledWith(['computer-use'])
    expect(options.mcpServers).toEqual(stdio)
    expect(options.disallowedTools).toEqual(expect.arrayContaining(hidden))
    expect(options.disallowedTools?.filter((tool) => tool.startsWith('mcp__'))).toEqual(hidden)
    const settings = options.settings
    if (typeof settings !== 'object') throw new Error('Expected inline Claude settings')
    expect(settings.hooks).toEqual({ Stop: [turnEnd('Stop')], SubagentStop: [turnEnd('SubagentStop')] })
  })

  it('gives native terminal sessions the same servers, hidden tools and turn-end hooks', async () => {
    const spec = testRunSpec({ cwd: scratchDir, enabledPluginIds: ['computer-use'] })
    const launch = await claudeTerminalLaunch({
      target: { kind: 'new', provider: 'claude', sessionId: 'plugin-session' }, spec, executable: '/opt/claude',
      context: { scratchDir, cols: 80, rows: 24 },
    })
    const argument = (flag: string): string => {
      const value = launch.args[launch.args.indexOf(flag) + 1]
      if (!launch.args.includes(flag) || value === undefined) throw new Error(`Missing ${flag}`)
      return value
    }
    expect(JSON.parse(await readFile(argument('--mcp-config'), 'utf8'))).toEqual({ mcpServers: stdio })
    expect(argument('--disallowedTools').split(',').filter((tool) => tool.startsWith('mcp__'))).toEqual(hidden)
    const settings = JSON.parse(await readFile(argument('--settings'), 'utf8')) as { hooks?: unknown }
    expect(settings.hooks).toEqual({ Stop: [turnEnd('Stop')], SubagentStop: [turnEnd('SubagentStop')] })
  })

  it('leaves sessions without plugin servers free of MCP configuration and hooks', () => {
    vi.mocked(pluginMcp.enabledPluginMcpServers).mockReturnValue([])
    const options = resolveClaudeQueryOptions(testRunSpec({ cwd: scratchDir }))
    expect(options.mcpServers).toBeUndefined()
    expect(options.disallowedTools?.some((tool) => tool.startsWith('mcp__'))).toBe(false)
    const settings = options.settings
    if (typeof settings !== 'object') throw new Error('Expected inline Claude settings')
    expect(settings).not.toHaveProperty('hooks')
  })
})

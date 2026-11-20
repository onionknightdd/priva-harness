import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_PLUGIN_IDS, normalizeEnabledPluginIds, resolveBuiltinPlugins } from '../../../../src/core/plugin/builtin-plugins.js'

describe('built-in plugin registry', () => {
  it('resolves the selected resource and Claude native adapter from packaged metadata', () => {
    expect(BUILTIN_PLUGIN_IDS).toEqual(['agent-dashboard', 'computer-use'])
    const [plugin] = resolveBuiltinPlugins(['agent-dashboard'])
    if (plugin === undefined) throw new Error('Missing dashboard plugin')
    expect(plugin).toMatchObject({ id: 'agent-dashboard', name: 'Agent dashboard', icon: 'dashboard', mcpServers: {} })
    expect(plugin.skillDirs).toEqual([path.join(plugin.rootDir, 'skills', 'agent-dashboard')])
    const native: unknown = JSON.parse(readFileSync(path.join(plugin.rootDir, '.claude-plugin/plugin.json'), 'utf8'))
    expect(native).toEqual({ name: plugin.id, skills: './skills' })
  })

  it('names every skill by its directory so providers load the same set', () => {
    for (const plugin of resolveBuiltinPlugins(BUILTIN_PLUGIN_IDS)) {
      for (const skillDir of plugin.skillDirs) {
        expect(readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8')).toMatch(new RegExp(`^---\\nname: ${path.basename(skillDir)}\\n`, 'u'))
      }
    }
  })

  it('declares the Computer Use workers with their host-only tools', () => {
    const [plugin] = resolveBuiltinPlugins(['computer-use'])
    if (plugin === undefined) throw new Error('Missing Computer Use plugin')
    expect(plugin.skillDirs.map((skillDir) => path.basename(skillDir))).toEqual(['computer-use', 'registered-computers'])
    expect(Object.keys(plugin.mcpServers)).toEqual(['cua_repl', 'node_repl', 'registered_computers'])
    expect(plugin.mcpServers['cua_repl']).toMatchObject({
      command: '${runtime}/bin/node', args: ['${plugin}/mcp/cua-repl.mjs', '${runtime}'],
      hiddenTools: ['js_add_node_module_dir'], turnEndTool: 'turn_ended', env: {},
    })
    expect(plugin.mcpServers['node_repl']).toMatchObject({ command: '${runtime}/bin/node_repl', hiddenTools: [], turnEndTool: 'turn_ended' })
    expect(plugin.mcpServers['node_repl']?.env).not.toHaveProperty('NODE_REPL_TRUSTED_SERVICES')
    expect(plugin.mcpServers['registered_computers']).toMatchObject({
      runnerModule: 'infrastructure/computer/device-mcp', inheritEnv: ['PRIVA_COMPUTER_DIR'], turnEndTool: 'turn_ended',
    })
    expect(plugin.mcpServers['registered_computers']).not.toHaveProperty('command')
  })

  it('loads nothing by default and normalizes duplicate selections', () => {
    expect(normalizeEnabledPluginIds(undefined)).toEqual([])
    expect(resolveBuiltinPlugins([])).toEqual([])
    expect(normalizeEnabledPluginIds(['agent-dashboard', 'agent-dashboard'])).toEqual(['agent-dashboard'])
  })

  it.each([null, {}, 'agent-dashboard', [1], ['unknown'], ['../agent-dashboard']])('rejects invalid selections %j', (value) => {
    expect(() => normalizeEnabledPluginIds(value)).toThrow()
  })
})

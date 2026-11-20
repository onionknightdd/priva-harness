import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_PLUGIN_IDS, normalizeEnabledPluginIds, resolveBuiltinPlugins } from '../../../../src/core/plugin/builtin-plugins.js'

describe('built-in plugin registry', () => {
  it('resolves the selected resource and Claude native adapter from packaged metadata', () => {
    expect(BUILTIN_PLUGIN_IDS).toEqual(['agent-dashboard', 'computer-use'])
    const [plugin] = resolveBuiltinPlugins(['agent-dashboard'])
    if (plugin === undefined) throw new Error('Missing dashboard plugin')
    expect(plugin).toMatchObject({ id: 'agent-dashboard', name: 'Agent dashboard', icon: 'dashboard' })
    expect(plugin.skillDir).toBe(path.join(plugin.rootDir, 'skill'))
    expect(readFileSync(path.join(plugin.skillDir, 'SKILL.md'), 'utf8')).toContain('name: agent-dashboard')
    const native: unknown = JSON.parse(readFileSync(path.join(plugin.rootDir, '.claude-plugin/plugin.json'), 'utf8'))
    expect(native).toEqual({ name: plugin.id, skills: './skill' })
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

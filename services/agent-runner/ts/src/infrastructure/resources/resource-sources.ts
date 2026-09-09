import { access, lstat, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

import { resolveSettings } from '@anthropic-ai/claude-agent-sdk'

import type { ProviderId } from '../../core/contract/agent-provider.js'
import type { ResourceDiagnostic, ResourceOrigin, ResourceScope, ResourceSource } from '../../core/resource/resource-catalog.js'
import { exists, inside, missing, record, resourceId, type ResourceFiles, strings } from './resource-files.js'

export interface ResourceEnvironment {
  readonly claudeDir: string
  readonly piDir: string
}

export async function source(
  harness: ProviderId, scope: ResourceScope, origin: ResourceOrigin,
  path: string, cwd: string | null, label: string, writable = false, canAdd = false,
): Promise<ResourceSource> {
  let allowed = writable
  if (allowed) {
    try { if ((await lstat(path)).isSymbolicLink()) allowed = false } catch (error) { if (!missing(error)) throw error }
    let parent = path
    while (!(await exists(parent)) && dirname(parent) !== parent) parent = dirname(parent)
    try { await access(parent, constants.W_OK) } catch { allowed = false }
  }
  return { id: resourceId(harness, scope, path, cwd ?? ''), harness, scope, origin, path, cwd, label, writable: allowed, canAdd: allowed && canAdd }
}

export async function ancestors(cwd: string): Promise<string[]> {
  const result: string[] = []
  let current = cwd
  for (;;) {
    result.push(current)
    if (await exists(join(current, '.git')) || dirname(current) === current) break
    current = dirname(current)
  }
  return result
}

export async function skillFiles(root: string, recursive: boolean): Promise<string[]> {
  if (!(await exists(root))) return []
  const entries = await readdir(root, { withFileTypes: true })
  if (entries.some((entry) => entry.name === 'SKILL.md' && entry.isFile())) return [join(root, 'SKILL.md')]
  const files: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || !entry.isDirectory()) continue
    const child = join(root, entry.name)
    if (await exists(join(child, 'SKILL.md'))) files.push(join(child, 'SKILL.md'))
    else if (recursive) files.push(...await skillFiles(child, true))
  }
  return files
}

export interface ClaudePluginSource {
  readonly name: string
  readonly path: string
  readonly scope: ResourceScope
  readonly cwd: string | null
  readonly enabled: boolean
  readonly manifest: Record<string, unknown>
}

export async function claudePlugins(
  files: ResourceFiles, environment: ResourceEnvironment, cwd: string, diagnostics: ResourceDiagnostic[],
): Promise<ClaudePluginSource[]> {
  const path = join(environment.claudeDir, 'plugins', 'installed_plugins.json')
  try {
    const installed = record((await files.json(path))['plugins'])
    const settings = await resolveSettings({ cwd })
    const enabled = record(settings.effective.enabledPlugins)
    const result: ClaudePluginSource[] = []
    for (const [name, entries] of Object.entries(installed)) {
      if (!Array.isArray(entries)) continue
      for (const item of entries) {
        const entry = record(item)
        if (typeof entry['installPath'] !== 'string') continue
        const project = typeof entry['projectPath'] === 'string' ? resolve(entry['projectPath']) : null
        if (project !== null && !inside(project, cwd)) continue
        const pluginPath = entry['installPath']
        result.push({ name, path: pluginPath, scope: entry['scope'] === 'user' ? 'global' : entry['scope'] === 'local' ? 'local' : 'project', cwd: project,
          enabled: enabled[name] === true, manifest: await files.json(join(pluginPath, '.claude-plugin', 'plugin.json')) })
      }
    }
    return result
  } catch (error) {
    diagnostics.push({ path, message: error instanceof Error ? error.message : 'Could not read installed plugins' })
    return []
  }
}

export function pluginComponentPaths(plugin: ClaudePluginSource, key: string, defaultPath: string): string[] {
  const value = plugin.manifest[key]
  const configured = typeof value === 'string' ? [value] : strings(value)
  return [...new Set([defaultPath, ...configured])].map((path) => resolve(plugin.path, path)).filter((path) => inside(plugin.path, path))
}

export function sourceLabel(scope: ResourceScope, origin: ResourceOrigin, path: string): string {
  return origin === 'package' || origin === 'plugin' ? basename(path) : `${scope === 'global' ? 'Global' : scope === 'local' ? 'Local' : 'Project'} · ${basename(dirname(path))}/${basename(path)}`
}

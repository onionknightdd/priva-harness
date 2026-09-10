import { lstat, readdir, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { resolveSettings } from '@anthropic-ai/claude-agent-sdk'
import { loadProjectContextFiles } from '@earendil-works/pi-coding-agent'

import type { AutoMemoryProject, MemoryDetail, MemoryList, MemorySummary } from '../../core/resource/agent-resources.js'
import { ResourceError, type ResourceDiagnostic, type ResourceQuery, type ResourceSource } from '../../core/resource/resource-catalog.js'
import { claudeMemoryDirectory } from './claude-memory-paths.js'
import { memoryProjectRoot, piAgentMemoryDirectory, piMemoryModule } from './pi-resource-modules.js'
import type { ProjectDirectories } from './project-directories.js'
import { exists, missing, resourceId, type ResourceFiles } from './resource-files.js'
import { markdownPaths, ResourceMarkdown } from './resource-markdown.js'
import { source, type ResourceEnvironment } from './resource-sources.js'
import type { SubagentCatalog } from './subagent-catalog.js'

export class MemoryCatalog {
  private readonly markdown = new ResourceMarkdown()

  constructor(private readonly environment: ResourceEnvironment, private readonly files: ResourceFiles, private readonly projects: ProjectDirectories, private readonly agents: SubagentCatalog) {}

  async list(query: ResourceQuery): Promise<MemoryList> {
    const known = await this.projects.list(query.harness)
    const selected = await this.projects.list(query.harness, query.cwd)
    const groups: MemoryList['groups'] = []
    const diagnostics: ResourceDiagnostic[] = []
    const autoMemory: AutoMemoryProject[] = []
    const add = async (entry: ResourceSource, paths: string[], kind: MemorySummary['kind'], enabled = true) => {
      if (groups.some((group) => group.source.id === entry.id)) return
      const items: MemorySummary[] = []
      groups.push({ source: entry, items })
      for (const path of paths) {
        try {
          const present = await exists(path)
          const linked = present && (await lstat(path)).isSymbolicLink()
          items.push({ id: resourceId(entry.id, path), sourceId: entry.id, path, name: basename(path), kind, exists: present,
            size: present ? (await stat(path)).size : 0, canDelete: kind !== 'instruction' && entry.writable && present && !linked, enabled })
        } catch (error) { diagnostics.push({ path, message: error instanceof Error ? error.message : 'Could not read memory file' }) }
      }
    }
    const instruction = async (path: string, cwd: string | null, level: string, writable = true, enabled = true) => {
      const scope = level === 'user' || level === 'global' || level === 'managed' ? 'global' : level === 'local' ? 'local' : 'project'
      const entry = { ...await source(query.harness, scope, 'directory', path, cwd, `${level} · ${basename(path)}`, writable), level }
      await add(entry, [path], 'instruction', enabled)
    }

    if (query.harness === 'pi') {
      const seen = new Set<string>()
      for (const cwd of selected) {
        // Native loader handles ancestor ordering, candidate precedence and linked worktrees.
        const loaded = loadProjectContextFiles({ cwd, agentDir: this.environment.piDir })
        const candidates = [this.environment.piDir, cwd, ...loaded.map((item) => dirname(item.path))]
        for (const dir of new Set(candidates)) {
          const active = loaded.find((file) => dirname(file.path) === dir)?.path
          const paths: string[] = []
          let filenames: string[] = []
          try { filenames = await readdir(dir) } catch (error) { if (!missing(error)) throw error }
          for (const name of ['AGENTS.override.md', 'AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD']) {
            if (filenames.includes(name)) paths.push(join(dir, name))
          }
          if (!paths.length) paths.push(join(dir, 'AGENTS.md'))
          for (const path of paths) {
            if (seen.has(path)) continue
            seen.add(path)
            const global = dir === this.environment.piDir
            await instruction(path, global ? null : dir, global ? 'global' : dir === cwd ? 'project' : 'ancestor', true, active === path || paths.length === 1)
          }
        }
      }
    } else {
      await instruction(join(this.environment.claudeDir, 'CLAUDE.md'), null, 'user')
      for (const path of await markdownPaths(join(this.environment.claudeDir, 'rules'), true)) await instruction(path, null, 'user')
      const managedDir = process.platform === 'darwin' ? '/Library/Application Support/ClaudeCode' : process.platform === 'win32' ? join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'ClaudeCode') : '/etc/claude-code'
      for (const path of [join(managedDir, 'CLAUDE.md'), ...await markdownPaths(join(managedDir, '.claude/rules'), true)]) if (await exists(path)) await instruction(path, null, 'managed', false)
      for (const cwd of selected) {
        let current = cwd
        for (;;) {
          for (const name of ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']) {
            const path = join(current, name)
            if (current === cwd && name === 'CLAUDE.md' || await exists(path)) await instruction(path, current, name === 'CLAUDE.local.md' ? 'local' : current === cwd ? 'project' : 'ancestor')
          }
          for (const path of await markdownPaths(join(current, '.claude/rules'), true)) await instruction(path, current, current === cwd ? 'project' : 'ancestor')
          if (dirname(current) === current) break
          current = dirname(current)
        }
      }
    }
    for (const cwd of selected) {
      try {
        const config = await this.autoConfig(query.harness, cwd)
        const entry = { ...await source(query.harness, 'project', 'directory', config.path, cwd, `Auto memory · ${basename(cwd)}`, true), level: 'project' }
        await add(entry, await markdownPaths(config.path, true), 'auto', config.enabled)
        autoMemory.push({ ...config, sourceId: entry.id })
      } catch (error) { diagnostics.push({ path: cwd, message: error instanceof Error ? error.message : 'Could not resolve auto memory' }) }
    }
    for (const agent of await this.agents.memoryDeclarations(query)) {
      const scope = agent.definition['memory']
      if (scope !== 'user' && scope !== 'project' && scope !== 'local') continue
      // A global agent can have a separate project/local store in every workspace.
      for (const cwd of scope === 'user' ? [null] : agent.source.cwd ? [agent.source.cwd] : selected) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(agent.name)) continue
        if (scope !== 'user' && cwd === null) continue
        const configDir = query.harness === 'claude' ? this.environment.claudeDir : this.environment.piDir
        const path = query.harness === 'pi' ? await piAgentMemoryDirectory(agent.name, scope, cwd ?? this.projects.activeCwd)
          : scope === 'user' ? join(configDir, 'agent-memory', agent.name) : join(cwd ?? '', '.claude', scope === 'local' ? 'agent-memory-local' : 'agent-memory', agent.name)
        const entry = { ...await source(query.harness, scope === 'user' ? 'global' : scope === 'local' ? 'local' : 'project', 'directory', path, cwd, `Agent memory · ${agent.name} · ${scope}`, true), level: scope }
        await add(entry, await markdownPaths(path, true), 'agent', agent.enabled)
      }
    }
    return { groups, diagnostics, autoMemory, projects: [...new Set([...selected, ...known])] }
  }

  async get(query: ResourceQuery, id: string): Promise<MemoryDetail> {
    for (const group of (await this.list(query)).groups) {
      const item = group.items.find((item) => item.id === id)
      if (item) {
        const linked = item.exists && (await lstat(item.path)).isSymbolicLink()
        return { ...item, source: linked ? { ...group.source, writable: false } : group.source, ...await this.markdown.read(item.path) }
      }
    }
    throw new ResourceError(404, 'Memory file not found in the selected harness and project')
  }

  async update(query: ResourceQuery, id: string, content: string, revision: string): Promise<MemoryDetail> {
    const detail = await this.get(query, id)
    if (!detail.source.writable) throw new ResourceError(403, 'This memory source is read-only')
    if (detail.kind !== 'instruction' && !detail.exists) throw new ResourceError(404, 'Memory file no longer exists')
    await this.markdown.write(detail.path, content, revision)
    return await this.get(query, id)
  }

  async delete(query: ResourceQuery, id: string, revision: string): Promise<void> {
    const detail = await this.get(query, id)
    if (!detail.canDelete) throw new ResourceError(403, 'Only writable automatic memory files can be deleted')
    await this.markdown.delete(detail.path, revision)
  }

  async toggle(query: ResourceQuery, enabled: boolean): Promise<AutoMemoryProject> {
    if (!query.cwd) throw new ResourceError(422, 'Select a project to change auto memory')
    const [cwd] = await this.projects.list(query.harness, query.cwd)
    if (!cwd) throw new ResourceError(404, 'Project directory not found')
    const current = await this.autoConfig(query.harness, cwd)
    if (!current.canToggle) throw new ResourceError(409, current.reason ?? 'Auto memory is controlled by another source')
    await this.files.update(current.settingsPath, (settings) => { settings['autoMemoryEnabled'] = enabled })
    return { ...await this.autoConfig(query.harness, cwd), sourceId: resourceId(query.harness, 'project', current.path, cwd) }
  }

  private async autoConfig(harness: ResourceQuery['harness'], cwd: string): Promise<Omit<AutoMemoryProject, 'sourceId'>> {
    const root = await memoryProjectRoot(cwd)
    if (harness === 'pi') {
      const settingsPath = join(cwd, '.pi/settings.json')
      const settings = { ...await this.files.json(join(this.environment.piDir, 'settings.json')), ...await this.files.json(settingsPath) }
      const memory = await piMemoryModule()
      const override = typeof settings['autoMemoryDirectory'] === 'string' ? settings['autoMemoryDirectory'] : undefined
      const rawDisable = process.env['PI_CODE_DISABLE_AUTO_MEMORY']?.trim().toLowerCase()
      const disable = ['0', '1', 'true', 'false'].includes(rawDisable ?? '') ? rawDisable : undefined
      const enabled = memory.autoMemoryEnabled(settings['autoMemoryEnabled'], { CLAUDE_CODE_DISABLE_AUTO_MEMORY: disable })
      const path = override ? memory.resolveMemoryDir(cwd, override) : join(this.environment.piDir, 'memory', memory.projectSlug(root))
      return { cwd, path, enabled, settingsPath, canToggle: disable === undefined, reason: disable === undefined ? null : 'PI_CODE_DISABLE_AUTO_MEMORY controls this setting' }
    }
    const settings = await resolveSettings({ cwd })
    // autoMemoryDirectory intentionally ignores the checked-in project settings tier.
    let override: string | undefined
    for (const entry of settings.sources) if (entry.source !== 'project' && entry.settings.autoMemoryDirectory !== undefined) override = entry.settings.autoMemoryDirectory
    const path = claudeMemoryDirectory(this.environment.claudeDir, root, override)
    const env = process.env['CLAUDE_CODE_DISABLE_AUTO_MEMORY']?.trim().toLowerCase()
    const forced = env === '1' || env === 'true' ? false : env === '0' || env === 'false' ? true : undefined
    const controlling = settings.provenance['autoMemoryEnabled']?.source
    const canToggle = forced === undefined && controlling !== 'managed' && controlling !== 'flag'
    const local = [...settings.sources].reverse().find((entry) => entry.source === 'local')?.path
    // Write the highest writable native tier, so a pre-existing local setting cannot silently override this toggle.
    const settingsPath = local ?? join(root, '.claude/settings.local.json')
    return { cwd, path, settingsPath, enabled: forced ?? settings.effective.autoMemoryEnabled !== false, canToggle,
      reason: canToggle ? null : forced !== undefined ? 'CLAUDE_CODE_DISABLE_AUTO_MEMORY controls this setting' : 'Managed settings control auto memory' }
  }
}

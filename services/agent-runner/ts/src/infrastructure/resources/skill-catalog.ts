import { lstat, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { lookup } from 'mime-types'

import { resolveSettings } from '@anthropic-ai/claude-agent-sdk'
import { DefaultPackageManager, loadSkills, parseFrontmatter, SettingsManager } from '@earendil-works/pi-coding-agent'

import { ResourceError, type ResourceGroup, type ResourceList, type ResourceQuery, type ResourceSource, type SkillDetail, type SkillFile, type SkillSummary } from '../../core/resource/resource-catalog.js'
import { canonicalDirectory, containedFile, exists, inside, readText, record, resourceId, type ResourceFiles, strings } from './resource-files.js'
import { type ProjectDirectories } from './project-directories.js'
import { ancestors, claudePlugins, pluginComponentPaths, skillFiles, source, type ResourceEnvironment } from './resource-sources.js'

export const bundledPiAdapterPath = dirname(createRequire(import.meta.url).resolve('pi-mcp-adapter'))

export class SkillCatalog {
  constructor(
    private readonly environment: ResourceEnvironment,
    private readonly files: ResourceFiles,
    private readonly projects: ProjectDirectories,
  ) {}

  async list(query: ResourceQuery): Promise<ResourceList<SkillSummary>> {
    const contexts = await this.projects.list(query.harness, query.cwd)
    const projects = [...new Set([...await this.projects.list(query.harness), ...contexts])]
    const result: ResourceList<SkillSummary> = { groups: [], diagnostics: [], projects }
    for (const cwd of contexts) {
      if (query.harness === 'pi') await this.pi(cwd, result)
      else await this.claude(cwd, result)
    }
    return result
  }

  async get(query: ResourceQuery, id: string): Promise<SkillDetail> {
    const { item, source: origin } = await this.find(query, id)
    return { ...item, source: origin, content: await readText(item.filePath), files: await this.tree(item.path) }
  }

  async file(query: ResourceQuery, id: string, path: string): Promise<{ path: string; content: string }> {
    const { item } = await this.find(query, id)
    return { path, content: await readText(await containedFile(item.path, path)) }
  }

  async asset(query: ResourceQuery, id: string, path: string): Promise<{ data: Buffer; mediaType: string }> {
    const { item } = await this.find(query, id)
    const absolute = await containedFile(item.path, path)
    const mediaType = lookup(path)
    if (!mediaType || (!mediaType.startsWith('image/') && mediaType !== 'application/pdf')) {
      throw new ResourceError(415, 'Only images and PDF files have an asset preview')
    }
    const info = await stat(absolute)
    if (!info.isFile()) throw new ResourceError(422, 'Expected a regular file')
    const maxBytes = 20 * 1024 * 1024
    if (info.size > maxBytes) throw new ResourceError(413, 'File is too large to preview')
    const data = await readFile(absolute)
    if (data.length > maxBytes) throw new ResourceError(413, 'File is too large to preview')
    return { data, mediaType }
  }

  async toggle(query: ResourceQuery, id: string, enabled: boolean): Promise<SkillDetail> {
    const { item, source: origin } = await this.find(query, id)
    if (!item.canToggle) throw new ResourceError(403, 'This skill is controlled by its package, a broader deny rule, or a read-only source')
    if (query.harness === 'pi') {
      const settingsPath = origin.scope === 'global' ? join(this.environment.piDir, 'settings.json') : join(origin.cwd ?? '', '.pi', 'settings.json')
      await this.files.update(settingsPath, (value) => {
        const excluded = `!${item.filePath}`
        const configured = strings(value['skills']).filter((path) => path !== excluded)
        if (!enabled) configured.push(excluded)
        value['skills'] = configured
      })
    } else {
      const settingsPath = origin.scope === 'global' ? join(this.environment.claudeDir, 'settings.json') : join(origin.cwd ?? '', '.claude', 'settings.json')
      await this.files.update(settingsPath, (value) => {
        value['skillOverrides'] = { ...record(value['skillOverrides']), [item.name]: enabled ? 'on' : 'off' }
      })
    }
    return await this.get(query, id)
  }

  async delete(query: ResourceQuery, id: string): Promise<void> {
    const { item } = await this.find(query, id)
    if (!item.canDelete) throw new ResourceError(403, 'Only a writable local skill directory can be deleted')
    if ((await lstat(item.path)).isSymbolicLink()) throw new ResourceError(403, 'Linked skill directories are read-only')
    await rm(item.path, { recursive: true })
  }

  async upload(query: ResourceQuery, scope: 'global' | 'project', entries: ReadonlyMap<string, Uint8Array>): Promise<SkillDetail> {
    const cwd = scope === 'project' ? await canonicalDirectory(query.cwd ?? '') : null
    const base = query.harness === 'pi' ? this.environment.piDir : this.environment.claudeDir
    const root = scope === 'global' ? join(base, 'skills') : join(cwd ?? '', query.harness === 'pi' ? '.pi' : '.claude', 'skills')
    const skillEntry = [...entries.keys()].filter((path) => path.endsWith('/SKILL.md') && path.split('/').length === 2)
    if (skillEntry.length !== 1) throw new ResourceError(422, 'Archive must contain one top-level skill directory with SKILL.md')
    const name = skillEntry[0]?.split('/')[0] ?? ''
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)) throw new ResourceError(422, 'Skill folder name must use lowercase letters, numbers and hyphens')
    const outside = [...entries.keys()].find((path) => !path.startsWith(`${name}/`))
    if (outside !== undefined) throw new ResourceError(422, `Archive must contain only one skill directory. Move "${outside}" inside "${name}/" or remove it.`)
    const markdown = entries.get(`${name}/SKILL.md`)
    if (markdown === undefined) throw new ResourceError(422, 'Missing SKILL.md')
    if (markdown.length > 1024 * 1024) throw new ResourceError(413, 'SKILL.md must be 1 MB or smaller')
    if (markdown.includes(0)) throw new ResourceError(415, 'SKILL.md must be a text file')
    const { frontmatter } = parseFrontmatter(Buffer.from(markdown).toString('utf8'))
    if (frontmatter['name'] !== name || typeof frontmatter['description'] !== 'string' || !frontmatter['description'].trim()) {
      throw new ResourceError(422, 'SKILL.md must declare a matching name and a non-empty description')
    }
    await mkdir(root, { recursive: true })
    if ((await lstat(root)).isSymbolicLink()) throw new ResourceError(403, 'Linked skill directories are read-only')
    const target = join(root, name)
    try { await mkdir(target) } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') throw new ResourceError(409, 'A skill with this folder name already exists')
      throw error
    }
    try {
      for (const [path, data] of entries) {
        const destination = resolve(root, path)
        if (!inside(target, destination)) throw new ResourceError(422, 'Archive path escapes the skill')
        await mkdir(dirname(destination), { recursive: true })
        await writeFile(destination, data, { flag: 'wx', mode: 0o600 })
      }
    } catch (error) { await rm(target, { recursive: true, force: true }); throw error }
    const listed = await this.list(query)
    const item = listed.groups.flatMap((group) => group.items).find((entry) => entry.filePath === join(target, 'SKILL.md'))
    if (item === undefined) throw new ResourceError(422, 'Uploaded skill is not discoverable by the provider')
    return await this.get(query, item.id)
  }

  private async find(query: ResourceQuery, id: string): Promise<{ item: SkillSummary; source: ResourceSource }> {
    for (const group of (await this.list(query)).groups) {
      const item = group.items.find((entry) => entry.id === id)
      if (item !== undefined) return { item, source: group.source }
    }
    throw new ResourceError(404, 'Skill no longer exists in this context')
  }

  private async tree(root: string, prefix = '', total: SkillFile[] = []): Promise<SkillFile[]> {
    if (prefix.split('/').length > 32) throw new ResourceError(413, 'Skill file tree is too deep')
    for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
      if (entry.name === '.git') continue
      if (total.length >= 2000) throw new ResourceError(413, 'Skill contains too many files')
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) await this.tree(root, path, total)
      else if (entry.isFile()) total.push({ path, size: (await stat(join(root, path))).size })
    }
    return total.sort((a, b) => a.path.localeCompare(b.path))
  }

  private group(result: ResourceList<SkillSummary>, origin: ResourceSource): ResourceGroup<SkillSummary> {
    let group = result.groups.find((entry) => entry.source.id === origin.id)
    if (group === undefined) { group = { source: origin, items: [] }; result.groups.push(group) }
    return group
  }

  private async add(result: ResourceList<SkillSummary>, origin: ResourceSource, path: string, enabled: boolean, canToggle: boolean, nameOverride?: string): Promise<void> {
    const group = this.group(result, origin)
    const id = resourceId(origin.id, path)
    if (group.items.some((item) => item.id === id)) return
    try {
      const { frontmatter } = parseFrontmatter(await readText(path))
      const root = dirname(path)
      const name = nameOverride ?? (typeof frontmatter['name'] === 'string' ? frontmatter['name'] : basename(root))
      const linked = (await lstat(root)).isSymbolicLink() || (await lstat(path)).isSymbolicLink()
      const nativeDirectory = origin.origin === 'directory' && basename(path) === 'SKILL.md' && dirname(root) === origin.path
      group.items.push({ id, sourceId: origin.id, name,
        description: typeof frontmatter['description'] === 'string' ? frontmatter['description'] : '',
        path: root, filePath: path, enabled, canToggle: canToggle && !linked,
        canDelete: nativeDirectory && origin.writable && !linked,
        toggleDescription: origin.harness === 'claude' ? 'Controls native skillOverrides by name in this scope. New sessions use the updated setting.' : 'Controls this file through Pi skill exclusions. New sessions use the updated setting.' })
    } catch (error) { result.diagnostics.push({ path, message: error instanceof Error ? error.message : 'Cannot read skill' }) }
  }

  private async claude(cwd: string, result: ResourceList<SkillSummary>): Promise<void> {
    const settings = await resolveSettings({ cwd })
    const deny = settings.effective.permissions?.deny ?? []
    const blockedAll = deny.some((entry) => entry === 'Skill' || entry === 'Skill(*)')
    const roots = [{ path: join(this.environment.claudeDir, 'skills'), cwd: null },
      ...(await ancestors(cwd)).map((dir) => ({ path: join(dir, '.claude', 'skills'), cwd: dir }))]
    for (const root of roots) {
      if (root.cwd !== null && root.cwd !== cwd && !(await exists(root.path))) continue
      const origin = await source('claude', root.cwd === null ? 'global' : 'project', 'directory', root.path, root.cwd, root.cwd === null ? 'Global · Claude skills' : `Project · ${root.cwd}`, true, true)
      this.group(result, origin)
      try {
        for (const path of await skillFiles(root.path, true)) {
          const { frontmatter } = parseFrontmatter(await readText(path))
          const name = typeof frontmatter['name'] === 'string' ? frontmatter['name'] : basename(dirname(path))
          const denied = blockedAll || deny.includes(`Skill(${name})`)
          const enabled = !denied && settings.effective.skillOverrides?.[name] !== 'off'
          await this.add(result, origin, path, enabled, origin.writable && !denied)
        }
      } catch (error) { result.diagnostics.push({ path: root.path, message: error instanceof Error ? error.message : 'Cannot list skills' }) }
    }
    for (const plugin of await claudePlugins(this.files, this.environment, cwd, result.diagnostics)) {
      for (const root of pluginComponentPaths(plugin, 'skills', 'skills')) {
        const origin = await source('claude', plugin.scope, 'plugin', root, plugin.cwd, plugin.name)
        try { for (const path of await skillFiles(root, true)) await this.add(result, origin, path, plugin.enabled, false) } catch (error) {
          result.diagnostics.push({ path: root, message: error instanceof Error ? error.message : 'Cannot read plugin skills' })
        }
      }
    }
  }

  private async pi(cwd: string, result: ResourceList<SkillSummary>): Promise<void> {
    const settingsManager = SettingsManager.create(cwd, this.environment.piDir)
    const manager = new DefaultPackageManager({ cwd, agentDir: this.environment.piDir, settingsManager })
    const resolved = await manager.resolve((name) => {
      result.diagnostics.push({ path: name, message: 'Configured package is not installed; discovery skipped installation' })
      return Promise.resolve('skip')
    })
    for (const error of settingsManager.drainErrors()) result.diagnostics.push({ path: error.scope, message: error.error.message })
    const roots = [
      { path: join(this.environment.piDir, 'skills'), cwd: null, writable: true },
      { path: join(homedir(), '.agents/skills'), cwd: null, writable: false },
      { path: join(cwd, '.pi/skills'), cwd, writable: true },
      ...(await ancestors(cwd)).map((dir) => ({ path: join(dir, '.agents/skills'), cwd: dir, writable: false })),
    ]
    for (const root of roots.filter((entry) => entry.writable)) {
      this.group(result, await source('pi', root.cwd === null ? 'global' : 'project', 'directory', root.path, root.cwd, root.cwd === null ? 'Global · Pi skills' : `Project · ${root.cwd}`, true, true))
    }
    const resources = [...resolved.skills.filter((item) => !/^npm:pi-mcp-adapter(?:@|$)/u.test(item.metadata.source)), {
      path: join(bundledPiAdapterPath, 'skills'), enabled: true,
      metadata: { source: 'npm:pi-mcp-adapter@2.32.1', scope: 'user' as const, origin: 'package' as const, baseDir: bundledPiAdapterPath },
    }]
    for (const resource of resources) {
      const native = roots.find((root) => inside(root.path, resource.path))
      const packaged = resource.metadata.origin === 'package'
      const global = resource.metadata.scope === 'user'
      const label = packaged ? resource.metadata.source : native === undefined ? `${global ? 'Global' : 'Project'} · ${dirname(resource.path)}` : native.cwd === null ? `Global · ${native.writable ? 'Pi' : '.agents'} skills` : `Project · ${native.cwd}`
      const origin = await source('pi', global ? 'global' : 'project', packaged ? 'package' : native?.writable ? 'directory' : native ? 'shared' : 'settings',
        packaged ? resource.metadata.baseDir ?? dirname(resource.path) : native?.path ?? dirname(resource.path),
        global ? null : native?.cwd ?? cwd, label, !packaged && native?.writable === true, !packaged && native?.writable === true)
      const loaded = loadSkills({ cwd, agentDir: this.environment.piDir, skillPaths: [resource.path], includeDefaults: false })
      for (const diagnostic of loaded.diagnostics) result.diagnostics.push({ path: resource.path, message: diagnostic.message })
      for (const skill of loaded.skills) await this.add(result, origin, skill.filePath, resource.enabled, origin.writable, skill.name)
    }
  }
}

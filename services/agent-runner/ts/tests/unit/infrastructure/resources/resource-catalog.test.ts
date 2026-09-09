import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { unzipSync, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LocalResourceService } from '../../../../src/infrastructure/resources/local-resource-service.js'
import { validateMcpDefinition } from '../../../../src/infrastructure/resources/mcp-catalog.js'
import { ResourceFiles } from '../../../../src/infrastructure/resources/resource-files.js'
import { readSkillArchive } from '../../../../src/infrastructure/resources/skill-archives.js'

const skillText = (name: string) => `---\nname: ${name}\ndescription: A fixture skill\n---\n# ${name}\n`
function present<T>(value: T | undefined): T { assert.ok(value !== undefined); return value }
const archive = (name: string) => Buffer.from(zipSync({ [`${name}/SKILL.md`]: Buffer.from(skillText(name)), [`${name}/references/readme.md`]: Buffer.from('Reference') }))

describe('resource catalog', () => {
  let root: string
  let cwd: string
  let other: string
  let claudeDir: string
  let piDir: string
  let service: LocalResourceService
  const json = async (path: string, value: unknown) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, JSON.stringify(value)) }

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'priva-resources-')))
    cwd = join(root, 'project')
    other = join(root, 'other')
    claudeDir = join(root, 'claude')
    piDir = join(root, 'pi')
    for (const path of [join(cwd, '.git'), join(other, '.git'), claudeDir, piDir]) await mkdir(path, { recursive: true })
    vi.stubEnv('CLAUDE_CONFIG_DIR', claudeDir)
    vi.stubEnv('PI_CODING_AGENT_DIR', piDir)
    service = new LocalResourceService({ activeCwd: cwd, claudeDir, piDir, discoverProjects: () => Promise.resolve([other, cwd, join(root, 'gone')]) })
  })

  afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) })

  it('keeps source identities and local > project > global precedence without a model profile', async () => {
    await json(join(claudeDir, '.claude.json'), { theme: 'dark', mcpServers: { same: { command: 'global' } }, projects: { [cwd]: { trusted: true, mcpServers: { same: { command: 'local' } } } } })
    await json(join(cwd, '.mcp.json'), { mcpServers: { same: { command: 'project' } } })
    const query = { harness: 'claude' as const, cwd }
    const list = await service.mcp.list(query)
    expect(list.projects).toEqual([cwd, other])
    const items = list.groups.flatMap((group) => group.items)
    expect(new Set(items.map((item) => item.id)).size).toBe(3)
    expect(items.filter((item) => item.effective).map((item) => item.target)).toEqual(['local'])
    const project = present(list.groups.find((group) => group.source.scope === 'project')?.items[0])
    expect(await service.mcp.get(query, project.id)).toMatchObject({ definition: { command: 'project' }, effectiveDefinition: { command: 'local' } })
    const local = present(list.groups.find((group) => group.source.scope === 'local')?.items[0])
    await service.mcp.delete(query, local.id)
    expect(await service.mcp.get(query, project.id)).toMatchObject({ effective: true, effectiveDefinition: { command: 'project' } })
    expect(JSON.parse(await readFile(join(claudeDir, '.claude.json'), 'utf8'))).toMatchObject({ theme: 'dark', projects: { [cwd]: { trusted: true, mcpServers: {} } } })
    expect((await service.mcp.list({ harness: 'claude' })).groups.flatMap((group) => group.items).every((item) => item.effective === null)).toBe(true)
  })

  it('canonicalizes project writes, detects external same-count edits, and preserves sibling fields', async () => {
    const query = { harness: 'claude' as const, cwd: `${cwd}/` }
    const created = await service.mcp.create(query, { scope: 'project', name: 'server', definition: { url: 'https://first.example/mcp' } })
    expect(created.source.cwd).toBe(cwd)
    await json(join(cwd, '.mcp.json'), { retained: { value: 1 }, mcpServers: { server: { command: 'second' }, sibling: { command: 'keep' } } })
    expect((await service.mcp.get(query, created.id)).definition).toEqual({ command: 'second' })
    await service.mcp.update(query, created.id, { command: 'third', args: [] })
    expect(JSON.parse(await readFile(join(cwd, '.mcp.json'), 'utf8'))).toEqual({ retained: { value: 1 }, mcpServers: { server: { command: 'third', args: [] }, sibling: { command: 'keep' } } })
    await expect(service.mcp.create(query, { scope: 'project', name: 'server', definition: { command: 'duplicate' } })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('uses Pi field merges while retaining partial declarations by source', async () => {
    await json(join(piDir, 'mcp.json'), { mcpServers: { fixture_merge: { command: 'node', args: ['global'], env: { ONE: '1' } } } })
    await json(join(cwd, '.pi/mcp.json'), { mcpServers: { fixture_merge: { args: ['project'], env: { TWO: '2' }, disabled: true } } })
    const query = { harness: 'pi' as const, cwd }
    const list = await service.mcp.list(query)
    const group = present(list.groups.find((group) => group.source.path === join(cwd, '.pi/mcp.json')))
    const detail = await service.mcp.get(query, present(group.items[0]).id)
    expect(detail.definition).toEqual({ args: ['project'], env: { TWO: '2' }, disabled: true })
    expect(detail.effectiveDefinition).toMatchObject({ command: 'node', args: ['project'], disabled: true })
    expect(detail.effective).toBe(true)
    expect(detail.enabled).toBe(false)
  })

  it.each(['claude', 'pi'] as const)('uploads, previews, excludes and deletes a native %s skill', async (harness) => {
    const query = { harness, cwd }
    const uploaded = await service.uploadSkill(query, 'project', 'fixture.zip', archive('fixture-skill'))
    expect(uploaded).toMatchObject({ name: 'fixture-skill', canToggle: true, canDelete: true, enabled: true })
    expect(uploaded.files.map((file) => file.path)).toEqual(['references/readme.md', 'SKILL.md'].sort((a, b) => a.localeCompare(b)))
    expect((await service.skills.file(query, uploaded.id, 'references/readme.md')).content).toBe('Reference')
    await expect(service.skills.file(query, uploaded.id, '../../outside')).rejects.toMatchObject({ statusCode: 403 })
    await writeFile(join(root, 'private'), 'private')
    await symlink(join(root, 'private'), join(uploaded.path, 'linked'))
    await expect(service.skills.file(query, uploaded.id, 'linked')).rejects.toMatchObject({ statusCode: 403 })
    expect(await service.skills.toggle(query, uploaded.id, false)).toMatchObject({ enabled: false })
    expect(await service.skills.toggle(query, uploaded.id, true)).toMatchObject({ enabled: true })
    const download = await service.downloadSkill(query, uploaded.id)
    expect(Object.keys(unzipSync(download.data))).toEqual(expect.arrayContaining(['fixture-skill/SKILL.md', 'fixture-skill/references/readme.md']))
    await expect(service.uploadSkill(query, 'project', 'fixture.zip', archive('fixture-skill'))).rejects.toMatchObject({ statusCode: 409 })
    await service.skills.delete(query, uploaded.id)
    await expect(service.skills.get(query, uploaded.id)).rejects.toMatchObject({ statusCode: 404 })
  })

  it.each(['claude', 'pi'] as const)('imports a macOS archive into %s without installing metadata', async (harness) => {
    const data = Buffer.from(zipSync({
      'fixture-skill/SKILL.md': Buffer.from(skillText('fixture-skill')),
      'fixture-skill/references/readme.md': Buffer.from('Reference'),
      '__MACOSX/fixture-skill/._SKILL.md': Buffer.from('AppleDouble metadata'),
      'fixture-skill/.DS_Store': Buffer.from('Finder metadata'),
    }))
    const query = { harness, cwd }
    const uploaded = await service.uploadSkill(query, 'project', 'macos.zip', data)
    expect(uploaded.name).toBe('fixture-skill')
    expect(uploaded.files.map((file) => file.path)).toEqual(['references/readme.md', 'SKILL.md'].sort((a, b) => a.localeCompare(b)))
    const downloaded = await service.downloadSkill(query, uploaded.id)
    expect(Object.keys(unzipSync(downloaded.data)).sort()).toEqual(['fixture-skill/SKILL.md', 'fixture-skill/references/readme.md'].sort())
  })

  it('rejects real files outside the skill directory before creating it', async () => {
    const data = Buffer.from(zipSync({ 'fixture-skill/SKILL.md': Buffer.from(skillText('fixture-skill')), 'README.md': Buffer.from('Outside the skill') }))
    const upload = service.uploadSkill({ harness: 'pi', cwd }, 'project', 'extra.zip', data)
    await expect(upload).rejects.toMatchObject({ statusCode: 422 })
    await expect(upload).rejects.toThrow('README.md')
    await expect(readFile(join(cwd, '.pi/skills/fixture-skill/SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports malformed source JSON without hiding other sources and treats linked configs as read-only', async () => {
    await writeFile(join(cwd, '.mcp.json'), '{ broken')
    await json(join(claudeDir, '.claude.json'), { mcpServers: { good: { command: 'node' } } })
    const list = await service.mcp.list({ harness: 'claude', cwd })
    expect(list.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ path: join(cwd, '.mcp.json') })]))
    expect(list.groups.flatMap((group) => group.items).map((item) => item.name)).toContain('good')
    await rm(join(cwd, '.mcp.json'))
    await symlink(join(claudeDir, '.claude.json'), join(cwd, '.mcp.json'))
    const linked = present((await service.mcp.list({ harness: 'claude', cwd })).groups.find((group) => group.source.scope === 'project'))
    expect(linked.source.writable).toBe(false)
    await expect(service.mcp.delete({ harness: 'claude', cwd }, present(linked.items[0]).id)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('stores Pi SSE transport in the adapter native field and rejects orphan partial overrides', async () => {
    expect(validateMcpDefinition({ type: 'sse', url: 'https://example.com/sse' }, 'pi')).toEqual({ httpTransport: 'sse', url: 'https://example.com/sse' })
    await expect(service.mcp.create({ harness: 'pi', cwd }, { name: 'orphan-override', scope: 'project', definition: { disabled: true } })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('keeps explicitly configured Pi skill paths in their global source', async () => {
    const custom = join(root, 'custom', 'configured-skill')
    await mkdir(custom, { recursive: true })
    await writeFile(join(custom, 'SKILL.md'), skillText('configured-skill'))
    await json(join(piDir, 'settings.json'), { skills: [custom] })
    const group = present((await service.skills.list({ harness: 'pi', cwd })).groups.find((group) => group.items.some((item) => item.name === 'configured-skill')))
    expect(group.source).toMatchObject({ scope: 'global', cwd: null, origin: 'settings' })
    expect(group.source.label).toMatch(/^Global/u)
  })

  it('serializes edits to the same JSONC file without losing fields', async () => {
    const path = join(root, 'settings.json')
    await writeFile(path, '{ // retained\n "theme": "dark",\n}')
    const files = new ResourceFiles()
    await Promise.all([files.update(path, (value) => { value['first'] = 1 }), files.update(path, (value) => { value['second'] = 2 })])
    expect(await files.json(path)).toEqual({ theme: 'dark', first: 1, second: 2 })
  })

  it('rejects unsafe archives and invalid skills before creating a directory', async () => {
    await expect(readSkillArchive('unsafe.zip', Buffer.from(zipSync({ '../escape': Buffer.from('x') })))).rejects.toMatchObject({ statusCode: 422 })
    await expect(readSkillArchive('bomb.zip', Buffer.from(zipSync({ 'skill/big': new Uint8Array(6 * 1024 * 1024) })))).rejects.toMatchObject({ statusCode: 413 })
    await expect(readSkillArchive('corrupt.zip', Buffer.from('invalid'))).rejects.toMatchObject({ statusCode: 422 })
    await expect(service.uploadSkill({ harness: 'pi', cwd }, 'project', 'bad.zip', Buffer.from(zipSync({ 'bad/SKILL.md': Buffer.from('no frontmatter') })))).rejects.toMatchObject({ statusCode: 422 })
  })
})

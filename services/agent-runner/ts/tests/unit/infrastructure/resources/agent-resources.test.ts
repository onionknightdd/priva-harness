import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalResourceService } from '../../../../src/infrastructure/resources/local-resource-service.js'
import { agentMarkdown } from '../../../../src/infrastructure/resources/resource-markdown.js'

function required<T>(value: T | undefined): T {
  expect(value).toBeDefined()
  if (value === undefined) throw new Error('Expected fixture entry')
  return value
}

describe('subagent and memory resources', () => {
  let root: string
  let cwd: string
  let other: string
  let piDir: string
  let claudeDir: string
  let service: LocalResourceService
  const file = async (path: string, text: string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text) }
  const agent = (description: string, extra = {}) => agentMarkdown({ name: 'reviewer', description, ...extra }, 'Review the supplied changes.')

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'agent-resources-')))
    cwd = join(root, 'project'); other = join(root, 'other'); piDir = join(root, 'pi'); claudeDir = join(root, 'claude')
    for (const path of [join(cwd, '.git'), join(other, '.git'), piDir, claudeDir]) await mkdir(path, { recursive: true })
    vi.stubEnv('PI_CODING_AGENT_DIR', piDir); vi.stubEnv('CLAUDE_CONFIG_DIR', claudeDir)
    vi.stubEnv('CLAUDE_CODE_DISABLE_AUTO_MEMORY', ''); vi.stubEnv('PI_CODE_DISABLE_AUTO_MEMORY', '')
    service = new LocalResourceService({ activeCwd: cwd, claudeDir, piDir, discoverProjects: () => Promise.resolve([other]) })
  })
  afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) })

  it('keeps Pi native default/global/shared/project sources and identifies project overrides', async () => {
    await file(join(piDir, 'agents/reviewer.md'), agent('Global'))
    await file(join(cwd, '.agents/agents/shared.md'), agent('Shared'))
    await file(join(cwd, '.pi/agents/authoritative.md'), agent('Project'))
    const list = await service.subagents.list({ harness: 'pi', cwd })
    expect(list.diagnostics).toEqual([])
    const items = list.groups.flatMap((group) => group.items).filter((item) => item.name === 'reviewer')
    expect(items).toHaveLength(3)
    expect(items.filter((item) => item.effective).map((item) => item.description)).toEqual(['Project'])
    expect(list.groups[0]?.source.level).toBe('default')
    expect(list.groups.find((group) => group.source.origin === 'shared')?.source.writable).toBe(false)
    expect((await service.subagents.list({ harness: 'pi' })).groups.flatMap((group) => group.items).every((item) => item.effective === null)).toBe(true)
    expect((await service.subagents.list({ harness: 'pi', cwd: other })).groups.flatMap((group) => group.items).find((item) => item.name === 'reviewer')).toMatchObject({ description: 'Global', effective: true })
  })

  it.each(['claude', 'pi'] as const)('creates, renames, edits and deletes %s agents without clobbering external changes', async (harness) => {
    const query = { harness, cwd }
    const list = await service.subagents.list(query)
    const source = required(list.groups.find((group) => group.source.cwd === cwd && group.source.canAdd)).source
    const created = await service.subagents.create(query, { sourceId: source.id, definition: { name: 'new-agent', description: 'New', memory: 'project' }, prompt: 'Do one thing well.' })
    expect(created).toMatchObject({ effective: true, source: { cwd } })
    const edited = await service.subagents.update(query, created.id, { definition: { ...created.definition, name: 'renamed', description: 'Changed' }, prompt: 'An edited prompt', revision: created.revision })
    expect(edited.name).toBe('renamed')
    expect((await service.subagents.get(query, edited.id)).prompt).toBe('An edited prompt')
    await expect(service.subagents.update(query, edited.id, { ...edited, revision: created.revision })).rejects.toMatchObject({ statusCode: 409 })
    await expect(service.subagents.get({ harness: harness === 'pi' ? 'claude' : 'pi', cwd }, edited.id)).rejects.toMatchObject({ statusCode: 404 })
    await service.subagents.delete(query, edited.id, edited.revision)
    await expect(service.subagents.get(query, edited.id)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('reports malformed agents and refuses fields from the wrong harness', async () => {
    await file(join(cwd, '.pi/agents/broken.md'), '---\nname: [\n---\nbroken')
    const query = { harness: 'pi' as const, cwd }
    const list = await service.subagents.list(query)
    expect(list.diagnostics).toHaveLength(1)
    const sourceId = required(list.groups.find((group) => group.source.canAdd && group.source.cwd === cwd)).source.id
    await expect(service.subagents.create(query, { sourceId, definition: { name: 'test', description: 'Test', maxTurns: 3 }, prompt: 'Test' })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('uses the plugin BOM parser and includes linked agents as read-only', async () => {
    await file(join(root, 'shared.md'), `\uFEFF${agent('BOM agent', { tools: 'none' })}`)
    await mkdir(join(cwd, '.pi/agents'), { recursive: true })
    await symlink(join(root, 'shared.md'), join(cwd, '.pi/agents/linked.md'))
    const query = { harness: 'pi' as const, cwd }
    const selected = required((await service.subagents.list(query)).groups.flatMap((group) => group.items).find((item) => item.name === 'reviewer'))
    const detail = await service.subagents.get(query, selected.id)
    expect(detail).toMatchObject({ source: { writable: false }, definition: { tools: 'none' }, description: 'BOM agent' })
    await expect(service.subagents.update(query, detail.id, { ...detail, prompt: 'Overwrite' })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('lists native Pi instructions, lazily edits missing instructions and rejects stale saves', async () => {
    await file(join(piDir, 'AGENTS.md'), 'Global rules')
    await file(join(cwd, 'CLAUDE.md'), 'Project fallback')
    await file(join(cwd, 'AGENTS.md'), 'Project winner')
    const query = { harness: 'pi' as const, cwd }
    const list = await service.memory.list(query)
    const items = list.groups.flatMap((group) => group.items)
    expect(items.find((item) => item.path === join(cwd, 'CLAUDE.md'))?.enabled).toBe(false)
    const selected = required(items.find((item) => item.path === join(cwd, 'AGENTS.md')))
    const detail = await service.memory.get(query, selected.id)
    await file(detail.path, 'External changes')
    await expect(service.memory.update(query, detail.id, 'Overwrite', detail.revision)).rejects.toMatchObject({ statusCode: 409 })
    const emptyQuery = { harness: 'pi' as const, cwd: other }
    const empty = required((await service.memory.list(emptyQuery)).groups.flatMap((group) => group.items).find((item) => item.path === join(other, 'AGENTS.md')))
    const blank = await service.memory.get(emptyQuery, empty.id)
    await service.memory.update(emptyQuery, empty.id, 'New instructions', blank.revision)
    expect(await readFile(blank.path, 'utf8')).toBe('New instructions')
  })

  it('keeps Pi and Claude auto-memory switches independent and shares Pi memory across subdirectories', async () => {
    // Empty env values should not claim control over the UI switch.
    delete process.env['PI_CODE_DISABLE_AUTO_MEMORY']
    await file(join(cwd, '.pi/settings.json'), JSON.stringify({ theme: 'dark' }))
    const query = { harness: 'pi' as const, cwd }
    const first = required((await service.memory.list(query)).autoMemory[0])
    expect(first.enabled).toBe(true)
    await service.memory.toggle(query, false)
    expect(JSON.parse(await readFile(join(cwd, '.pi/settings.json'), 'utf8'))).toEqual({ theme: 'dark', autoMemoryEnabled: false })
    expect(required((await service.memory.list({ harness: 'claude', cwd })).autoMemory[0]).enabled).toBe(true)
    await service.memory.toggle(query, true)
    await file(join(first.path, 'MEMORY.md'), '# Saved\n- topic')
    const nested = join(cwd, 'src'); await mkdir(nested)
    expect(required((await service.memory.list({ harness: 'pi', cwd: nested })).autoMemory[0]).path).toBe(first.path)
    const saved = required((await service.memory.list(query)).groups.flatMap((group) => group.items).find((item) => item.kind === 'auto'))
    const detail = await service.memory.get(query, saved.id)
    await service.memory.update(query, detail.id, '# Curated', detail.revision)
    const updated = await service.memory.get(query, detail.id)
    await service.memory.delete(query, updated.id, updated.revision)
    await expect(service.memory.get(query, saved.id)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('never replaces linked instruction files', async () => {
    await file(join(root, 'elsewhere.md'), 'Keep this')
    await symlink(join(root, 'elsewhere.md'), join(cwd, 'CLAUDE.md'))
    const query = { harness: 'claude' as const, cwd }
    const selected = required((await service.memory.list(query)).groups.flatMap((group) => group.items).find((item) => item.path === join(cwd, 'CLAUDE.md')))
    const detail = await service.memory.get(query, selected.id)
    await expect(service.memory.update(query, detail.id, 'Replace', detail.revision)).rejects.toMatchObject({ statusCode: 403 })
    expect(await readFile(join(root, 'elsewhere.md'), 'utf8')).toBe('Keep this')
  })
})

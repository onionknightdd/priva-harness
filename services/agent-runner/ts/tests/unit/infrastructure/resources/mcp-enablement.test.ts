import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectTrustStore } from '@earendil-works/pi-coding-agent'

import { LocalResourceService } from '../../../../src/infrastructure/resources/local-resource-service.js'

describe('native MCP enablement', () => {
  let root: string
  let cwd: string
  let other: string
  let claudeDir: string
  let piDir: string
  let service: LocalResourceService
  const json = async (path: string, value: unknown) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value)) }
  const read = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'priva-mcp-policy-')))
    cwd = join(root, 'project'); other = join(root, 'other'); claudeDir = join(root, 'claude'); piDir = join(root, 'pi')
    for (const path of [join(cwd, '.git'), join(other, '.git'), claudeDir, piDir]) await mkdir(path, { recursive: true })
    new ProjectTrustStore(piDir).set(cwd, true)
    new ProjectTrustStore(piDir).set(other, true)
    vi.stubEnv('CLAUDE_CONFIG_DIR', claudeDir)
    vi.stubEnv('PI_CODING_AGENT_DIR', piDir)
    service = new LocalResourceService({ activeCwd: cwd, claudeDir, claudeConfigFilePath: join(claudeDir, '.claude.json'), piDir, discoverProjects: () => Promise.resolve([other]) })
  })
  afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) })

  it('persists project server and tool switches without changing definitions, approvals or sibling settings', async () => {
    const query = { harness: 'claude' as const, cwd }
    const settings = join(cwd, '.claude/settings.json')
    await json(settings, { enableAllProjectMcpServers: true, permissions: { allow: ['Read'], deny: ['Write'] }, env: { KEEP: 'yes' } })
    const detail = await service.mcp.create(query, { scope: 'project', name: 'files', definition: { command: 'unused' } })
    const original = await read(join(cwd, '.mcp.json'))
    expect(await service.mcp.toggleTool(query, detail.id, 'write_file', false)).toMatchObject({ enabled: false, canToggle: true })
    expect(await service.mcp.tools(query, detail.id, ['read_file', 'write_file'])).toMatchObject([{ enabled: true }, { enabled: false }])
    expect(await service.mcp.toggle(query, detail.id, false)).toMatchObject({ enabled: false, canToggle: true })
    await expect(service.capabilities(query, { id: detail.id })).rejects.toMatchObject({ statusCode: 409 })
    expect(await service.mcp.toggle(query, detail.id, true)).toMatchObject({ enabled: true })
    await expect(service.callTool(query, { id: detail.id, name: 'write_file', args: {} })).rejects.toMatchObject({ statusCode: 403 })
    expect(await read(settings)).toMatchObject({ enableAllProjectMcpServers: true, permissions: { allow: ['Read'], deny: ['Write', 'mcp__files__write_file'] }, env: { KEEP: 'yes' } })
    expect(await read(join(cwd, '.mcp.json'))).toEqual(original)
    expect(await service.mcp.toggleTool(query, detail.id, 'write_file', true)).toMatchObject({ enabled: true })
    expect((await read(settings))['permissions']).toEqual({ allow: ['Read'], deny: ['Write'] })
  })

  it('keeps global choices independent of project choices and cannot override another settings scope', async () => {
    const query = { harness: 'claude' as const }
    const global = await service.mcp.create(query, { name: 'files', definition: { command: 'unused' } })
    await json(join(cwd, '.claude/settings.json'), { deniedMcpServers: [{ serverName: 'files' }] })
    expect(await service.mcp.get(query, global.id)).toMatchObject({ enabled: true })
    expect(await service.mcp.get({ ...query, cwd }, global.id)).toMatchObject({ enabled: false, canToggle: false })
    await service.mcp.toggle(query, global.id, false)
    expect(await read(join(claudeDir, 'settings.json'))).toMatchObject({ deniedMcpServers: [{ serverName: 'files' }] })
    const project = await service.mcp.create({ ...query, cwd: other }, { scope: 'project', name: 'files', definition: { command: 'other' } })
    expect(project).toMatchObject({ enabled: false, canToggle: false })
    await expect(service.mcp.toggle({ ...query, cwd: other }, project.id, true)).rejects.toMatchObject({ statusCode: 403 })
    await service.mcp.toggle(query, global.id, true)
    expect(await service.mcp.get({ ...query, cwd: other }, project.id)).toMatchObject({ enabled: true })
    expect(await service.mcp.get({ ...query, cwd }, global.id)).toMatchObject({ enabled: false })
  })

  it('reads and clears project /mcp and approval rejections while retaining other native choices', async () => {
    const query = { harness: 'claude' as const, cwd }
    const detail = await service.mcp.create(query, { scope: 'project', name: 'files', definition: { command: 'unused' } })
    await json(join(claudeDir, '.claude.json'), { theme: 'dark', projects: { [cwd]: { disabledMcpServers: ['files', 'keep'], hasTrustDialogAccepted: true }, [other]: { disabledMcpServers: ['files'] } } })
    await json(join(cwd, '.claude/settings.json'), { disabledMcpjsonServers: ['files', 'other'] })
    expect(await service.mcp.get(query, detail.id)).toMatchObject({ enabled: false, canToggle: true })
    expect(await service.mcp.toggle(query, detail.id, true)).toMatchObject({ enabled: true })
    expect(await read(join(claudeDir, '.claude.json'))).toMatchObject({ theme: 'dark', projects: { [cwd]: { disabledMcpServers: ['keep'], hasTrustDialogAccepted: true }, [other]: { disabledMcpServers: ['files'] } } })
    expect(await read(join(cwd, '.claude/settings.json'))).toMatchObject({ disabledMcpjsonServers: ['other'] })
  })

  it('respects broad tool denies, exact inherited denies, canonical names and read-only policy files', async () => {
    const query = { harness: 'claude' as const, cwd }
    const detail = await service.mcp.create(query, { scope: 'project', name: 'files.test', definition: { command: 'unused' } })
    await json(join(claudeDir, 'settings.json'), { permissions: { deny: ['mcp__files_test__write_*', 'mcp__files_test__remove'] } })
    for (const tool of ['write_file', 'remove']) {
      expect(await service.mcp.tools(query, detail.id, [tool])).toMatchObject([{ enabled: false, canToggle: false }])
      await expect(service.mcp.toggleTool(query, detail.id, tool, true)).rejects.toMatchObject({ statusCode: 403 })
    }
    await service.mcp.toggleTool(query, detail.id, 'read.file', false)
    expect(await read(join(cwd, '.claude/settings.json'))).toMatchObject({ permissions: { deny: ['mcp__files_test__read_file'] } })
    await expect(service.mcp.toggleTool(query, detail.id, '*', false)).rejects.toMatchObject({ statusCode: 422 })
    await rm(join(cwd, '.claude/settings.json'))
    await symlink(join(claudeDir, 'settings.json'), join(cwd, '.claude/settings.json'))
    expect(await service.mcp.get(query, detail.id)).toMatchObject({ canToggle: false })
    await expect(service.mcp.toggle(query, detail.id, false)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('matches native command and URL restrictions and transport-specific allowlists', async () => {
    const query = { harness: 'claude' as const, cwd }
    const http = await service.mcp.create(query, { scope: 'project', name: 'http', definition: { url: 'https://mcp.example.com:8443/tools' } })
    await json(join(cwd, '.claude/settings.json'), { deniedMcpServers: [{ serverUrl: 'https://mcp.example.com/*' }] })
    expect(await service.mcp.get(query, http.id)).toMatchObject({ enabled: true })
    await json(join(cwd, '.claude/settings.json'), { deniedMcpServers: [{ serverUrl: 'https://MCP.EXAMPLE.COM.:*/*' }] })
    expect(await service.mcp.get(query, http.id)).toMatchObject({ enabled: false, canToggle: false })
    await json(join(cwd, '.claude/settings.json'), { allowedMcpServers: [{ serverName: 'http' }, { serverUrl: 'https://elsewhere.example/*' }] })
    expect(await service.mcp.get(query, http.id)).toMatchObject({ enabled: false, canToggle: false })
    const stdio = await service.mcp.create(query, { scope: 'project', name: 'stdio', definition: { command: 'node', args: ['test.js'] } })
    await json(join(cwd, '.claude/settings.json'), { deniedMcpServers: [{ serverCommand: ['node', 'test.js'] }] })
    expect(await service.mcp.get(query, stdio.id)).toMatchObject({ enabled: false, canToggle: false })
  })

  it('uses native Pi enabled/toolExposure and retains exposure rules and credentials', async () => {
    const query = { harness: 'pi' as const, cwd }
    const detail = await service.mcp.create(query, { scope: 'project', name: 'files', definition: { command: 'node', env: { KEEP: 'yes' }, exposure: 'hidden', toolExposure: { 'read_*': 'codemode', read_secret: 'hidden', write_file: 'direct' } } })
    expect(await service.mcp.toggleTool(query, detail.id, 'write_file', false)).toMatchObject({ enabled: false, canToggle: true })
    await service.mcp.toggle(query, detail.id, false)
    expect(await service.mcp.toggle(query, detail.id, true)).toMatchObject({ enabled: true })
    expect(await service.mcp.tools(query, detail.id, ['read_file', 'write_file', 'delete_file'])).toMatchObject([{ enabled: true }, { enabled: false }, { enabled: false, canToggle: true }])
    await service.mcp.toggleTool(query, detail.id, 'write_file', true)
    expect(await read(join(cwd, '.pi/mcp.json'))).toMatchObject({ mcpServers: { files: { env: { KEEP: 'yes' }, exposure: 'hidden', toolExposure: { 'read_*': 'codemode', read_secret: 'hidden', write_file: 'codemode' }, enabled: true } } })
  })
})

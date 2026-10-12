import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LocalResourceService } from '../../../src/infrastructure/resources/local-resource-service.js'

const execute = promisify(execFile)
const bootstrap = resolve('docker/configure-computer.mjs')
const desktopEnv = {
  DISPLAY: ':99', XAUTHORITY: '/tmp/priva-desktop/Xauthority',
  DBUS_SESSION_BUS_ADDRESS: 'unix:path=/tmp/priva-desktop/bus',
  XDG_RUNTIME_DIR: '/tmp/priva-desktop', XDG_CURRENT_DESKTOP: 'XFCE', XDG_SESSION_TYPE: 'x11',
}

async function json(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value))
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'))
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value))
  return value as Record<string, unknown>
}

describe('container computer MCP bootstrap', () => {
  let root: string
  let claudeDir: string
  let piDir: string
  let claudePath: string
  let piPath: string
  let env: NodeJS.ProcessEnv

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'computer-bootstrap-')))
    claudeDir = join(root, 'claude')
    piDir = join(root, 'pi')
    claudePath = join(claudeDir, '.claude.json')
    piPath = join(piDir, 'mcp.json')
    env = { ...process.env, ...desktopEnv, HOME: root, CLAUDE_CONFIG_DIR: claudeDir, PI_CODING_AGENT_DIR: piDir,
      ANTHROPIC_API_KEY: 'do-not-copy-model-credentials' }
  })

  afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) })

  const configure = () => execute(process.execPath, [bootstrap], { env })

  it('seeds discoverable native MCP entries and skills for both providers without leaking model credentials', async () => {
    await configure()
    const definition = { command: '/usr/local/bin/cua-driver', args: ['mcp', '--direct'], env: desktopEnv }
    expect(await readJson(claudePath)).toEqual({ mcpServers: { computer: { ...definition, type: 'stdio', alwaysLoad: true } } })
    expect(await readJson(piPath)).toEqual({ mcpServers: { computer: { ...definition, lifecycle: 'eager' } } })
    const sourceSkill = await readFile(resolve('docker/skills/computer-desktop/SKILL.md'), 'utf8')
    for (const directory of [claudeDir, piDir]) {
      const skill = join(directory, 'skills/computer-desktop/SKILL.md')
      expect(await readFile(skill, 'utf8')).toBe(sourceSkill)
      expect((await stat(skill)).mode & 0o777).toBe(0o600)
    }
    for (const path of [claudePath, piPath]) {
      expect((await stat(path)).mode & 0o777).toBe(0o600)
      expect(await readFile(path, 'utf8')).not.toContain('do-not-copy-model-credentials')
    }

    const cwd = join(root, 'workspace')
    await mkdir(cwd)
    vi.stubEnv('HOME', root)
    vi.stubEnv('CLAUDE_CONFIG_DIR', claudeDir)
    vi.stubEnv('PI_CODING_AGENT_DIR', piDir)
    const resources = new LocalResourceService({ claudeDir, claudeConfigFilePath: claudePath, piDir,
      activeCwd: cwd, discoverProjects: () => Promise.resolve([]) })
    for (const harness of ['claude', 'pi'] as const) {
      const list = await resources.mcp.list({ harness, cwd })
      expect(list.groups.flatMap((group) => group.items)).toContainEqual(expect.objectContaining({
        name: 'computer', enabled: true, effective: true, target: '/usr/local/bin/cua-driver', transport: 'stdio',
      }))
      const skills = await resources.skills.list({ harness, cwd })
      expect(skills.groups.flatMap((group) => group.items)).toContainEqual(expect.objectContaining({ name: 'computer-desktop' }))
    }
  })

  it('retains unrelated native settings and accepts the existing Pi JSONC dictionary spelling', async () => {
    const claude = { theme: 'dark', projects: { '/workspace': { hasTrustDialogAccepted: true } },
      mcpServers: { existing: { command: 'other' } } }
    await json(claudePath, claude)
    await mkdir(piDir)
    await writeFile(piPath, '{ /* user MCP settings */ "mcp-servers": { "existing": { "command": "other" }, }, "settings": { "toolPrefix": "server" }, }')
    await configure()
    expect(await readJson(claudePath)).toMatchObject(claude)
    expect(await readJson(piPath)).toMatchObject({ 'mcp-servers': { existing: { command: 'other' }, computer: { command: '/usr/local/bin/cua-driver' } }, settings: { toolPrefix: 'server' } })
    expect((await readJson(piPath))['mcpServers']).toBeUndefined()
    expect(await readdir(claudeDir)).not.toEqual(expect.arrayContaining([expect.stringContaining('.tmp')]))
  })

  it('never rewrites an existing computer definition, disabled entry, policy, or user skill on restart', async () => {
    const claude = { mcpServers: { computer: { command: 'my-computer', args: ['custom'] } }, disabledMcpServers: ['computer'] }
    const pi = { mcpServers: { computer: { disabled: true } }, settings: { directTools: false } }
    await json(claudePath, claude)
    await json(piPath, pi)
    const skill = join(piDir, 'skills/computer-desktop/SKILL.md')
    await mkdir(dirname(skill), { recursive: true })
    await writeFile(skill, 'My existing desktop skill\n')
    const before = await stat(piPath)
    await configure()
    await configure()
    expect(await readFile(claudePath, 'utf8')).toBe(JSON.stringify(claude))
    expect(await readFile(piPath, 'utf8')).toBe(JSON.stringify(pi))
    expect((await stat(piPath)).mtimeMs).toBe(before.mtimeMs)
    expect(await readFile(skill, 'utf8')).toBe('My existing desktop skill\n')
  })

  it.each(['{ broken', '[]', '{"mcpServers":[]}', '{"mcpServers":null}', '{"mcpServers":{"computer":null}}'])('rejects invalid configuration before changing the other provider: %s', async (invalid) => {
    await json(claudePath, { mcpServers: { existing: { command: 'keep' } } })
    await mkdir(piDir)
    await writeFile(piPath, invalid)
    const before = await readFile(claudePath, 'utf8')
    await expect(configure()).rejects.toThrow(/desktop MCP|MCP server dictionary/u)
    expect(await readFile(piPath, 'utf8')).toBe(invalid)
    expect(await readFile(claudePath, 'utf8')).toBe(before)
    expect(await readdir(piDir)).toEqual(['mcp.json'])
  })

  it('rejects linked configuration instead of overwriting the link or its target', async () => {
    const target = join(root, 'linked.json')
    await json(target, { mcpServers: {} })
    await mkdir(piDir)
    await symlink(target, piPath)
    await expect(configure()).rejects.toThrow('Expected a regular configuration file')
    expect(await readJson(target)).toEqual({ mcpServers: {} })
    await expect(stat(claudePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('requires explicit desktop and configuration paths before touching native configuration', async () => {
    delete env['DISPLAY']
    await expect(configure()).rejects.toThrow('DISPLAY is required')
    env['DISPLAY'] = ':99'
    env['CLAUDE_CONFIG_DIR'] = 'relative/path'
    await expect(configure()).rejects.toThrow('CLAUDE_CONFIG_DIR must be an absolute directory')
    expect(await readdir(root)).toEqual([])
  })
})

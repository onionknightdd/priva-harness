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
    env = { ...desktopEnv, HOME: root, PATH: process.env['PATH'], CLAUDE_CONFIG_DIR: claudeDir, PI_CODING_AGENT_DIR: piDir,
      ANTHROPIC_API_KEY: 'do-not-copy-model-credentials' }
  })

  afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) })

  const configure = () => execute(process.execPath, [bootstrap], { env })

  async function mountRuntime(surfaces?: string): Promise<void> {
    const runtime = join(root, 'runtime')
    env['PRIVA_CUA_RUNTIME'] = runtime
    if (surfaces) env['CUA_REPL_ENABLED_SURFACES'] = surfaces
    await json(join(runtime, 'manifest.json'), { arch: process.arch, platform: process.platform })
    const paths = ['bin/node', 'bin/node_repl', 'lib/node_modules/@oai/cua-repl/bin/cua-repl.mjs']
    if (surfaces !== 'browser') {
      const driverPath = 'bin/sky'
      paths.push(driverPath)
      env['OAI_SKY_LINUX_BIN'] = join(runtime, driverPath)
    }
    for (const path of paths) {
      await mkdir(dirname(join(runtime, path)), { recursive: true })
      await writeFile(join(runtime, path), '', { mode: 0o700 })
    }
  }

  it.each([undefined, 'browser,computer'])('skips both old providers in a fresh HOME with original computer surface %s', async (surfaces) => {
    await mountRuntime(surfaces)
    delete env['DISPLAY']
    await configure()
    await configure()
    expect(await readdir(root)).toEqual(['runtime'])
  })

  it.each(['browser', 'remote'])('keeps Xfce MCP and skill for %s-only deployments', async (mode) => {
    if (mode === 'browser') await mountRuntime('browser')
    else {
      env['PRIVA_COMPUTER_HOST_KEY'] = join(root, 'host-key-fixture')
      env['PRIVA_COMPUTER_DEVICES'] = 'fixture-device'
    }
    await configure()
    for (const [file, directory] of [[claudePath, claudeDir], [piPath, piDir]] as const) {
      expect(await readJson(file)).toMatchObject({ mcpServers: { computer: { command: '/usr/local/bin/cua-driver' } } })
      expect(await readFile(join(directory, 'skills/computer-desktop/SKILL.md'), 'utf8')).toContain('Xfce')
    }
  })

  it.each(['codemode', 'eager'])('retires only the exact Runner resources from a %s HOME', async (piMode) => {
    await configure()
    const sourceSkill = await readFile(resolve('docker/skills/computer-desktop/SKILL.md'), 'utf8')
    const oldSkill = sourceSkill.replace(
      "use `codemode` to call the discovered `mcp__computer__*` tools. Forward the\nMCP image block with `image(block)` when inspecting a screenshot.",
      "the `mcp` tool can discover and call the server's tools.",
    )
    if (piMode === 'eager') expect(oldSkill).not.toBe(sourceSkill)
    for (const [file, dir] of [[claudePath, claudeDir], [piPath, piDir]] as const) {
      const current = await readJson(file)
      const servers = current['mcpServers'] as Record<string, Record<string, unknown>>
      if (file === piPath && piMode === 'eager') {
        const computer = servers['computer']
        assert.ok(computer)
        delete computer['exposure']
        computer['lifecycle'] = 'eager'
        await writeFile(join(dir, 'skills/computer-desktop/SKILL.md'), oldSkill)
      }
      await json(file, { ...current, preference: 17, mcpServers: { other: { command: 'other' }, ...servers } })
      const otherSkill = join(dir, 'skills/other/SKILL.md')
      await mkdir(dirname(otherSkill))
      await writeFile(otherSkill, 'keep')
    }
    await mountRuntime()
    await configure()
    for (const [file, dir] of [[claudePath, claudeDir], [piPath, piDir]] as const) {
      expect(await readJson(file)).toEqual({ preference: 17, mcpServers: { other: { command: 'other' } } })
      expect(await readdir(join(dir, 'skills/computer-desktop'))).toEqual([])
      expect(await readFile(join(dir, 'skills/other/SKILL.md'), 'utf8')).toBe('keep')
    }
    const before = await stat(piPath)
    await configure()
    expect((await stat(piPath)).mtimeMs).toBe(before.mtimeMs)
  })

  it('keeps user edits, Claude JSONC comments, and customized or extended skill directories byte-for-byte', async () => {
    await configure()
    const claude = (await readFile(claudePath, 'utf8')).replace('{', '{\n  // Keep my settings')
    await writeFile(claudePath, claude)
    const pi = (await readFile(piPath, 'utf8')).replace('":99"', '":47"')
    await writeFile(piPath, pi)
    const claudeSkill = join(claudeDir, 'skills/computer-desktop/SKILL.md')
    const piSkill = join(piDir, 'skills/computer-desktop/SKILL.md')
    await writeFile(claudeSkill, 'My desktop skill')
    const originalSkill = await readFile(piSkill)
    await writeFile(join(dirname(piSkill), 'notes.md'), 'my notes')
    await mountRuntime()
    const { stderr } = await configure()
    expect(stderr).toContain('Keeping user-managed desktop MCP')
    expect(stderr).toContain('Keeping customized desktop skill')
    expect(await readFile(claudePath, 'utf8')).toBe(claude)
    expect(await readFile(piPath, 'utf8')).toBe(pi)
    expect(await readFile(claudeSkill, 'utf8')).toBe('My desktop skill')
    expect(await readFile(piSkill)).toEqual(originalSkill)
    expect(await readFile(join(dirname(piSkill), 'notes.md'), 'utf8')).toBe('my notes')
  })

  it('leaves every existing resource intact when the provisioned runtime fails descriptor validation', async () => {
    await configure()
    const paths = [claudePath, piPath, ...[claudeDir, piDir].map((dir) => join(dir, 'skills/computer-desktop/SKILL.md'))]
    const before = await Promise.all(paths.map((path) => readFile(path)))
    await mountRuntime()
    await json(join(root, 'runtime/manifest.json'), { platform: process.platform, arch: 'invalid-architecture' })
    await expect(configure()).rejects.toThrow('this Runner needs')
    expect(await Promise.all(paths.map((path) => readFile(path)))).toEqual(before)
  })

  it('preserves duplicate keys, exact numbers, and linked skill directories during takeover', async () => {
    await configure()
    const claude = (await readFile(claudePath, 'utf8')).replace('{', '{"preference": 1, "preference": 2,')
    const pi = (await readFile(piPath, 'utf8')).replace('{', '{"userNumber": 9007199254740993,')
    await writeFile(claudePath, claude)
    await writeFile(piPath, pi)
    const skillDirectory = join(piDir, 'skills/computer-desktop')
    const saved = await readFile(join(skillDirectory, 'SKILL.md'))
    const target = join(root, 'shared-skill')
    await mkdir(target)
    await writeFile(join(target, 'SKILL.md'), saved)
    await rm(skillDirectory, { recursive: true })
    await symlink(target, skillDirectory, 'dir')
    await mountRuntime()
    const { stderr } = await configure()
    expect(stderr).toContain('Keeping linked or customized skill directory')
    expect(await readFile(claudePath, 'utf8')).toBe(claude)
    expect(await readFile(piPath, 'utf8')).toBe(pi)
    expect(await readFile(join(target, 'SKILL.md'))).toEqual(saved)
  })

  it('seeds discoverable native MCP entries and skills for both providers without leaking model credentials', async () => {
    await configure()
    const definition = { command: '/usr/local/bin/cua-driver', args: ['mcp', '--direct'], env: desktopEnv }
    expect(await readJson(claudePath)).toEqual({ mcpServers: { computer: { ...definition, type: 'stdio', alwaysLoad: true } } })
    expect(await readJson(piPath)).toEqual({ mcpServers: { computer: { ...definition, exposure: 'codemode' } } })
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

  it('retains unrelated native settings and existing native Pi servers', async () => {
    const claude = { theme: 'dark', projects: { '/workspace': { hasTrustDialogAccepted: true } },
      mcpServers: { existing: { command: 'other' } } }
    await json(claudePath, claude)
    await mkdir(piDir)
    await json(piPath, { mcpServers: { existing: { command: 'other' } }, autoEnableCodemode: true })
    await configure()
    expect(await readJson(claudePath)).toMatchObject(claude)
    expect(await readJson(piPath)).toMatchObject({ mcpServers: { existing: { command: 'other' }, computer: { command: '/usr/local/bin/cua-driver' } }, autoEnableCodemode: true })
    expect((await readJson(piPath))['mcp-servers']).toBeUndefined()
    expect(await readdir(claudeDir)).not.toEqual(expect.arrayContaining([expect.stringContaining('.tmp')]))
  })

  it('never rewrites an existing computer definition, disabled entry, policy, or user skill on restart', async () => {
    const claude = { mcpServers: { computer: { command: 'my-computer', args: ['custom'] } }, disabledMcpServers: ['computer'] }
    const pi = { mcpServers: { computer: { command: 'my-computer', enabled: false, toolExposure: { click: 'hidden' } } } }
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

  it.each(['{ broken', '{ /* JSONC */ }', '{"mcp-servers":{}}', '{"settings":{}}', '{"mcpServers":{"computer":{"command":"custom","disabled":true}}}', '{"mcpServers":{"computer":{"command":"custom","lifecycle":"eager"}}}', '[]', '{"mcpServers":[]}', '{"mcpServers":null}', '{"mcpServers":{"computer":null}}'])('rejects invalid configuration before changing the other provider: %s', async (invalid) => {
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

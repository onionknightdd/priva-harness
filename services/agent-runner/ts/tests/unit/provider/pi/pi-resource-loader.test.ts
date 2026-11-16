import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'
import { SettingsManager } from '@earendil-works/pi-coding-agent'
import { createPiResourceLoader } from '../../../../src/provider/pi/pi-resource-loader.js'

it('loads the Pi host extensions with their ESM compatibility and TypeBox subpaths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-loader-test-'))
  try {
    const loader = await createPiResourceLoader(root, join(root, 'agent'), SettingsManager.inMemory())
    expect(loader.getExtensions().errors).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 15000)

it('calls native MCP through codemode, isolates projects and closes connections on shutdown', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', import.meta.resolve('tsx'), 'tests/fixtures/resources/pi-mcp-probe.ts'], { timeout: 30000 })
  expect(stdout).toContain('isolated cwd, native codemode calls, hidden tools and nested events passed')
}, 35000)

it('rejects obsolete MCP flags before loading a connection and keeps the config intact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-old-mcp-'))
  try {
    const agentDir = join(root, 'agent')
    await mkdir(agentDir)
    await writeFile(join(agentDir, 'mcp.json'), JSON.stringify({ mcpServers: { legacy: { command: 'must-not-run', disabled: true } } }))
    await expect(createPiResourceLoader(root, agentDir, SettingsManager.inMemory())).rejects.toThrow('obsolete Pi MCP adapter fields disabled')
  } finally { await rm(root, { recursive: true, force: true }) }
})


it('discovers selected product skills and their relative resources without changing other resources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-plugin-loader-'))
  try {
    const agentDir = join(root, 'agent')
    const on = await createPiResourceLoader(root, agentDir, SettingsManager.inMemory(), undefined, [], [], ['agent-dashboard'])
    const selected = on.getSkills().skills.find((skill) => skill.name === 'agent-dashboard')
    expect(selected).toBeDefined()
    if (!selected) throw new Error('Selected product skill was not discovered')
    expect(await readFile(selected.filePath, 'utf8')).toContain('a2ui:regional-sales')
    expect(await readFile(join(dirname(selected.filePath), 'resource/catalog.md'), 'utf8')).toContain('Table')
    const off = await createPiResourceLoader(root, agentDir, SettingsManager.inMemory())
    expect(off.getSkills().skills.some((skill) => skill.name === 'agent-dashboard')).toBe(false)
    expect(on.getSkills().skills.filter((skill) => skill.name !== 'agent-dashboard')).toEqual(off.getSkills().skills)
    expect(on.getExtensions().extensions.map((extension) => extension.path)).toEqual(off.getExtensions().extensions.map((extension) => extension.path))
  } finally { await rm(root, { recursive: true, force: true }) }
}, 15000)

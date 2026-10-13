import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

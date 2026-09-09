import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { SettingsManager } from '@earendil-works/pi-coding-agent'
import { createPiResourceLoader } from '../../../../src/provider/pi/pi-resource-loader.js'

it('loads the Pi MCP adapter with its ESM compatibility and TypeBox subpaths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-loader-test-'))
  try {
    const loader = await createPiResourceLoader(root, join(root, 'agent'), SettingsManager.inMemory())
    expect(loader.getExtensions().errors).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 15000)

it('binds the adapter once per project and closes real MCP connections on shutdown', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', import.meta.resolve('tsx'), 'tests/fixtures/resources/pi-mcp-probe.ts'], { timeout: 30000 })
  expect(stdout).toContain('isolated cwd, single adapter and real tool calls passed')
}, 35000)

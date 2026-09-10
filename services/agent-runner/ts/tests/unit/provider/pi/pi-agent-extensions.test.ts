import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsManager } from '@earendil-works/pi-coding-agent'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it, vi } from 'vitest'
import { createPiResourceLoader } from '../../../../src/provider/pi/pi-resource-loader.js'
import { piMemoryModule } from '../../../../src/provider/pi/pi-agent-extensions.js'

it('binds the real memory extension and writes only to each selected project store', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', import.meta.resolve('tsx'), 'tests/fixtures/resources/pi-memory-probe.ts'], { timeout: 20000 })
  expect(stdout).toContain('independent settings and isolated stores passed')
}, 25000)

it('uses the selected project for each plugin factory without changing process.cwd or sharing registries', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pi-agent-extensions-')))
  const before = process.cwd()
  const agentDir = join(root, 'agent')
  vi.stubEnv('PI_CODING_AGENT_DIR', agentDir)
  try {
    const make = async (name: string) => {
      const cwd = join(root, name)
      await mkdir(join(cwd, '.pi/agents'), { recursive: true })
      await writeFile(join(cwd, '.pi/agents/worker.md'), `---\nname: ${name}\ndescription: Only in ${name}\n---\nDo the task.`)
      await writeFile(join(cwd, '.pi/subagents.json'), JSON.stringify({ toolDescriptionMode: 'custom' }))
      await writeFile(join(cwd, '.pi/agent-tool-description.md'), `${name} delegates to {{typeList}}`)
      return await createPiResourceLoader(cwd, agentDir, SettingsManager.create(cwd, agentDir))
    }
    const [a, b] = await Promise.all([make('alpha'), make('bravo')])
    const descriptions = [a, b].map((loader) => loader.getExtensions().extensions.flatMap((extension) => [...extension.tools.values()]).find((tool) => tool.definition.name === 'Agent')?.definition.description)
    expect(descriptions[0]).toContain('alpha delegates')
    expect(descriptions[0]).not.toContain('Only in bravo')
    expect(descriptions[1]).toContain('bravo delegates')
    expect(descriptions[1]).not.toContain('Only in alpha')
    expect(process.cwd()).toBe(before)
    expect(a.getExtensions().extensions.flatMap((extension) => [...extension.tools.keys()]).filter((name) => name === 'memory')).toHaveLength(1)
  } finally { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) }
}, 20000)

it('loads only pi-code memory, honors Pi user/project settings and omits the extension when disabled', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pi-memory-extension-')))
  const agentDir = join(root, 'agent')
  vi.stubEnv('PI_CODING_AGENT_DIR', agentDir)
  vi.stubEnv('CLAUDE_CONFIG_DIR', join(root, 'claude'))
  vi.stubEnv('CLAUDE_CODE_DISABLE_AUTO_MEMORY', '1')
  try {
    await mkdir(join(root, '.pi'), { recursive: true })
    await writeFile(join(root, '.pi/settings.json'), JSON.stringify({ autoMemoryEnabled: false }))
    const loader = await createPiResourceLoader(root, agentDir, SettingsManager.create(root, agentDir))
    const names = loader.getExtensions().extensions.flatMap((extension) => [...extension.tools.keys()])
    expect(names).not.toContain('memory')
    expect(names).toContain('Agent')
    expect(names).not.toContain('SubagentWorkflow')
    const memory = await piMemoryModule(root)
    expect(memory.memorySettingsFiles(root, root, true)).toEqual([join(agentDir, 'settings.json'), join(root, '.pi/settings.json')])
    expect(memory.readMemorySettings(memory.memorySettingsFiles(root, root, true))).toEqual({ autoMemoryEnabled: false })
  } finally { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) }
}, 20000)

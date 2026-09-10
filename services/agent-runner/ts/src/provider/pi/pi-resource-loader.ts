import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DefaultPackageManager, DefaultResourceLoader, type ExtensionFactory, type SettingsManager } from '@earendil-works/pi-coding-agent'
import { createJiti } from 'jiti'
import { loadMcpConfig } from 'pi-mcp-adapter/config'
import type { McpConfig } from 'pi-mcp-adapter/types'
import { piMemoryModule, piSubagentFactory, piCodeRoot, subagentsRoot } from './pi-agent-extensions.js'

const require = createRequire(import.meta.url)
const adapterEntry = require.resolve('pi-mcp-adapter')
const adapterRoot = dirname(adapterEntry)
// The adapter ships TS for Pi's source loader; the production Node entry must support it too.
const jiti = createJiti(import.meta.url, {
  alias: {
    '@earendil-works/pi-ai/compat': fileURLToPath(import.meta.resolve('@earendil-works/pi-ai/compat')),
    '@earendil-works/pi-tui': fileURLToPath(import.meta.resolve('@earendil-works/pi-tui')),
    '@earendil-works/pi-coding-agent': fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent')),
    'typebox/value': require.resolve('typebox/value'),
    typebox: require.resolve('typebox'),
  },
})
let adapter: Promise<{ createMcpAdapter: (options: { config: McpConfig }) => ExtensionFactory }> | undefined

export async function createPiResourceLoader(cwd: string, agentDir: string, settingsManager: SettingsManager): Promise<DefaultResourceLoader> {
  adapter ??= jiti.import(adapterEntry)
  const { createMcpAdapter } = await adapter
  const manager = new DefaultPackageManager({ cwd, agentDir, settingsManager })
  const resolved = await manager.resolve()
  // Filter before loading: filtering afterward would already execute a second adapter instance.
  const extensionPaths = resolved.extensions.filter((item) => item.enabled && !isMcpAdapter(item.path, item.metadata.source)
    && !isHostAgentExtension(item.path, item.metadata.source)).map((item) => item.path)
  const memory = await piMemoryModule(cwd)
  const settings = { ...settingsManager.getGlobalSettings(), ...(settingsManager.isProjectTrusted() ? settingsManager.getProjectSettings() : {}) } as Record<string, unknown>
  const memoryEnabled = memory.autoMemoryEnabled(settings['autoMemoryEnabled'], { CLAUDE_CODE_DISABLE_AUTO_MEMORY: process.env['PI_CODE_DISABLE_AUTO_MEMORY'] })
  const extensionFactories = [
    { name: 'pi-mcp-adapter', factory: createMcpAdapter({ config: loadMcpConfig(join(agentDir, 'mcp.json'), cwd) }) },
    { name: '@tintinweb/pi-subagents', factory: await piSubagentFactory(cwd) },
    ...(memoryEnabled ? [{ name: 'pi-code-memory', factory: memory.default }] : []),
  ]
  const loader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager,
    noExtensions: true,
    additionalExtensionPaths: extensionPaths,
    additionalSkillPaths: [join(adapterRoot, 'skills')],
    extensionFactories,
  })
  await loader.reload()
  const errors = loader.getExtensions().errors
  if (errors.length > 0) throw new Error(`Pi extension loading failed: ${errors.map((error) => `${error.path}: ${error.error}`).join('; ')}`)
  return loader
}

function isHostAgentExtension(path: string, source: string): boolean {
  return path.startsWith(subagentsRoot) || path.startsWith(piCodeRoot)
    || /(?:^|[/\\])(?:pi-code|@tintinweb[/\\]pi-subagents)(?:[/\\]|$)/u.test(path)
    || /^npm:(?:pi-code|@tintinweb\/pi-subagents)(?:@|$)/u.test(source)
}

function isMcpAdapter(path: string, source: string): boolean {
  return path === adapterEntry || /(?:^|[/\\])pi-mcp-adapter(?:[/\\]|$)/u.test(path) || /^npm:pi-mcp-adapter(?:@|$)/u.test(source)
}

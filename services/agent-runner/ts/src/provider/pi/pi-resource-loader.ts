import { createMcpExtension, createToolSearchExtension, DefaultPackageManager, DefaultResourceLoader, type ExtensionFactory, type EventBus, type InlineExtension, type SettingsManager } from '@earendil-works/pi-coding-agent'
import { assertNativePiMcpConfiguration } from '../../pi-config.js'
import { piMemoryModule, piSubagentFactory, piCodeRoot, subagentsRoot } from './pi-agent-extensions.js'
import { createProductCodemodeExtension } from './pi-codemode-extension.js'

export async function createPiResourceLoader(cwd: string, agentDir: string, settingsManager: SettingsManager, eventBus?: EventBus, hostExtensions: InlineExtension[] = [], appendSystemPrompt: readonly string[] = []): Promise<DefaultResourceLoader> {
  const configured = [...settingsManager.getExtensionPaths(), ...settingsManager.getPackages().map((entry) => typeof entry === 'string' ? entry : entry.source)]
  if (configured.some((entry) => /(?:^|[/\\:]|npm:)pi-mcp-adapter(?:[/\\@]|$)/u.test(entry))) throw new Error('Remove pi-mcp-adapter from Pi settings before starting native MCP; the adapter replaces native /mcp support')
  const manager = new DefaultPackageManager({ cwd, agentDir, settingsManager })
  const resolved = await manager.resolve()
  const extensionPaths = resolved.extensions.filter((item) => item.enabled && !isHostAgentExtension(item.path, item.metadata.source)).map((item) => item.path)
  const memory = await piMemoryModule(cwd)
  const settings = { ...settingsManager.getGlobalSettings(), ...(settingsManager.isProjectTrusted() ? settingsManager.getProjectSettings() : {}) } as Record<string, unknown>
  const memoryEnabled = memory.autoMemoryEnabled(settings['autoMemoryEnabled'], { CLAUDE_CODE_DISABLE_AUTO_MEMORY: process.env['PI_CODE_DISABLE_AUTO_MEMORY'] })
  const nativeMcp: ExtensionFactory = async (api) => {
    // Factories run again on /reload, before native MCP can connect these files.
    await assertNativePiMcpConfiguration(cwd, agentDir, settingsManager.isProjectTrusted())
    await createMcpExtension()(api)
  }
  await assertNativePiMcpConfiguration(cwd, agentDir, settingsManager.isProjectTrusted())
  const extensionFactories = [
    ...hostExtensions,
    { name: 'codemode', factory: createProductCodemodeExtension() },
    { name: 'tool_search', factory: createToolSearchExtension() },
    { name: 'mcp', factory: nativeMcp },
    { name: '@tintinweb/pi-subagents', factory: await piSubagentFactory(cwd) },
    ...(memoryEnabled ? [{ name: 'pi-code-memory', factory: memory.default }] : []),
  ]
  const loader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager, ...(eventBus ? { eventBus } : {}),
    noExtensions: true,
    additionalExtensionPaths: extensionPaths,
    extensionFactories,
    ...(appendSystemPrompt.length > 0 ? { appendSystemPrompt: [...appendSystemPrompt] } : {}),
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

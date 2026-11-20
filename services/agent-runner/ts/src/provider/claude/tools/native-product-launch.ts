import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProviderRunSpec, SessionTarget } from '../../../core/contract/agent-provider.js'
import type { ToolDefinition } from '../../../core/tool/define-tool.js'
import { WHITEBOARD_ENDPOINT_ENV } from '../../../core/tool/whiteboard.js'
import type { NativeProductConfig } from './native-product-server.js'
import { computerMcpServers } from '../../../core/plugin/computer-use.js'

export async function writeNativeProductConfig(scratchDir: string, target: SessionTarget, spec: ProviderRunSpec, tools: readonly ToolDefinition[],
  computerServers: ReturnType<typeof computerMcpServers> = computerMcpServers(spec.enabledPluginIds ?? [])): Promise<string[]> {
  if (!tools.length && !Object.keys(computerServers).length) return []
  const mcpPath = join(scratchDir, 'product-mcp.json')
  if (!tools.length) {
    await writeFile(mcpPath, JSON.stringify({ mcpServers: computerServers }), { mode: 0o600 })
    return ['--mcp-config', mcpPath]
  }
  const source = import.meta.url.endsWith('.ts')
  const entry = fileURLToPath(new URL(`./native-product-server.${source ? 'ts' : 'js'}`, import.meta.url))
  const configPath = join(scratchDir, 'product-tools.json')
  const config: NativeProductConfig = { cwd: spec.cwd,
    sessionId: target.kind === 'resume' ? target.session.id : target.sessionId ?? '',
    tools: tools.map((tool) => tool.name), ...(spec.imageTools ? { profile: spec.imageTools } : {}) }
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 })
  await writeFile(mcpPath, JSON.stringify({ mcpServers: { ...computerServers, agentWorkshop: {
    type: 'stdio', command: process.execPath,
    args: [...(source ? ['--import', createRequire(import.meta.url).resolve('tsx')] : []), entry, configPath],
    alwaysLoad: true, timeout: 600000,
    ...(process.env[WHITEBOARD_ENDPOINT_ENV] ? { env: { [WHITEBOARD_ENDPOINT_ENV]: process.env[WHITEBOARD_ENDPOINT_ENV] } } : {}),
  } } }), { mode: 0o600 })
  return ['--mcp-config', mcpPath]
}

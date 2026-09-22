import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'

import type { ToolContext, ToolDefinition } from '../../../core/tool/define-tool.js'
import { productTools } from '../../../core/tool/product-tools.js'
import { readClaudeTerminalState } from '../claude-terminal-hooks.js'

export interface NativeProductConfig {
  readonly cwd: string
  readonly sessionId: string
  readonly tools: readonly string[]
  readonly profile?: ToolContext['profile']
}

/** The native CLI owns this stdio process, its calls, cancellation and transcript. */
export function createNativeProductServer(definitions: readonly ToolDefinition[], context: (signal: AbortSignal) => Promise<ToolContext>): McpServer {
  const server = new McpServer({ name: 'agentWorkshop', version: '1.0.0' })
  for (const definition of definitions) {
    const required = new Set(definition.inputSchema.required)
    const shape = Object.fromEntries(Object.entries(definition.inputSchema.properties).map(([name, property]) => {
      const field = z.string().describe(property.description ?? '')
      return [name, required.has(name) ? field : field.optional()]
    }))
    server.registerTool(definition.name, { description: definition.description, inputSchema: z.object(shape) }, async (args, request) => {
      const result = await definition.execute(args, await context(request.mcpReq.signal))
      return { content: [{ type: 'text', text: result.text }], isError: !result.ok }
    })
  }
  return server
}

async function main(configPath: string): Promise<void> {
  const config = JSON.parse(await readFile(configPath, 'utf8')) as NativeProductConfig
  const definitions = config.tools.map((name) => {
    const definition = productTools.find((tool) => tool.name === name)
    if (!definition) throw new Error(`Unknown native product tool: ${name}`)
    return definition
  })
  const shutdown = new AbortController()
  const server = createNativeProductServer(definitions, async (signal) => {
    // /clear, /resume, /fork and /cd can change the owning context without
    // restarting MCP. Resolve it for each call, never from the process cwd.
    const state = await readClaudeTerminalState(dirname(configPath))
    return { cwd: state?.cwd ?? config.cwd, session: { provider: 'claude', id: state?.sessionId ?? config.sessionId },
      signal: AbortSignal.any([signal, shutdown.signal]), ...(config.profile ? { profile: config.profile } : {}) }
  })
  for (const event of ['SIGTERM', 'SIGINT'] as const) process.once(event, () => { shutdown.abort(); void server.close() })
  process.stdin.once('end', () => { shutdown.abort(); void server.close() })
  await server.connect(new StdioServerTransport())
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = process.argv[2]
  if (!config) throw new Error('A private native product configuration file is required')
  await main(join(config))
}

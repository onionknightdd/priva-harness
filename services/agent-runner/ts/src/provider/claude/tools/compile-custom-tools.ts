import { createSdkMcpServer, tool, type Options } from '@anthropic-ai/claude-agent-sdk'
import { z, type ZodType } from 'zod'

import type { ToolContext, ToolDefinition, ToolJsonSchema } from '../../../core/tool/define-tool.js'
import { isRecord } from '../../../core/util/json-record.js'

export const PRODUCT_MCP_SERVER_NAME = 'agentWorkshop'
export const PRODUCT_MCP_TOOL_TIMEOUT_MS = 600_000

/** Progress text from a running product tool, with the tool that produced it. */
export type ToolProgressEmitter = (toolName: string, chunk: string) => void

export function compileClaudeCustomTools(
  tools: readonly ToolDefinition[],
  context: Omit<ToolContext, 'emitProgress'>,
  emitProgress?: ToolProgressEmitter,
): Pick<Options, 'mcpServers' | 'toolAliases'> {
  if (tools.length === 0) return {}
  return {
    mcpServers: {
      [PRODUCT_MCP_SERVER_NAME]: createSdkMcpServer({
        name: PRODUCT_MCP_SERVER_NAME,
        version: '1.0.0',
        alwaysLoad: true,
        timeout: PRODUCT_MCP_TOOL_TIMEOUT_MS,
        tools: tools.map((definition) => toClaudeTool(definition, context, emitProgress)),
      }),
    },
    toolAliases: Object.fromEntries(
      tools.map((definition) => [
        definition.name,
        `mcp__${PRODUCT_MCP_SERVER_NAME}__${definition.name}`,
      ]),
    ),
  }
}

function toClaudeTool(
  definition: ToolDefinition,
  context: Omit<ToolContext, 'emitProgress'>,
  emitProgress: ToolProgressEmitter | undefined,
) {
  return tool(
    definition.name,
    definition.description,
    zodShapeFromSchema(definition.inputSchema),
    async (args, extra) => {
      // The query-wide signal only fires on dispose. The call's own signal is
      // what an interrupted turn aborts, so a tool stops when its turn does.
      const callSignal = isRecord(extra) && extra['signal'] instanceof AbortSignal ? extra['signal'] : undefined
      const result = await definition.execute(toolArgs(args), {
        ...context,
        signal: callSignal === undefined ? context.signal : AbortSignal.any([context.signal, callSignal]),
        ...(emitProgress === undefined ? {} : { emitProgress: (chunk: string) => emitProgress(definition.name, chunk) }),
      })
      return {
        content: [{ type: 'text', text: result.text }],
        isError: !result.ok,
      }
    },
  )
}

function zodShapeFromSchema(schema: ToolJsonSchema): Record<string, ZodType> {
  const required = new Set(schema.required ?? [])
  const shape: Record<string, ZodType> = {}
  for (const [key, property] of Object.entries(schema.properties)) {
    const field =
      property.description === undefined || property.description === ''
        ? z.string()
        : z.string().describe(property.description)
    shape[key] = required.has(key) ? field : field.optional()
  }
  return shape
}

function toolArgs(args: unknown): Readonly<Record<string, unknown>> {
  return isRecord(args) ? args : {}
}

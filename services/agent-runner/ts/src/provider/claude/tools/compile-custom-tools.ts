import { createSdkMcpServer, tool, type Options } from '@anthropic-ai/claude-agent-sdk'
import { z, type ZodType } from 'zod'

import type { ToolContext, ToolDefinition, ToolJsonSchema } from '../../../core/tool/define-tool.js'
import { isRecord } from '../../../core/event/json-record.js'

export const PRODUCT_MCP_SERVER_NAME = 'priva'

export function compileClaudeCustomTools(
  tools: readonly ToolDefinition[],
  context: ToolContext,
): Pick<Options, 'mcpServers' | 'toolAliases'> {
  if (tools.length === 0) return {}
  return {
    mcpServers: {
      [PRODUCT_MCP_SERVER_NAME]: createSdkMcpServer({
        name: PRODUCT_MCP_SERVER_NAME,
        version: '1.0.0',
        alwaysLoad: true,
        tools: tools.map((definition) => toClaudeTool(definition, context)),
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

function toClaudeTool(definition: ToolDefinition, context: ToolContext) {
  return tool(
    definition.name,
    definition.description,
    zodShapeFromSchema(definition.inputSchema),
    async (args) => {
      const result = await definition.execute(toolArgs(args), context)
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

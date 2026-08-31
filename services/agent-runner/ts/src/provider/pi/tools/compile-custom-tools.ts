import { defineTool as definePiTool } from '@earendil-works/pi-coding-agent'

import { isRecord } from '../../../core/event/json-record.js'
import type { ToolContext, ToolDefinition } from '../../../core/tool/define-tool.js'

export function compilePiCustomTools(
  tools: readonly ToolDefinition[],
  context: ToolContext,
) {
  return tools.map((definition) =>
    definePiTool({
      name: definition.name,
      label: definition.name,
      description: definition.description,
      parameters: definition.inputSchema,
      execute(_toolCallId, params, signal) {
        return executePiTool(definition, params, signal, context)
      },
    }),
  )
}

async function executePiTool(
  definition: ToolDefinition,
  params: unknown,
  signal: AbortSignal | undefined,
  context: ToolContext,
) {
  const result = await definition.execute(isRecord(params) ? params : {}, {
    cwd: context.cwd,
    session: context.session,
    signal: signal ?? context.signal,
    ...(context.profile === undefined ? {} : { profile: context.profile }),
    ...(context.emitProgress === undefined ? {} : { emitProgress: context.emitProgress }),
  })
  return {
    content: [{ type: 'text' as const, text: result.text }],
    details: {},
    ...(result.ok ? {} : { isError: true as const }),
  }
}

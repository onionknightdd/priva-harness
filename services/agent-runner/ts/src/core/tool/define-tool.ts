import type { SessionRef } from '../contract/agent-provider.js'

export interface ToolJsonProperty {
  readonly type: 'string'
  readonly description?: string
}

export interface ToolJsonSchema {
  readonly type: 'object'
  readonly properties: Readonly<Record<string, ToolJsonProperty>>
  readonly required?: readonly string[]
}

export interface ToolContext {
  readonly cwd: string
  readonly session: SessionRef
  readonly signal: AbortSignal
}

export interface ToolResult {
  readonly ok: boolean
  readonly text: string
}

export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly inputSchema: ToolJsonSchema
  execute(
    input: Readonly<Record<string, unknown>>,
    context: ToolContext,
  ): Promise<ToolResult>
}

export function defineTool(definition: ToolDefinition): ToolDefinition {
  const name = definition.name.trim()
  if (name === '') {
    throw new Error('Tool name is required')
  }
  return { ...definition, name }
}

export function stringToolArg(
  input: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const value = input[key]
  return typeof value === 'string' ? value : ''
}

import type { SessionRef } from '../contract/agent-provider.js'
import type {
  ModelCapabilityCatalog,
} from '../resource/model-profile.js'

export type ImageToolProfile = {
  readonly baseUrl: string
  readonly authToken: string
  readonly imageUnderstandingModel: string | null
  readonly imageGenerationModel: string | null
  readonly imageEditModel: string | null
  readonly modelCapabilities: ModelCapabilityCatalog
}

export type ToolImageDelta = {
  readonly mime: string
  readonly b64: string
  readonly final: boolean
}

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
  readonly profile?: ImageToolProfile
  readonly streamImages?: boolean
  readonly emitImage?: (image: ToolImageDelta) => void
  readonly emitProgress?: (chunk: string) => void
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

export function stringListToolArg(
  input: Readonly<Record<string, unknown>>,
  key: string,
): string[] {
  const value = input[key]
  if (typeof value === 'string') {
    return value
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter((item) => item !== '')
  }
  if (!Array.isArray(value)) return []
  return value.flatMap((item) =>
    typeof item === 'string' ? stringListToolArg({ value: item }, 'value') : [])
}

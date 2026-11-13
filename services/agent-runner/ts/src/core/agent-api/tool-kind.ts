import {
  canonicalProductToolName,
  isImageEditToolName,
  isImageGenToolName,
  isImageReadToolName,
  isWorkflowName,
} from '../event/tool-names.js'

export const TOOL_KINDS = [
  'command',
  'file_read',
  'file_edit',
  'search',
  'web',
  'mcp',
  'question',
  'image',
  'visualize',
  'workflow',
  'other',
] as const

export type ToolKind = (typeof TOOL_KINDS)[number]

export interface ToolDescriptor {
  readonly name: string
  readonly kind: ToolKind
  readonly server?: string
}

const NATIVE_KINDS: Readonly<Record<string, ToolKind>> = {
  bash: 'command',
  bashoutput: 'command',
  killshell: 'command',
  killbash: 'command',
  read: 'file_read',
  notebookread: 'file_read',
  ls: 'file_read',
  edit: 'file_edit',
  multiedit: 'file_edit',
  write: 'file_edit',
  notebookedit: 'file_edit',
  grep: 'search',
  glob: 'search',
  find: 'search',
  webfetch: 'web',
  websearch: 'web',
  web_fetch: 'web',
  web_search: 'web',
  askuserquestion: 'question',
  ask_user_question: 'question',
}

const VISUALIZE_TOOLS = new Set(['visualize', 'canvas', 'static_visualize', 'interactive_visualize'])
const MCP_TOOL = /^mcp__([a-zA-Z0-9_-]+)__.+$/u

/** Unrecognized tools are `other`; the native name is always preserved. */
export function describeTool(name: string): ToolDescriptor {
  const server = MCP_TOOL.exec(name)?.[1]
  const withServer = (kind: ToolKind): ToolDescriptor => ({ name, kind, ...(server === undefined ? {} : { server }) })
  if (isImageGenToolName(name) || isImageReadToolName(name) || isImageEditToolName(name)) return withServer('image')
  if (VISUALIZE_TOOLS.has(canonicalProductToolName(name))) return withServer('visualize')
  if (server !== undefined) return withServer('mcp')
  if (isWorkflowName(name)) return withServer('workflow')
  return withServer(NATIVE_KINDS[name.trim().toLowerCase()] ?? 'other')
}

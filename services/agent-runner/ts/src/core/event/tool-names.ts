const TERMINAL_STATUSES = new Set([
  'completed',
  'complete',
  'failed',
  'error',
  'killed',
  'stopped',
  'cancelled',
  'canceled',
  'aborted',
])

export const VISUALIZE_TOOL_NAME = 'visualize'
export const CANVAS_TOOL_NAME = 'canvas'
export const IMAGE_GEN_TOOL_NAME = 'image_gen'
export const IMAGE_READ_TOOL_NAME = 'image_read'
export const IMAGE_EDIT_TOOL_NAME = 'image_edit'

const PRODUCT_TOOL_NAMES = new Set([
  VISUALIZE_TOOL_NAME,
  CANVAS_TOOL_NAME,
  IMAGE_GEN_TOOL_NAME,
  IMAGE_READ_TOOL_NAME,
  IMAGE_EDIT_TOOL_NAME,
])

const MCP_TOOL_NAME = /^mcp__[a-zA-Z0-9_-]+__(.+)$/

export function canonicalProductToolName(name: string): string {
  const lower = name.trim().toLowerCase()
  const stripped = stripMcpToolPrefix(lower)
  if (PRODUCT_TOOL_NAMES.has(stripped)) return stripped
  return lower
}

export function isVisualizeToolName(name: string): boolean {
  return canonicalProductToolName(name) === VISUALIZE_TOOL_NAME
}

export function isCanvasToolName(name: string): boolean {
  return canonicalProductToolName(name) === CANVAS_TOOL_NAME
}

export function isImageGenToolName(name: string): boolean {
  return canonicalProductToolName(name) === IMAGE_GEN_TOOL_NAME
}

export function isImageReadToolName(name: string): boolean {
  return canonicalProductToolName(name) === IMAGE_READ_TOOL_NAME
}

export function isImageEditToolName(name: string): boolean {
  return canonicalProductToolName(name) === IMAGE_EDIT_TOOL_NAME
}

export function isImageOutputToolName(name: string): boolean {
  return isImageGenToolName(name) || isImageEditToolName(name)
}

function stripMcpToolPrefix(name: string): string {
  const match = MCP_TOOL_NAME.exec(name)
  const bare = match?.[1]
  return bare === undefined || bare === '' ? name : bare
}

export function isAgentName(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  return normalized === 'agent' || normalized === 'task'
}

export function isWorkflowName(name: string): boolean {
  return name.trim().toLowerCase() === 'workflow'
}

export function isTaskBoardName(name: string): boolean {
  const normalized = name.trim().toLowerCase().replace(/[_-]/g, '')
  return (
    normalized === 'taskcreate' ||
    normalized === 'taskget' ||
    normalized === 'taskupdate' ||
    normalized === 'tasklist'
  )
}

export function isReadToolName(name: string): boolean {
  return name.trim().toLowerCase() === 'read'
}

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status.trim().toLowerCase())
}

import { canvasTool } from './canvas.js'
import type { ToolDefinition } from './define-tool.js'
import { visualizeTool } from './visualize.js'

export const productTools: readonly ToolDefinition[] = [visualizeTool, canvasTool]

import { canvasTool } from './canvas.js'
import type { ToolDefinition } from './define-tool.js'
import { imageEditTool } from './image-edit.js'
import { imageGenTool } from './image-gen.js'
import { imageReadTool } from './image-read.js'
import { visualizeTool } from './visualize.js'

export const productTools: readonly ToolDefinition[] = [
  visualizeTool,
  canvasTool,
  imageGenTool,
  imageReadTool,
  imageEditTool,
]

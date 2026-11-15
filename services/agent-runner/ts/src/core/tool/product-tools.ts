import { whiteboardReadTool, whiteboardWriteTool } from './whiteboard.js'
import { canvasTool } from './canvas.js'
import type { ToolDefinition } from './define-tool.js'
import { imageEditTool } from './image-edit.js'
import { imageGenTool } from './image-gen.js'
import { imageReadTool } from './image-read.js'
import { renderUiTool } from './a2ui-render.js'
import { visualizeTool } from './visualize.js'

export const productTools: readonly ToolDefinition[] = [
  visualizeTool,
  canvasTool,
  whiteboardReadTool,
  whiteboardWriteTool,
  renderUiTool,
  imageGenTool,
  imageReadTool,
  imageEditTool,
]

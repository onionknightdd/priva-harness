import type { ToolDefinition } from '../tool/define-tool.js'
import { RENDER_UI_TOOL_NAME, VISUALIZE_TOOL_NAME } from '../event/tool-names.js'

/** Appended to the existing system prompt while visualize mode is on. */
export const VISUALIZE_MODE_REMINDER = `<system-reminder>
当前用户偏好使用可视化组件展示内容，而非大量文本。
有条件时使用 render_ui 的 A2UI 组件展示仪表盘、图表、表格和交互表单。
传入完整 source；每次调用创建独立 UI，前端只渲染通过校验的结果。
用户点击会返回 <priva-a2ui-action> JSON，上下文在 action.context，toolCallId 标识原 UI；结合这些值回答或生成新的完整 UI。
无需在回复中提及这些工具，前端会自动渲染。
</system-reminder>`

export function withVisualizeInstructions(instructions: string, enabled: boolean): string {
  const base = instructions.split(VISUALIZE_MODE_REMINDER).join('').trim()
  return enabled ? `${base}\n\n${VISUALIZE_MODE_REMINDER}` : base
}

export function toolsForVisualizeMode(
  tools: readonly ToolDefinition[],
  enabled: boolean | undefined,
): readonly ToolDefinition[] {
  const on = enabled === true
  return tools.filter((tool) => {
    if (tool.name === VISUALIZE_TOOL_NAME) return !on
    if (tool.name === RENDER_UI_TOOL_NAME) return on
    return true
  })
}

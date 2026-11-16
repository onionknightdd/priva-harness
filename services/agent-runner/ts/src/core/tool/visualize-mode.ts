import { INTERACTIVE_VISUALIZE_TOOL_NAME, STATIC_VISUALIZE_TOOL_NAME, VISUALIZE_TOOL_NAME } from '../event/tool-names.js'
import type { ToolDefinition } from './define-tool.js'

/** Appended to the existing system prompt while visualize mode is on. */
export const VISUALIZE_MODE_REMINDER = `<system-reminder>
当前用户偏好使用可视化组件展示内容，而非大量文本。
有条件时使用 ${STATIC_VISUALIZE_TOOL_NAME}、${INTERACTIVE_VISUALIZE_TOOL_NAME}。
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
    if (tool.name === STATIC_VISUALIZE_TOOL_NAME || tool.name === INTERACTIVE_VISUALIZE_TOOL_NAME) return on
    return true
  })
}

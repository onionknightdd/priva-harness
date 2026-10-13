import type { StreamBlock } from "./agent-message-data"

type ToolBlock = Extract<StreamBlock, { type: "tool_use" }>

/** Group tool descendants separately from the existing subagent channel. */
export function codemodeParent(block: ToolBlock, blocks: readonly StreamBlock[]): string | undefined {
  let parentId = block.tool?.parentToolCallId
  const visited = new Set([block.id])
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = blocks.find((item): item is ToolBlock => item.type === "tool_use" && item.id === parentId)
    if (!parent) return undefined
    if (parent.name === "codemode") return parent.id
    parentId = parent.tool?.parentToolCallId
  }
  return undefined
}

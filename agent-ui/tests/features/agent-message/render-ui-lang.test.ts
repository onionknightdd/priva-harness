import assert from "node:assert/strict"
import { test } from "node:test"

import { assistantPieces } from "../../../src/features/agent-message/assistant-pieces.ts"
import type { AgentThreadMessage, StreamBlock } from "../../../src/features/agent-message/agent-message-data.ts"
import { isGeneratedVisualTool } from "../../../src/features/agent-message/render-ui/lang.ts"
import { countToolActivity } from "../../../src/features/agent-message/tool-activity.ts"

const text = (id: string, value: string, index: number): StreamBlock => ({
  type: "text", blockId: id, index, text: value,
})
const visual = (id: string, index: number): StreamBlock => ({
  type: "tool_use", id, blockId: id, index, name: "static_visualize", input: { lang: "root = Stack([])" },
})

test("recognizes both generated visual tools and ignores JSX visualize", () => {
  assert.equal(isGeneratedVisualTool("static_visualize"), true)
  assert.equal(isGeneratedVisualTool("mcp__agentWorkshop__interactive_visualize"), true)
  assert.equal(isGeneratedVisualTool("visualize"), false)
})

test("places a visual above the answer and leaves it out of the tool summary", () => {
  const blocks = [visual("ui", 0), text("answer", "Done", 1)]
  const message = { id: "m", role: "assistant", content: "Done", createdAt: "", status: "complete", blocks } as AgentThreadMessage
  assert.deepEqual(assistantPieces(message).map((piece) => piece.kind), ["visual", "answer"])
  assert.equal(countToolActivity(blocks).other.completed, 0)
})

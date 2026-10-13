import assert from "node:assert/strict"
import { test } from "node:test"
import { applyStreamFrame } from "../../../src/features/agent-message/run-stream-reducer"
import type { AgentThreadMessage } from "../../../src/features/agent-message/agent-message-data"

test("retains native Codemode children and result metadata independently of agents", () => {
  let message: AgentThreadMessage = { id: "m", role: "assistant", content: "", createdAt: "2026-10-13T00:00:00Z", status: "streaming", blocks: [] }
  message = applyStreamFrame(message, { type: "tool.started", messageId: "m", blockId: "outer", id: "outer", name: "codemode", input: { code: "..." } })
  message = applyStreamFrame(message, { type: "tool.started", messageId: "m", blockId: "outer/1", id: "outer/1", parentToolCallId: "outer", name: "mcp__docs__read" })
  message = applyStreamFrame(message, { type: "tool.completed", messageId: "m", blockId: "outer/1", id: "outer/1", parentToolCallId: "outer", name: "mcp__docs__read", ok: true, structuredContent: [1, 2] })
  message = applyStreamFrame(message, { type: "tool.progress", id: "outer", channel: "log", chunk: "", modelCalls: [{ id: "call", parentToolCallId: "outer", operation: "classify", provider: "p", model: "judge", status: "completed", result: { accepted: true } }] })
  message = applyStreamFrame(message, { type: "tool.completed", id: "outer", name: "codemode", ok: true, output: "done", nestedCallsComplete: false, artifacts: [{ path: "/workspace/.images/a.png", mimeType: "image/png" }] })
  assert.equal(message.nestedAgents?.length ?? 0, 0)
  const tools = message.blocks?.filter((block) => block.type === "tool_use") ?? []
  assert.equal(tools.length, 2)
  assert.equal(tools[1]?.tool?.parentToolCallId, "outer")
  assert.deepEqual(tools[1]?.tool?.structuredContent, [1, 2])
  assert.equal(tools[0]?.tool?.modelCalls?.[0]?.status, "completed")
  assert.equal(tools[0]?.tool?.nestedCallsComplete, false)
  assert.equal(tools[0]?.tool?.artifacts?.[0]?.mimeType, "image/png")
})

test("groups deeper native tool descendants under their nearest Codemode without losing orphan calls", async () => {
  const { codemodeParent } = await import("../../../src/features/agent-message/codemode-tool-data")
  const block = (id: string, name: string, parentToolCallId?: string): import("../../../src/features/agent-message/agent-message-data").StreamBlock => ({
    type: "tool_use", id, blockId: id, index: 0, name,
    tool: { id, name, status: "completed", parentToolCallId },
  })
  const blocks = [block("code", "codemode"), block("child", "mcp__a__read", "code"), block("deep", "read", "child"), block("orphan", "read", "missing")]
  assert.equal(codemodeParent(blocks[1] as Extract<typeof blocks[number], { type: "tool_use" }>, blocks), "code")
  assert.equal(codemodeParent(blocks[2] as Extract<typeof blocks[number], { type: "tool_use" }>, blocks), "code")
  assert.equal(codemodeParent(blocks[3] as Extract<typeof blocks[number], { type: "tool_use" }>, blocks), undefined)
})

import assert from "node:assert/strict"
import { test } from "node:test"
import { agentToolsForMessage } from "../../../src/features/agent-message/agent-tool-data"
import { isProcessBlock } from "../../../src/features/agent-message/agent-message-data"
import type { AgentThreadMessage } from "../../../src/features/agent-message/agent-message-data"

const message: AgentThreadMessage = {
  id: "main", role: "assistant", content: "", createdAt: "2024-01-01T00:00:00Z", status: "complete",
  blocks: [{ type: "tool_use", id: "agent-call", blockId: "agent-call", index: 0, name: "Agent", input: { description: "Inspect auth", prompt: "Review sessions", subagent_type: "Explore" },
    tool: { id: "agent-call", name: "agent", status: "completed", launchStatus: "async_launched", agentId: "worker", output: "Launched" } }],
  nestedAgents: [{ parentToolUseId: "agent-call", agentId: "worker", status: "running", inbox: [], blocks: [{ type: "thinking", blockId: "t", index: 0, text: "Inspect" }] }],
}

test("joins parent calls with nested data without duplicating the Agent", () => {
 const agents = agentToolsForMessage(message)
 assert.equal(agents.length, 1)
 assert.equal(agents[0]?.label, "Inspect auth")
 assert.equal(agents[0]?.prompt, "Review sessions")
 assert.equal(agents[0]?.state, "running")
 assert.equal(agents[0]?.output, undefined)
 assert.equal(agents[0]?.blocks[0]?.type, "thinking")
})

test("preserves failed and cancelled outcomes", () => {
 for (const status of ["failed", "cancelled"] as const) {
  const agents = agentToolsForMessage({ ...message, nestedAgents: message.nestedAgents?.map((agent) => ({ ...agent, status })) })
  assert.equal(agents[0]?.state, status)
 }
})

test("hides StructuredOutput tools regardless of provider casing", () => {
 for (const name of ["StructuredOutput", "structuredoutput"]) {
  const block = { type: "tool_use" as const, id: "structured", blockId: "structured", index: 0, name }
  assert.equal(isProcessBlock(block, [block]), false)
  const agents = agentToolsForMessage({ ...message, nestedAgents: message.nestedAgents?.map((agent) => ({ ...agent, blocks: [block] })) })
  assert.equal(agents[0]?.toolCount, 0)
 }
})

test("exposes recorded token usage and elapsed duration, including zero", () => {
 const source = structuredClone(message)
 const call = source.blocks?.[0]
 if (call?.type !== "tool_use" || !call.tool) throw new Error("Missing fixture tool")
 call.tool.tokens = 15142
 call.tool.durationMs = 3357
 assert.equal(agentToolsForMessage(source)[0]?.tokens, 15142)
 assert.equal(agentToolsForMessage(source)[0]?.durationMs, 3357)
 call.tool.tokens = 0
 call.tool.durationMs = 0
 assert.equal(agentToolsForMessage(source)[0]?.tokens, 0)
 assert.equal(agentToolsForMessage(source)[0]?.durationMs, 0)
})

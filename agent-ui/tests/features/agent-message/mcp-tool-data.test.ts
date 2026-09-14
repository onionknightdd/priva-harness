import assert from "node:assert/strict"
import { test } from "node:test"

import type { StreamBlock } from "../../../src/features/agent-message/agent-message-data.ts"
import { externalMcpToolName, mcpToolInputText } from "../../../src/features/agent-message/mcp-tool-data.ts"

const block: Extract<StreamBlock, { type: "tool_use" }> = { type: "tool_use", id: "tool", blockId: "tool", index: 0, name: "mcp__github__list_issues" }

test("parses the server between the first separators and tool after the last separator", () => {
  assert.deepEqual(externalMcpToolName("mcp__github__list_issues"), { serverName: "github", toolName: "list_issues" })
  assert.deepEqual(externalMcpToolName(" MCP__My_Server-2__namespace__ListIssues "), { serverName: "My_Server-2", toolName: "ListIssues" })
  assert.deepEqual(externalMcpToolName("mcp__files__Read"), { serverName: "files", toolName: "Read" })
})

test("leaves native names and malformed MCP names on their existing paths", () => {
  for (const name of ["Read", "Write", "Edit", "Bash", "Shell", "Agent", "Skill", "Workflow", "TaskList", "AskUserQuestion", "mcp__server", "mcp____tool", "mcp__server__", "other__server__tool"]) {
    assert.equal(externalMcpToolName(name), null, name)
  }
})

test("preserves the existing specialized product tools and their MCP aliases", () => {
  for (const name of ["canvas", "visualize", "image_gen", "image_read", "image_edit"]) {
    assert.equal(externalMcpToolName(name), null)
    assert.equal(externalMcpToolName(`mcp__agentWorkshop__${name}`), null)
    assert.equal(externalMcpToolName(`MCP__OTHER__${name.toUpperCase()}`), null)
  }
})

test("formats structured input and preserves strings, empty collections and scalar values", () => {
  for (const input of [{ query: "hello", limit: 0, enabled: false }, {}, [], 0, false, null, "plain text"]) {
    assert.equal(mcpToolInputText({ ...block, input }), typeof input === "string" ? input : JSON.stringify(input, null, 2))
  }
  assert.equal(mcpToolInputText(block), undefined)
  assert.equal(mcpToolInputText({ ...block, input: { stale: true }, tool: { id: "tool", name: block.name, status: "running", input: { query: "current" } } }), '{\n  "query": "current"\n}')
})

test("shows partial streaming JSON verbatim and formats it when complete", () => {
  const tool = { id: "tool", name: block.name, status: "started" as const, input: {} }
  assert.equal(mcpToolInputText({ ...block, tool: { ...tool, inputRaw: '{"query":"hel' } }), '{"query":"hel')
  assert.equal(mcpToolInputText({ ...block, tool: { ...tool, inputRaw: '{"query":"hello"}' } }), '{\n  "query": "hello"\n}')
})

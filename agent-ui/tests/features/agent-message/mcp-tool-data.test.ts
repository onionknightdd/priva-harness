import assert from "node:assert/strict"
import { test } from "node:test"

import type { StreamBlock } from "../../../src/features/agent-message/agent-message-data.ts"
import { computerToolTitleKey, isLiveComputerToolStart } from "../../../src/features/agent-message/computer-tool-data.ts"
import { externalMcpToolName, mcpToolInputText } from "../../../src/features/agent-message/mcp-tool-data.ts"
import { zhCN } from "../../../src/i18n/locales/zh-CN.ts"

const block: Extract<StreamBlock, { type: "tool_use" }> = { type: "tool_use", id: "tool", blockId: "tool", index: 0, name: "mcp__github__list_issues" }

test("all computer tools, new tools and subagent calls can open the desktop on a live start", () => {
  const names = [...Object.keys(zhCN.computerTool.names), "future_tool", "namespace__list_apps", "image_read"]
  for (const tool of names) {
    for (const parentToolUseId of [undefined, "agent-tool"]) {
      assert.equal(isLiveComputerToolStart({ type: "tool.started", name: `mcp__computer__${tool}`, parentToolUseId }), true, tool)
    }
  }
})

test("computer navigation ignores history, replay, progress and tools from other servers", () => {
  const start = { type: "tool.started", name: "mcp__computer__list_apps" }
  assert.equal(isLiveComputerToolStart({ ...start, replay: true }), false)
  for (const type of ["session.snapshot", "assistant.message", "tool.input_delta", "tool.running", "tool.completed"]) {
    assert.equal(isLiveComputerToolStart({ ...start, type, activeRunId: "running" }), false, type)
  }
  for (const name of [undefined, "Bash", "mcp__other__list_apps", "mcp__computer_extra__list_apps", "mcp__computer__", "computer__list_apps"]) {
    assert.equal(isLiveComputerToolStart({ ...start, name }), false, name)
  }
})

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

test("computer titles refine only complete, correctly typed action arguments", () => {
  const name = { serverName: "computer", toolName: "browser_pointer" }
  for (const input of [undefined, "", '{"action":"scroll",', "[]", "null", '"scroll"', '{"action":true}', '{"action":"unknown"}']) {
    assert.equal(computerToolTitleKey(name, input), "computerTool.names.browser_pointer")
  }
  assert.equal(computerToolTitleKey(name, '{"action":"scroll"}'), "computerTool.actions.pointer_scroll")
  assert.equal(computerToolTitleKey({ ...name, serverName: "browser" }, '{"action":"scroll"}'), null)
  assert.equal(computerToolTitleKey({ ...name, toolName: "browser_dialog" }, '{"action":"dismiss"}'), "computerTool.actions.dialog_dismiss")
  assert.equal(computerToolTitleKey({ ...name, toolName: "browser_dialog" }, '{"action":"scroll"}'), "computerTool.names.browser_dialog")
})

test("computer titles distinguish explicit cursor visibility and installation preview from execution", () => {
  const cursor = { serverName: "computer", toolName: "set_agent_cursor_enabled" }
  assert.equal(computerToolTitleKey(cursor, '{"enabled":false}'), "computerTool.actions.cursor_hide")
  assert.equal(computerToolTitleKey(cursor, '{"enabled":true}'), "computerTool.actions.cursor_show")
  assert.equal(computerToolTitleKey(cursor, '{"enabled":"false"}'), "computerTool.names.set_agent_cursor_enabled")
  for (const [toolName, action] of [["install_ffmpeg", "ffmpeg"], ["install_extension", "extension"]]) {
    const name = { serverName: "computer", toolName }
    for (const input of ["{}", '{"confirm":false}']) {
      assert.equal(computerToolTitleKey(name, input), `computerTool.actions.${action}_preview`)
    }
    assert.equal(computerToolTitleKey(name, '{"confirm":true}'), `computerTool.actions.${action}_install`)
    assert.equal(computerToolTitleKey(name, '{"confirm":"true"}'), `computerTool.names.${toolName}`)
    assert.equal(computerToolTitleKey(name, '{"confirm":'), `computerTool.names.${toolName}`)
  }
})

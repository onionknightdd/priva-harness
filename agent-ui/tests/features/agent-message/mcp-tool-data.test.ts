import assert from "node:assert/strict"
import { test } from "node:test"

import type { StreamBlock } from "../../../src/features/agent-message/agent-message-data.ts"
import { isLiveCuaAppSelection, replToolTitle } from "../../../src/features/agent-message/computer-tool-data.ts"
import { externalMcpToolName, mcpToolInputText } from "../../../src/features/agent-message/mcp-tool-data.ts"

const block: Extract<StreamBlock, { type: "tool_use" }> = { type: "tool_use", id: "tool", blockId: "tool", index: 0, name: "mcp__github__list_issues" }

test("only an explicit native CUA selection on a live call can open the Pod desktop", () => {
  const pending = new Set<string>()
  const start = { type: "tool.started", name: "mcp__cua_repl__js", id: "call" }
  const native = { code: 'await cua.computer.launch_app({app:"org.xfce.mousepad.desktop"});' }
  for (const code of [
    'let editor = await cua.getApp({windowId: 17});', "const app = await cua.getApp('Mousepad')", native.code,
  ]) {
    assert.equal(isLiveCuaAppSelection({ ...start, input: { code } }, pending), true, code)
    assert.equal(isLiveCuaAppSelection({ ...start, type: "tool.updated", input: { code } }, pending), false)
  }
  for (const input of [
    { title: "Show the desktop" }, { code: 123 },
    { code: "await cua.getState();" }, { code: 'await cua.getBrowser({id:"chrome"});' },
    { code: "await app.click(1);" }, { code: "nodeRepl.write('await cua.getApp(\"Mousepad\")')" },
    { code: "// await cua.getApp('Mousepad');" }, { code: "if (false) await cua.getApp('Mousepad');" },
  ]) assert.equal(isLiveCuaAppSelection({ ...start, input }, pending), false)
  // A registered computer is another machine; its calls must not bring up this workspace's desktop.
  for (const name of ["mcp__node_repl__js", "mcp__registered_computers__js", "mcp__other__js"]) {
    assert.equal(isLiveCuaAppSelection({ ...start, name, input: native }, pending), false)
  }
  for (const type of ["session.snapshot", "tool.completed"]) {
    isLiveCuaAppSelection({ ...start, input: {} }, pending)
    isLiveCuaAppSelection({ type, id: start.id }, pending)
    assert.equal(isLiveCuaAppSelection({ ...start, type: "tool.updated", input: native }, pending), false)
  }
  assert.equal(isLiveCuaAppSelection({ ...start, replay: true, input: native }, pending), false)
  assert.equal(isLiveCuaAppSelection({ ...start, type: "tool.updated", input: native }, pending), false)
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

test("a Computer Use js card takes its title from complete arguments of the plugin's own servers", () => {
  for (const name of ["mcp__cua_repl__js", "mcp__registered_computers__js", "mcp__node_repl__js"]) {
    assert.equal(replToolTitle(name, '{"code":"await cua.getState();","title":" Reading available apps "}'), "Reading available apps", name)
    for (const input of [undefined, "", '{"title":"Reading', '{"code":"1"}', '{"title":"  "}', '{"title":7}', "[]"]) {
      assert.equal(replToolTitle(name, input), undefined, `${name} ${String(input)}`)
    }
  }
  for (const name of ["mcp__cua_repl__js_reset", "mcp__registered_computers__list_devices", "mcp__other__js", "Bash"]) {
    assert.equal(replToolTitle(name, '{"title":"Not a plugin js call"}'), undefined, name)
  }
})

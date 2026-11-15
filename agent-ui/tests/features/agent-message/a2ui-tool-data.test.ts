import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { a2uiMessagesFromTool, isGeneratedVisualTool, isFailedGeneratedVisual } from "../../../src/features/agent-message/a2ui-tool-data.ts"
import { assistantPieces } from "../../../src/features/agent-message/assistant-pieces.ts"
import { countToolActivity } from "../../../src/features/agent-message/tool-activity.ts"
import type { AgentThreadMessage, StreamBlock } from "../../../src/features/agent-message/agent-message-data.ts"

const output = readFileSync(new URL("../../fixtures/a2ui/sales-dashboard.json", import.meta.url), "utf8")
const tool = { status: "completed" as const, ok: true, output }

test("places the UI above the following answer and excludes it from process counts", () => {
  const blocks: StreamBlock[] = [
    { type: "thinking", blockId: "thought", index: 0, text: "Planning" },
    { type: "tool_use", id: "ui", blockId: "ui", index: 1, name: "render_ui", tool: { id: "ui", name: "render_ui", ...tool } },
    { type: "text", blockId: "answer", index: 2, text: "Sales summary" },
  ]
  const message: AgentThreadMessage = { id: "m", role: "assistant", content: "Sales summary", status: "complete", createdAt: "", blocks }
  assert.deepEqual(assistantPieces(message).map((piece) => piece.kind), ["process", "visual", "answer"])
  assert.equal(countToolActivity(blocks).other.completed, 0)
})

test("completed failures belong to process while pending calls retain their loading surface", () => {
  for (const name of ["render_ui", "mcp__agentWorkshop__render_ui"]) for (const status of ["started", "running", "completed"] as const) {
    const block: Extract<StreamBlock, { type: "tool_use" }> = { type: "tool_use", id: "ui", blockId: "ui", index: 0, name, tool: { id: "ui", name, status, ok: false, output: "Unknown surface mcp_status" } }
    const message: AgentThreadMessage = { id: "m", role: "assistant", content: "", status: "complete", createdAt: "", blocks: [block] }
    assert.equal(isFailedGeneratedVisual(block), status === "completed")
    assert.deepEqual(assistantPieces(message).map((piece) => piece.kind), [status === "completed" ? "process" : "visual"])
  }
})

test("a failed attempt followed by a successful root Table keeps only the successful inline result", () => {
  const error = "Unknown surface mcp_status. Assign root = Table(...) instead."
  const table = readFileSync(new URL("../../fixtures/a2ui/root-table.json", import.meta.url), "utf8")
  const blocks: StreamBlock[] = [
    { type: "tool_use", id: "failed", blockId: "failed", index: 0, name: "render_ui", tool: { id: "failed", name: "render_ui", status: "completed", ok: false, output: error } },
    { type: "tool_use", id: "table", blockId: "table", index: 1, name: "render_ui", tool: { id: "table", name: "render_ui", status: "completed", ok: true, output: table } },
    { type: "text", blockId: "answer", index: 2, text: "All three services are ready." },
  ]
  const message: AgentThreadMessage = { id: "retry", role: "assistant", content: "All three services are ready.", status: "complete", createdAt: "", blocks }
  const pieces = assistantPieces(message)
  assert.deepEqual(pieces.map((piece) => piece.kind), ["process", "visual", "answer"])
  assert.equal(pieces[0].kind === "process" && pieces[0].blocks[0].type === "tool_use" && pieces[0].blocks[0].tool?.output, error)
  assert.equal(pieces[1].kind === "visual" && pieces[1].block.id, "table")
})

test("multiple successful visuals survive a failed attempt between them", () => {
  const blocks: StreamBlock[] = [
    { type: "tool_use", id: "first", blockId: "first", index: 0, name: "render_ui", tool: { id: "first", name: "render_ui", ...tool } },
    { type: "tool_use", id: "failed", blockId: "failed", index: 1, name: "render_ui", tool: { id: "failed", name: "render_ui", status: "completed", ok: false, output: "Invalid source" } },
    { type: "tool_use", id: "second", blockId: "second", index: 2, name: "render_ui", tool: { id: "second", name: "render_ui", ...tool } },
    { type: "text", blockId: "answer", index: 3, text: "Both reports are ready." },
  ]
  const message: AgentThreadMessage = { id: "multiple", role: "assistant", content: "Both reports are ready.", status: "complete", createdAt: "", blocks }
  const pieces = assistantPieces(message)
  assert.deepEqual(pieces.map((piece) => piece.kind), ["visual", "process", "visual", "answer"])
  assert.deepEqual(pieces.flatMap((piece) => piece.kind === "visual" ? [piece.block.id] : []), ["first", "second"])
  assert.equal(pieces[1].kind === "process" && pieces[1].blocks[0].blockId, "failed")
})

test("malformed successful output retains an inline error surface instead of becoming a failed tool", () => {
  const block: Extract<StreamBlock, { type: "tool_use" }> = { type: "tool_use", id: "invalid", blockId: "invalid", index: 0, name: "render_ui", tool: { id: "invalid", name: "render_ui", status: "completed", ok: true, output: "not JSON" } }
  const message: AgentThreadMessage = { id: "m", role: "assistant", content: "", status: "complete", createdAt: "", blocks: [block] }
  assert.equal(isFailedGeneratedVisual(block), false)
  assert.deepEqual(assistantPieces(message).map((piece) => piece.kind), ["visual"])
})

test("recognizes render_ui and its MCP name without claiming other tools", () => {
  assert.equal(isGeneratedVisualTool("render_ui"), true)
  assert.equal(isGeneratedVisualTool("mcp__agentWorkshop__render_ui"), true)
  for (const name of ["visualize", "static_visualize", "interactive_visualize", "canvas", "render_ui_custom"]) {
    assert.equal(isGeneratedVisualTool(name), false)
  }
})

test("accepts real backend-compiled A2UI 1.0 using the pinned frontend SDK", () => {
  const messages = a2uiMessagesFromTool(tool)
  assert.ok(messages?.length)
  assert.equal(messages[0]?.version, "v1.0")
  assert.equal(JSON.stringify(messages).includes("Q3 Sales Performance"), true)
})

test("never treats incomplete, failed, raw source or invalid output as a UI", () => {
  for (const value of [undefined, { ...tool, status: "started" as const }, { ...tool, ok: false },
    { ...tool, output: "root = Column([])" }, { ...tool, output: "{}" },
    { ...tool, output: output.replace('"version": "1.0"', '"version": "0.9"') },
    { ...tool, output: JSON.stringify({ format: "a2ui", version: "1.0", messages: [{ version: "v1.0", createSurface: {} }] }) }]) {
    assert.equal(a2uiMessagesFromTool(value), null)
  }
})

test("rejects multiple surfaces, other surface IDs and cross-surface operations", () => {
  const original = JSON.parse(output)
  for (const messages of [
    [...original.messages, original.messages[0]],
    [{ version: "v1.0", deleteSurface: { surfaceId: "main" } }],
    [...original.messages, { version: "v1.0", updateDataModel: { surfaceId: "another", value: {} } }],
  ]) {
    assert.equal(a2uiMessagesFromTool({ ...tool, output: JSON.stringify({ ...original, messages }) }), null)
  }
})

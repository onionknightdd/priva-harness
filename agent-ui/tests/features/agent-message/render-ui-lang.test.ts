import assert from "node:assert/strict"
import { test } from "node:test"

import { assistantPieces } from "../../../src/features/agent-message/assistant-pieces.ts"
import type { AgentThreadMessage, StreamBlock } from "../../../src/features/agent-message/agent-message-data.ts"
import { isGeneratedVisualTool, isHiddenGeneratedVisual } from "../../../src/features/agent-message/render-ui/lang.ts"
import { finishedProgramRejected } from "../../../src/features/agent-message/render-ui/visual-program.ts"
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

test("drops a failed visual and keeps the successful one", () => {
  const failed: StreamBlock = {
    type: "tool_use",
    id: "bad",
    blockId: "bad",
    index: 0,
    name: "mcp__agentWorkshop__static_visualize",
    input: { lang: "root = Stack([])" },
    tool: {
      id: "bad",
      name: "mcp__agentWorkshop__static_visualize",
      status: "completed",
      ok: false,
      output: "type-mismatch: field \"/series/0\" expects Series but got number",
      input: { lang: "root = Stack([])" },
    },
  }
  const interactive: StreamBlock = {
    type: "tool_use",
    id: "ask",
    blockId: "ask",
    index: 1,
    name: "interactive_visualize",
    input: { lang: "root = Stack([])" },
    tool: {
      id: "ask",
      name: "interactive_visualize",
      status: "completed",
      ok: false,
      output: "no-root",
      input: { lang: "root = Stack([])" },
    },
  }
  assert.equal(isHiddenGeneratedVisual(failed), true)
  assert.equal(isHiddenGeneratedVisual(interactive), true)
  const stillRunning: StreamBlock = {
    ...interactive,
    id: "live",
    blockId: "live",
    tool: { ...interactive.tool!, status: "started" },
  }
  assert.equal(isHiddenGeneratedVisual(stillRunning), true)
  const blocks = [failed, interactive, stillRunning, visual("ok", 2), text("answer", "Done", 4)]
  const message = { id: "m", role: "assistant", content: "Done", createdAt: "", status: "complete", blocks } as AgentThreadMessage
  const pieces = assistantPieces(message)
  assert.deepEqual(pieces.map((piece) => piece.kind), ["visual", "answer"])
  assert.equal(pieces[0]?.kind === "visual" ? pieces[0].block.id : "", "ok")
})

test("drops a finished interactive program the library rejects", () => {
  const rejected: StreamBlock = {
    type: "tool_use",
    id: "chart",
    blockId: "chart",
    index: 0,
    name: "interactive_visualize",
    input: { lang: 'root = Stack([chart])\nlabels = ["A"]\ns = Series("S", [1])\nchart = BarChart(labels, [s])' },
    tool: {
      id: "chart",
      name: "interactive_visualize",
      status: "completed",
      ok: true,
      output: 'root = Stack([chart])\nlabels = ["A"]\ns = Series("S", [1])\nchart = BarChart(labels, [s])',
      input: { lang: 'root = Stack([chart])\nlabels = ["A"]\ns = Series("S", [1])\nchart = BarChart(labels, [s])' },
    },
  }
  const streaming: StreamBlock = {
    ...rejected,
    id: "partial",
    blockId: "partial",
    index: 1,
    tool: { ...rejected.tool!, status: "started", ok: undefined, output: undefined },
  }
  assert.equal(finishedProgramRejected(rejected), true)
  assert.equal(finishedProgramRejected(streaming), false)
  const message = {
    id: "m",
    role: "assistant",
    content: "Done",
    createdAt: "",
    status: "complete",
    blocks: [rejected, text("answer", "Done", 2)],
  } as AgentThreadMessage
  assert.deepEqual(assistantPieces(message).map((piece) => piece.kind), ["answer"])
})

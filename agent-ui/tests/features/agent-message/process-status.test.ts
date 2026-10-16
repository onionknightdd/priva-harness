import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { AgentThreadMessage, StreamBlock, ToolCard } from "../../../src/features/agent-message/agent-message-data.ts"
import { formatRunClock } from "../../../src/features/agent-message/process-elapsed.ts"
import {
  formatProcessStatusText,
  processStatusPieces,
} from "../../../src/features/agent-message/process-status.ts"
import { en } from "../../../src/i18n/locales/en.ts"
import { zhCN } from "../../../src/i18n/locales/zh-CN.ts"

const i18n = (await import("i18next")).createInstance()
await i18n.init({
  lng: "zh-CN",
  resources: {
    en: { translation: en },
    "zh-CN": { translation: zhCN },
  },
})

function message(blocks: StreamBlock[]): AgentThreadMessage {
  return {
    id: "m",
    role: "assistant",
    content: "",
    createdAt: "2026-10-16T00:00:00.000Z",
    status: "streaming",
    blocks,
  }
}

function tool(index: number, name: string, status: ToolCard["status"]): StreamBlock {
  return {
    type: "tool_use",
    blockId: `${name}-${index}`,
    index,
    id: `${name}-${index}`,
    name,
    tool: { id: `${name}-${index}`, name, status },
  }
}

const elapsed = "已运行 4s"

describe("process status pieces", () => {
  it("formats a run clock in seconds, then minutes and seconds", () => {
    assert.equal(formatRunClock(4_000), "4s")
    assert.equal(formatRunClock(65_400), "1m 05s")
  })

  it("keeps the count separate from the surrounding words", () => {
    const pieces = processStatusPieces(message([tool(0, "read", "started")]), true, i18n.t.bind(i18n), elapsed)
    assert.deepEqual(
      pieces.map((piece) => [piece.id, piece.text, Boolean(piece.count), Boolean(piece.steady)]),
      [
        ["elapsed", "已运行 4s", false, true],
        ["read:running:sep", "，", false, false],
        ["read:running:before", "正在读取", false, false],
        ["read:running:count", "1", true, false],
        ["read:running:after", "个文件", false, false],
      ],
    )
    assert.equal(formatProcessStatusText(message([tool(0, "read", "started")]), true, i18n.t.bind(i18n), elapsed), "已运行 4s，正在读取1个文件")
  })

  it("changes only the count text when another file of the same kind starts", () => {
    const first = processStatusPieces(message([tool(0, "read", "started")]), true, i18n.t.bind(i18n), elapsed)
    const second = processStatusPieces(
      message([tool(0, "read", "started"), tool(1, "read", "started")]),
      true,
      i18n.t.bind(i18n),
      elapsed,
    )
    assert.equal(second.find((piece) => piece.id === "read:running:count")?.text, "2")
    assert.deepEqual(
      second.filter((piece) => piece.id !== "read:running:count"),
      first.filter((piece) => piece.id !== "read:running:count"),
    )
  })

  it("adds a new clause without rewriting the earlier one", () => {
    const reading = processStatusPieces(message([tool(0, "read", "started")]), true, i18n.t.bind(i18n), elapsed)
    const both = processStatusPieces(
      message([tool(0, "read", "started"), tool(1, "edit", "completed")]),
      true,
      i18n.t.bind(i18n),
      elapsed,
    )
    assert.deepEqual(both.slice(0, reading.length), reading)
    assert.deepEqual(both.slice(reading.length).map((piece) => piece.text), ["，", "已编辑", "1", "个文件"])
  })

  it("changes the English plural around a stable prefix", () => {
    const zh = i18n
    void zh
    const english = i18n.getFixedT("en")
    const one = processStatusPieces(message([tool(0, "read", "started")]), true, english, "Running for 4s")
    const two = processStatusPieces(
      message([tool(0, "read", "started"), tool(1, "read", "started")]),
      true,
      english,
      "Running for 4s",
    )
    assert.equal(one.find((piece) => piece.id === "read:running:before")?.text, "Reading ")
    assert.equal(one.find((piece) => piece.id === "read:running:after")?.text, " file")
    assert.equal(two.find((piece) => piece.id === "read:running:before")?.text, "Reading ")
    assert.equal(two.find((piece) => piece.id === "read:running:after")?.text, " files")
    assert.equal(formatProcessStatusText(message([tool(0, "read", "started"), tool(1, "read", "started")]), true, english, "Running for 4s"), "Running for 4s, Reading 2 files")
  })

  it("replaces the summary with the background count after the turn settles", () => {
    const blocks: StreamBlock[] = [{
      type: "tool_use",
      blockId: "bash-0",
      index: 0,
      id: "bash-0",
      name: "bash",
      tool: {
        id: "bash-0",
        name: "bash",
        status: "completed",
        backgroundTask: { taskId: "task", kind: "bash", status: "running" },
      },
    }]
    const pieces = processStatusPieces(message(blocks), false, i18n.t.bind(i18n), "用时 1m 05s")
    assert.deepEqual(pieces.map((piece) => piece.text), ["用时 1m 05s", "，", "后台 ", "1"])
    assert.equal(pieces[3]?.count, true)
    assert.equal(formatProcessStatusText(message(blocks), false, i18n.t.bind(i18n), "用时 1m 05s"), "用时 1m 05s，后台 1")
  })
})

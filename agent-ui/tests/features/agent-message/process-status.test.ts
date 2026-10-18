import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { StreamBlock, ToolCard } from "../../../src/features/agent-message/agent-message-data.ts"
import { formatRunClock } from "../../../src/features/agent-message/process-elapsed.ts"
import {
  processActivityPieces,
  sameProcessActivity,
} from "../../../src/features/agent-message/process-status.ts"
import { joinStatusText } from "../../../src/features/agent-message/status-pieces.ts"
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

describe("process status pieces", () => {
  it("formats a run clock in seconds, then minutes and seconds", () => {
    assert.equal(formatRunClock(4_000), "4s")
    assert.equal(formatRunClock(65_400), "1m 05s")
  })

  it("keeps the count separate from the surrounding words", () => {
    const pieces = processActivityPieces([tool(0, "read", "started")], true, i18n.t.bind(i18n))
    assert.deepEqual(
      pieces.map((piece) => [piece.id, piece.text, Boolean(piece.count), Boolean(piece.steady)]),
      [
        ["read:running:sep", "，", false, false],
        ["read:running:before", "正在读取", false, false],
        ["read:running:count", "1", true, false],
        ["read:running:after", "个文件", false, false],
      ],
    )
    assert.equal(joinStatusText(pieces), "，正在读取1个文件")
  })

  it("changes only the count text when another file of the same kind starts", () => {
    const first = processActivityPieces([tool(0, "read", "started")], true, i18n.t.bind(i18n))
    const second = processActivityPieces(
      [tool(0, "read", "started"), tool(1, "read", "started")],
      true,
      i18n.t.bind(i18n),
    )
    assert.equal(second.find((piece) => piece.id === "read:running:count")?.text, "2")
    assert.deepEqual(
      second.filter((piece) => piece.id !== "read:running:count"),
      first.filter((piece) => piece.id !== "read:running:count"),
    )
  })

  it("adds a new clause without rewriting the earlier one", () => {
    const reading = processActivityPieces([tool(0, "read", "started")], true, i18n.t.bind(i18n))
    const both = processActivityPieces(
      [tool(0, "read", "started"), tool(1, "edit", "completed")],
      true,
      i18n.t.bind(i18n),
    )
    assert.deepEqual(both.slice(0, reading.length), reading)
    assert.deepEqual(both.slice(reading.length).map((piece) => piece.text), ["，", "已编辑", "1", "个文件"])
  })

  it("summarizes tool counts independently of input block order", () => {
    const blocks = [tool(8, "read", "started"), tool(2, "edit", "completed"), tool(1, "read", "started")]
    assert.deepEqual(
      processActivityPieces(blocks, true, i18n.t.bind(i18n)),
      processActivityPieces([...blocks].reverse(), true, i18n.t.bind(i18n)),
    )
    assert.deepEqual(blocks.map((block) => block.index), [8, 2, 1])
  })

  it("ignores streamed text, tool output and block identity when comparing summary inputs", () => {
    const read = tool(0, "read", "started") as Extract<StreamBlock, { type: "tool_use" }>
    const text: StreamBlock = { type: "text", blockId: "text", index: 1, text: "First words" }
    assert.equal(sameProcessActivity([read, text], [
      { ...text, text: "More streamed words" },
      { ...read, id: "new-id", blockId: "new-block", index: 5, tool: { ...read.tool!, output: "New output" } },
      { ...text, blockId: "second-text", index: 6 },
    ]), true)
    assert.equal(sameProcessActivity([], [text]), true)
    assert.equal(sameProcessActivity([text], []), true)
    assert.equal(sameProcessActivity([read], []), false)
    assert.equal(sameProcessActivity([], [read]), false)
  })

  it("detects the tool fields that affect running and background summaries", () => {
    const read = tool(0, "read", "started") as Extract<StreamBlock, { type: "tool_use" }>
    const changes: typeof read[] = [
      { ...read, name: "edit" },
      { ...read, tool: { ...read.tool!, status: "completed" } },
      { ...read, tool: { ...read.tool!, launchStatus: "async_launched" } },
      { ...read, tool: { ...read.tool!, backgroundTask: { taskId: "task", kind: "bash", status: "running" } } },
    ]
    for (const changed of changes) assert.equal(sameProcessActivity([read], [changed]), false)
    const background = changes[3]!
    assert.equal(sameProcessActivity([background], [{
      ...background,
      tool: { ...background.tool!, backgroundTask: { ...background.tool!.backgroundTask!, status: "completed" } },
    }]), false)
  })

  it("changes the English plural around a stable prefix", () => {
    const zh = i18n
    void zh
    const english = i18n.getFixedT("en")
    const one = processActivityPieces([tool(0, "read", "started")], true, english)
    const two = processActivityPieces(
      [tool(0, "read", "started"), tool(1, "read", "started")],
      true,
      english,
    )
    assert.equal(one.find((piece) => piece.id === "read:running:before")?.text, "Reading ")
    assert.equal(one.find((piece) => piece.id === "read:running:after")?.text, " file")
    assert.equal(two.find((piece) => piece.id === "read:running:before")?.text, "Reading ")
    assert.equal(two.find((piece) => piece.id === "read:running:after")?.text, " files")
    assert.equal(joinStatusText(two), ", Reading 2 files")
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
    const pieces = processActivityPieces(blocks, false, i18n.t.bind(i18n))
    assert.deepEqual(pieces.map((piece) => piece.text), ["，", "后台 ", "1"])
    assert.equal(pieces[2]?.count, true)
    assert.equal(joinStatusText(pieces), "，后台 1")
  })
})

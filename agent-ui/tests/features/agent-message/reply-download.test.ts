import assert from "node:assert/strict"
import { test } from "node:test"

import { JSDOM } from "jsdom"

import type { AgentThreadMessage, StreamBlock } from "../../../src/features/agent-message/agent-message-data.ts"
import {
  assistantReplyFileName,
  assistantReplyHasImage,
  assistantReplyMarkdown,
  collectReplyAtoms,
  paginateByFit,
  replyCaptureScale,
  replyElements,
  replyPageLimit,
} from "../../../src/features/agent-message/reply-download.ts"

const dom = new JSDOM("<!doctype html><html><body></body></html>")
Object.assign(globalThis, {
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
})

function message(blocks: StreamBlock[], content = ""): AgentThreadMessage {
  return {
    id: "m",
    role: "assistant",
    content,
    createdAt: "2026-10-18T12:05:00.000Z",
    status: "complete",
    blocks,
  }
}

const text = (id: string, value: string, index: number): StreamBlock => ({
  type: "text", blockId: id, index, text: value,
})

test("markdown keeps every answer and drops process, notifications, and visuals", () => {
  const blocks: StreamBlock[] = [
    { type: "thinking", blockId: "think", index: 0, text: "planning the reply" },
    { type: "tool_use", blockId: "bash", index: 1, id: "bash", name: "bash", input: { command: "ls" } },
    { type: "tool_use", blockId: "ui", index: 2, id: "ui", name: "static_visualize", input: { lang: "root = Stack([])" } },
    text("first", "First answer", 3),
    {
      type: "task_notification",
      blockId: "note",
      index: 4,
      notification: { id: "note", task: { taskId: "task", kind: "bash", status: "completed", summary: "done" } },
    },
    text("second", "Second answer", 5),
  ]
  assert.equal(assistantReplyMarkdown(message(blocks, "Second answer")), "First answer\n\nSecond answer")
  assert.equal(assistantReplyHasImage(message(blocks, "Second answer")), true)
})

test("a visual without prose can be captured but has no markdown", () => {
  const blocks: StreamBlock[] = [
    { type: "tool_use", blockId: "ui", index: 0, id: "ui", name: "static_visualize", input: { lang: "root = Stack([])" } },
  ]
  const visualOnly = message(blocks)
  assert.equal(assistantReplyMarkdown(visualOnly), "")
  assert.equal(assistantReplyHasImage(visualOnly), true)
})

test("process alone is not a reply", () => {
  const blocks: StreamBlock[] = [
    { type: "thinking", blockId: "think", index: 0, text: "only thinking" },
  ]
  const processOnly = message(blocks)
  assert.equal(assistantReplyMarkdown(processOnly), "")
  assert.equal(assistantReplyHasImage(processOnly), false)
})

test("a reply stored only on the message content is still included", () => {
  assert.equal(assistantReplyMarkdown(message([], "Stored reply")), "Stored reply")
  assert.equal(assistantReplyHasImage(message([], "Stored reply")), true)
})

test("file names use a UTC stamp", () => {
  assert.equal(assistantReplyFileName("2026-10-18T12:05:00.000Z", "md"), "reply-20261018-1205.md")
  assert.equal(assistantReplyFileName("not-a-date", "png"), "reply.png")
})

test("capture scale stays inside the canvas edge", () => {
  assert.equal(replyCaptureScale(800, 4000), 2)
  assert.equal(replyCaptureScale(800, 20000), 8192 / 20000)
  assert.equal(replyCaptureScale(0, 10), 1)
})

test("pdf pages keep a component whole when the next block does not fit", () => {
  const heights = [167, 351, 613, 151]
  const gap = 12
  const max = 811
  const fits = (start: number, end: number) => {
    const slice = heights.slice(start, end)
    const total = slice.reduce((sum, height) => sum + height, 0) + gap * (slice.length - 1)
    return total <= max
  }
  assert.deepEqual(paginateByFit(heights.length, fits), [[0, 2], [2, 4]])
  assert.equal(replyPageLimit(536) > 151, true)
})

test("a component that does not fit the remaining space moves to the next page", () => {
  const heights = [700, 151]
  const fits = (start: number, end: number) => {
    const slice = heights.slice(start, end)
    return slice.reduce((sum, height) => sum + height, 0) + 12 * (slice.length - 1) <= 811
  }
  assert.deepEqual(paginateByFit(heights.length, fits), [[0, 1], [1, 2]])
})

function box(height: number): DOMRect {
  return {
    x: 0, y: 0, top: 0, left: 0, width: 500, height, bottom: height, right: 500,
    toJSON() { return {} },
  }
}

test("a tall visual splits into its stacked components", () => {
  const root = document.createElement("div")
  const stack = document.createElement("div")
  stack.style.display = "flex"
  stack.style.flexDirection = "column"
  root.append(stack)
  root.getBoundingClientRect = () => box(1316)
  stack.getBoundingClientRect = () => box(1316)
  for (const height of [167, 351, 613, 151]) {
    const section = document.createElement("section")
    section.getBoundingClientRect = () => box(height)
    section.textContent = String(height)
    stack.append(section)
  }
  assert.deepEqual(collectReplyAtoms([root], 811).map((atom) => atom.height), [167, 351, 613, 151])
})

test("reply elements skip process siblings and nested marks", () => {
  const root = document.createElement("div")
  root.innerHTML = "<div data-reply>Answer</div><section class='process'>tool</section><div data-reply><p>More</p><div data-reply>nested</div></div>"
  assert.deepEqual(replyElements(root).map((node) => node.textContent), ["Answer", "Morenested"])
})

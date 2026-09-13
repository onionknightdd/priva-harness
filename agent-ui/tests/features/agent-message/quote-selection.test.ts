import assert from "node:assert/strict"
import { test } from "node:test"

import { appendQuotedDraft, readMessageSelection, selectionActionsPosition } from "../../../src/features/agent-message/quote-selection.ts"
import { parseMessageSelections, serializeMessageSelections } from "../../../src/features/agent-message/message-select-action.ts"

test("quoting preserves a draft and keeps all selected lines in one Markdown quote", () => {
  assert.equal(appendQuotedDraft("已有草稿  \n", " 第一行\r\n\r\n第二行 "), "已有草稿\n\n> 第一行\n>\n> 第二行\n\n")
  assert.equal(appendQuotedDraft("", "片段"), "> 片段\n\n")
})

test("empty file quotes do not modify a draft", () => {
  assert.equal(appendQuotedDraft("已有草稿\n", " \n "), "已有草稿\n")
})

test("file references insert the complete absolute path including spaces and Unicode", () => {
  const path = "/workspace/项目目录/销售 报表.csv"
  assert.equal(appendQuotedDraft("", path), `> ${path}\n\n`)
})

test("file quotes retain visible paragraph spacing after an inline message reference", () => {
  const quote = { type: "selection", selection: { messageRole: "assistant", selectedText: "完整原文" } } as const
  const draft = serializeMessageSelections([quote])
  assert.deepEqual(parseMessageSelections(appendQuotedDraft(draft, "/workspace/file.txt")), [quote, { type: "text", text: "\n\n> /workspace/file.txt\n\n" }])
})

test("selection actions sit below the selection and flip above near the viewport bottom", () => {
  const viewport = { width: 800, height: 600 }
  const menu = { width: 240, height: 36 }
  assert.deepEqual(selectionActionsPosition({ left: 200, top: 100, bottom: 140, width: 200 }, menu, viewport),
    { left: 180, top: 148, placeAbove: false })
  assert.deepEqual(selectionActionsPosition({ left: 200, top: 550, bottom: 580, width: 200 }, menu, viewport),
    { left: 180, top: 506, placeAbove: true })
})

test("selection actions stay inside narrow and partially scrolled viewports", () => {
  const menu = { width: 240, height: 36 }
  const viewport = { width: 390, height: 600 }
  assert.equal(selectionActionsPosition({ left: 0, top: 10, bottom: 40, width: 20 }, menu, viewport).left, 8)
  assert.equal(selectionActionsPosition({ left: 380, top: 10, bottom: 40, width: 10 }, menu, viewport).left, 142)
  assert.equal(selectionActionsPosition({ left: 0, top: -100, bottom: 900, width: 390 }, menu, viewport).top, 8)
})

test("only a nonempty selection within the same message surface enables actions, with its source role", () => {
  const previous = ["Node", "window"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  let role = "assistant"
  const surface = { getAttribute: () => role }
  const node = (owner: object | null) => ({ nodeType: 1, closest: () => owner })
  const rect = { left: 10, top: 10, width: 100, height: 20, bottom: 30 }
  const selection = {
    isCollapsed: false, rangeCount: 1,
    anchorNode: node(surface), focusNode: node(surface),
    toString: () => " selected\u00a0text ",
    getRangeAt: () => ({ getBoundingClientRect: () => rect }),
  }
  Object.defineProperty(globalThis, "Node", { configurable: true, value: { ELEMENT_NODE: 1 } })
  Object.defineProperty(globalThis, "window", { configurable: true, value: { getSelection: () => selection } })
  try {
    assert.deepEqual(readMessageSelection(), { selectedText: "selected text", messageRole: "assistant", rect })
    role = "user"
    assert.deepEqual(readMessageSelection(), { selectedText: "selected text", messageRole: "user", rect })
    role = "system"
    assert.equal(readMessageSelection(), null)
    role = "assistant"
    selection.focusNode = node({})
    assert.equal(readMessageSelection(), null)
    selection.focusNode = node(null)
    assert.equal(readMessageSelection(), null)
    selection.focusNode = node(surface)
    selection.isCollapsed = true
    assert.equal(readMessageSelection(), null)
    selection.isCollapsed = false
    selection.toString = () => " \n "
    assert.equal(readMessageSelection(), null)
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})

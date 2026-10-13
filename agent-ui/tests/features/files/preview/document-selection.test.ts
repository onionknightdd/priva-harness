import assert from "node:assert/strict"
import { test } from "node:test"
import { JSDOM } from "jsdom"
import type { DocxTextSelectionContext } from "@silurus/ooxml/docx"

import { documentPreviewSelection } from "../../../../src/features/files/preview/renderers/document-selection.ts"

function fixture() {
  const dom = new JSDOM(`<div id="root">
    <div><canvas width="1600" height="2000"></canvas><div data-ooxml-selection-surface="docx" data-page-index="0"><span> Hello </span></div></div>
    <div><canvas width="1600" height="2000"></canvas><div data-ooxml-selection-surface="docx" data-page-index="1"><span>中文</span></div></div>
  </div><span id="outside">Outside</span>`)
  const root = dom.window.document.getElementById("root")!
  const canvases = root.querySelectorAll("canvas")
  canvases[0].getBoundingClientRect = () => new dom.window.DOMRect(100, 50, 400, 500)
  canvases[1].getBoundingClientRect = () => new dom.window.DOMRect(100, 570, 400, 500)
  const range = dom.window.document.createRange()
  const spans = root.querySelectorAll("span")
  range.setStart(spans[0].firstChild!, 0)
  range.setEnd(spans[1].firstChild!, 2)
  range.getClientRects = () => [
    new dom.window.DOMRect(120, 70, 100, 10),
    new dom.window.DOMRect(90, 580, 30, 10),
    new dom.window.DOMRect(100, 555, 30, 10),
  ] as unknown as DOMRectList
  const selection = dom.window.getSelection()!
  selection.addRange(range)
  const context: DocxTextSelectionContext = {
    format: "docx",
    kind: "text",
    text: " Hello \n中文",
    pageIndexes: [0, 1],
    paragraphIds: ["p1", "p2"],
    runs: [
      { pageIndex: 0, runIndex: 1, paragraphId: "p1", source: { story: "body", storyInstance: "body", path: [0, 1] } },
      { pageIndex: 1, runIndex: 2, paragraphId: "p2", source: { story: "header", storyInstance: "rId2", path: [0] } },
    ],
    truncated: false,
    truncationReasons: [],
    textCharacters: 10,
    maxTextCharacters: 1000,
    maxRunLocators: 100,
  }
  return { dom, root, selection, context }
}

test("DOCX maps cross-page browser rectangles to points independently of canvas DPR", () => {
  const { dom, root, context } = fixture()
  try {
    const result = documentPreviewSelection(root, context, 0.75)!
    assert.deepEqual(result.boxes, [
      { surfaceIndex: 0, x: 20, y: 20, width: 100, height: 10 },
      { surfaceIndex: 1, x: 0, y: 10, width: 20, height: 10 },
    ])
    assert.equal(result.coordinateSpace, "docx-page-points")
    assert.equal(result.text, " Hello \n中文")
    assert.deepEqual(result.pageIndexes, [0, 1])
    assert.deepEqual(result.paragraphIds, ["p1", "p2"])
    assert.deepEqual(result.runs, context.runs)
    assert.notEqual(result.runs[0].source!.path, context.runs[0].source!.path)
    assert.deepEqual(documentPreviewSelection(root, context, 1.5)!.boxes![0], {
      surfaceIndex: 0, x: 10, y: 10, width: 50, height: 5,
    })
  } finally {
    dom.window.close()
  }
})

test("DOCX keeps truncation explicit and clears collapsed, outside or invalid selections", () => {
  const { dom, root, selection, context } = fixture()
  try {
    const truncated = { ...context, truncated: true, truncationReasons: ["runs" as const] }
    const result = documentPreviewSelection(root, truncated, 1)!
    assert.equal(result.truncated, true)
    assert.deepEqual(result.truncationReasons, ["runs"])
    for (const scale of [0, -1, Number.NaN, Infinity]) {
      assert.equal(documentPreviewSelection(root, context, scale), null)
    }
    assert.equal(documentPreviewSelection(root, null, 1), null)
    selection.collapseToStart()
    assert.equal(documentPreviewSelection(root, context, 1), null)
    const outsideRange = dom.window.document.createRange()
    outsideRange.selectNodeContents(dom.window.document.getElementById("outside")!)
    selection.removeAllRanges()
    selection.addRange(outsideRange)
    assert.equal(documentPreviewSelection(root, context, 1), null)
  } finally {
    dom.window.close()
  }
})

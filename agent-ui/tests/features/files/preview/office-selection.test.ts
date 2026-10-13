import assert from "node:assert/strict"
import { test } from "node:test"
import { JSDOM } from "jsdom"
import type { XlsxRangeSelectionContext } from "@silurus/ooxml/xlsx"
import type { PptxTextSelectionContext } from "@silurus/ooxml/pptx"

import { xlsxPreviewSelection } from "../../../../src/features/files/preview/renderers/xlsx-selection.ts"
import { presentationPreviewSelection } from "../../../../src/features/files/preview/renderers/presentation-selection.ts"
import { csvLoadOptions, isCsvSource } from "../../../../src/features/files/preview/renderers/spreadsheet-source.ts"

function context(areas: XlsxRangeSelectionContext["selection"]["areas"]): XlsxRangeSelectionContext {
  return {
    format: "xlsx", kind: "range", sheetIndex: 0, sheetName: "Main",
    selection: { areas, activeAreaIndex: 0, activeCell: { row: 2, col: 3 }, extensionAnchor: { row: 2, col: 1 } },
    coordinateCountUpperBound: 6,
    cells: [
      { address: { row: 2, col: 1 }, displayText: "Alpha", valueType: "text", value: "Alpha" },
      { address: { row: 2, col: 3 }, displayText: "20", valueType: "number", value: 20, formula: "SUM(B2,8)" },
      { address: { row: 3, col: 1 }, displayText: "中文", valueType: "text", value: "中文" },
    ],
    truncated: false, truncationReasons: [], maxCells: 2000, textCharacters: 9, maxTextCharacters: 100_000,
  }
}

test("XLSX converts one-based ranges without losing blank cells or formatted values", () => {
  const result = xlsxPreviewSelection(context([{ kind: "cells", top: 2, left: 1, bottom: 3, right: 3 }]), { rows: 600, columns: 41 })
  assert.deepEqual(result.ranges, [{ rowStart: 1, rowEnd: 2, columnStart: 0, columnEnd: 2, address: "A2:C3" }])
  assert.equal(result.text, "Alpha\t\t20\n中文\t\t")
  assert.equal(result.sheetId, "Main")
})

test("row, column and whole-sheet selections retain used-sheet extents", () => {
  const result = xlsxPreviewSelection(context([
    { kind: "rows", firstRow: 2, lastRow: 3 },
    { kind: "columns", firstColumn: 2, lastColumn: 3 },
    { kind: "sheet" },
  ]), { rows: 600, columns: 41 })
  assert.deepEqual(result.ranges.map((range) => range.address), ["A2:AO3", "B1:C600", "A1:AO600"])
  assert.ok(result.text!.split(/\t|\n/).length <= 2004)
})

test("a whole Excel grid cannot allocate unbounded selection text", () => {
  const result = xlsxPreviewSelection(context([{ kind: "cells", top: 1, left: 1, bottom: 1048576, right: 16384 }]), { rows: 1048576, columns: 16384 })
  assert.equal(result.ranges[0].address, "A1:XFD1048576")
  assert.equal(result.text!.length, 1999)
})

test("CSV routing preserves filename and MIME detection without treating XLSM/templates as CSV", () => {
  for (const name of ["table.csv", "table.CSV"]) assert.equal(isCsvSource(name, "application/octet-stream"), true)
  assert.equal(isCsvSource("data", "TEXT/CSV"), true)
  assert.equal(isCsvSource("data", "application/csv"), true)
  assert.equal(isCsvSource("data", "text/csv; charset=utf-8"), true)
  for (const extension of ["xlsx", "xlsm", "xltx", "xltm"]) assert.equal(isCsvSource("table." + extension, "application/octet-stream"), false)
})

test("native CSV loading preserves UTF-8 and UTF-16 BOM encoding and sheet names", () => {
  for (const [bytes, encoding] of [
    [[0xef, 0xbb, 0xbf], "utf-8"],
    [[0xff, 0xfe], "utf-16le"],
    [[0xfe, 0xff], "utf-16be"],
    [[], "utf-8"],
  ] as const) {
    assert.deepEqual(csvLoadOptions("中文.csv", new Uint8Array(bytes).buffer), {
      format: "csv", encoding, sheetName: "中文",
    })
  }
  assert.equal(csvLoadOptions(".csv", new ArrayBuffer(0)).sheetName, "Sheet1")
})

test("PPTX preserves shape identity and maps clipped browser rectangles into slide pixels", () => {
  const dom = new JSDOM('<div id="root"><div data-slide-index="0"><canvas></canvas><span>Hello</span></div></div>')
  const root = dom.window.document.getElementById("root")!
  const canvas = root.querySelector("canvas")!
  canvas.getBoundingClientRect = () => new dom.window.DOMRect(100, 50, 480, 270)
  const range = dom.window.document.createRange()
  range.selectNodeContents(root.querySelector("span")!)
  range.getClientRects = () => [new dom.window.DOMRect(110, 60, 100, 12), new dom.window.DOMRect(90, 50, 30, 10)] as unknown as DOMRectList
  const selection = dom.window.getSelection()!
  selection.addRange(range)
  const textContext: PptxTextSelectionContext = {
    format: "pptx", kind: "text", text: "Hello", slideIndexes: [0], shapeIds: ["2"],
    runs: [{ slideIndex: 0, runIndex: 0, shapeId: "2", elementIndex: 1, origin: "slide" }],
    truncated: false, truncationReasons: [], textCharacters: 5, maxTextCharacters: 1000, maxRunLocators: 100,
  }
  const result = presentationPreviewSelection(root, textContext, 0.5)!
  assert.deepEqual(result.boxes, [
    { surfaceIndex: 0, x: 20, y: 20, width: 200, height: 24 },
    { surfaceIndex: 0, x: 0, y: 0, width: 40, height: 20 },
  ])
  assert.deepEqual(result.nodeIds, ["2"])
  assert.deepEqual(result.nodePaths, ["slides/0/slide/elements/1"])
  selection.removeAllRanges()
  assert.equal(presentationPreviewSelection(root, textContext, 0.5), null)
  assert.equal(presentationPreviewSelection(root, null, 1), null)
  dom.window.close()
})

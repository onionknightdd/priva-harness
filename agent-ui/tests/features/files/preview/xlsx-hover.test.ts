import assert from "node:assert/strict"
import { test } from "node:test"
import type { CellAddress, Worksheet } from "@silurus/ooxml/xlsx"

import { xlsxHoverTarget } from "../../../../src/features/files/preview/renderers/xlsx-hover.ts"

const viewport = { width: 400, height: 180 }
const offset = { x: 75, y: 45 }
function geometry(freezeRows = 0, freezeCols = 0, rightToLeft = false) {
  return ({ row, col }: CellAddress) => {
    const x = 50 + (col - 1) * 100 - (col <= freezeCols ? 0 : offset.x)
    return { x: rightToLeft ? viewport.width - x - 100 : x,
      y: 22 + (row - 1) * 30 - (row <= freezeRows ? 0 : offset.y), width: 100, height: 30 }
  }
}

test("hover geometry locates ordinary or blank cells without including the headers", () => {
  assert.deepEqual(xlsxHoverTarget({ row: 3, col: 3 }, undefined, viewport, offset, geometry()), {
    address: "C3", rects: [{ x: 175, y: 37, width: 100, height: 30 }],
  })
  assert.deepEqual(xlsxHoverTarget({ row: 2, col: 2 }, undefined, viewport, offset, geometry()), {
    address: "B2", rects: [{ x: 75, y: 22, width: 100, height: 15 }],
  })
  assert.equal(xlsxHoverTarget({ row: 1, col: 1 }, undefined, viewport, offset, geometry()), null)
})

test("a merged hover target is split and clipped at both frozen pane boundaries", () => {
  const sheet: Pick<Worksheet, "mergeCells" | "freezeRows" | "freezeCols"> = {
    mergeCells: [{ top: 1, left: 1, bottom: 3, right: 3 }], freezeRows: 1, freezeCols: 1,
  }
  assert.deepEqual(xlsxHoverTarget({ row: 3, col: 2 }, sheet, viewport, offset, geometry(1, 1)), {
    address: "A1:C3", rects: [
      { x: 50, y: 22, width: 100, height: 30 },
      { x: 150, y: 22, width: 125, height: 30 },
      { x: 50, y: 52, width: 100, height: 15 },
      { x: 150, y: 52, width: 125, height: 15 },
    ],
  })
  assert.deepEqual(xlsxHoverTarget({ row: 2, col: 2 }, sheet, viewport, offset, geometry(1, 1)),
    xlsxHoverTarget({ row: 1, col: 1 }, sheet, viewport, offset, geometry(1, 1)))
})

test("RTL hover clipping keeps frozen columns and row headers on the right", () => {
  const sheet = { mergeCells: [{ top: 1, left: 1, bottom: 1, right: 3 }], freezeRows: 1, freezeCols: 1, rightToLeft: true }
  assert.deepEqual(xlsxHoverTarget({ row: 1, col: 2 }, sheet, viewport, offset, geometry(1, 1, true)), {
    address: "A1:C1", rects: [
      { x: 250, y: 22, width: 100, height: 30 },
      { x: 125, y: 22, width: 125, height: 30 },
    ],
  })
})

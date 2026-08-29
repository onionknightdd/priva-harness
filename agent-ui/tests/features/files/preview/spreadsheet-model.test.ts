import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  encodeCellAddress,
  encodeColumnLabel,
  encodeRangeAddress,
  selectionText,
  type SpreadsheetSheet,
} from "../../../../src/features/files/preview/renderers/spreadsheet-model.ts"
import {
  mergeSafeRowRange,
} from "../../../../src/features/files/preview/renderers/spreadsheet-virtualization.ts"

function createSheet(
  overrides: Partial<SpreadsheetSheet> = {}
): SpreadsheetSheet {
  return {
    id: "Sheet1",
    name: "Sheet1",
    originRow: 0,
    originColumn: 0,
    rowCount: 4,
    columnCount: 3,
    totalRows: 4,
    totalColumns: 3,
    truncated: false,
    values: [
      ["Name", "Status", "Notes"],
      ["Alpha", "Ready", "Short"],
      ["Beta", "Running", "The longest note"],
      ["Gamma", "Done", "Medium"],
    ],
    formulas: new Map(),
    merges: [],
    coveredCells: new Set(),
    ...overrides,
  }
}

describe("spreadsheet addresses", () => {
  it("encodes columns, cells, and ranges without loading SheetJS", () => {
    assert.equal(encodeColumnLabel(0), "A")
    assert.equal(encodeColumnLabel(25), "Z")
    assert.equal(encodeColumnLabel(26), "AA")
    assert.equal(encodeColumnLabel(16_383), "XFD")
    assert.equal(encodeCellAddress(8, 27), "AB9")
    assert.equal(
      encodeRangeAddress({
        rowStart: 1,
        rowEnd: 3,
        columnStart: 2,
        columnEnd: 4,
      }),
      "C2:E4"
    )
  })
})

describe("spreadsheet virtualization", () => {
  it("expands a virtual row window to preserve merged cells", () => {
    const sheet = createSheet({
      rowCount: 20,
      totalRows: 20,
      merges: [
        { row: 2, column: 0, rowSpan: 5, columnSpan: 1 },
        { row: 6, column: 1, rowSpan: 4, columnSpan: 1 },
      ],
    })

    assert.deepEqual(mergeSafeRowRange(sheet, 4, 5), {
      start: 2,
      end: 9,
    })
  })

  it("copies selections from rows that are not currently rendered", () => {
    assert.equal(
      selectionText(createSheet(), {
        rowStart: 1,
        rowEnd: 3,
        columnStart: 0,
        columnEnd: 1,
      }),
      "Alpha\tReady\nBeta\tRunning\nGamma\tDone"
    )
  })
})

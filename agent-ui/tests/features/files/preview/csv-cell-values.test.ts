import assert from "node:assert/strict"
import { test } from "node:test"

import { createCsvCellReader } from "../../../../src/features/files/preview/renderers/csv-cell-values.ts"
import { csvLoadOptions } from "../../../../src/features/files/preview/renderers/spreadsheet-source.ts"

test("CSV active-cell values remain available beyond selection-context limits", () => {
  const data = new TextEncoder().encode(
    Array.from({ length: 2_505 }, (_, index) => `row-${index + 1},${index + 1}`).join("\n")
  ).buffer
  const readCell = createCsvCellReader(data)

  assert.equal(readCell({ row: 2_505, col: 1 }), "row-2505")
  assert.equal(readCell({ row: 2_505, col: 2 }), "2505")
  assert.equal(readCell({ row: 1, col: 1 }), "row-1")
  assert.equal(readCell({ row: 2_506, col: 1 }), "")
  assert.equal(readCell({ row: 2_505, col: 3 }), "")
})

test("CSV values match native text, blank-row, quoted-field and BOM semantics", () => {
  const text = 'Name,Notes,Code\r\n中文,"one,two","say ""Hi"""\r\n\r\nAlpha,"two\r\nlines",00123\r\n=SUM(A1:A2),TRUE,  keep spaces  \r\n'
  const sources = [
    new TextEncoder().encode("\ufeff" + text),
    Uint8Array.from(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")])),
    Uint8Array.from(Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, "utf16le").swap16()])),
  ]

  for (const bytes of sources) {
    const data = bytes.buffer as ArrayBuffer
    const readCell = createCsvCellReader(data, csvLoadOptions("table.csv", data).encoding)
    assert.equal(readCell({ row: 1, col: 1 }), "Name")
    assert.equal(readCell({ row: 2, col: 1 }), "中文")
    assert.equal(readCell({ row: 2, col: 2 }), "one,two")
    assert.equal(readCell({ row: 2, col: 3 }), 'say "Hi"')
    assert.equal(readCell({ row: 3, col: 1 }), "")
    assert.equal(readCell({ row: 4, col: 2 }), "two\nlines")
    assert.equal(readCell({ row: 4, col: 3 }), "00123")
    assert.equal(readCell({ row: 5, col: 1 }), "=SUM(A1:A2)")
    assert.equal(readCell({ row: 5, col: 2 }), "TRUE")
    assert.equal(readCell({ row: 5, col: 3 }), "  keep spaces  ")
  }
})

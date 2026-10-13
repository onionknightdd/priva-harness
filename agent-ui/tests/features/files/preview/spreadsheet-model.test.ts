import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  encodeCellAddress,
  encodeColumnLabel,
  encodeRangeAddress,
} from "../../../../src/features/files/preview/renderers/spreadsheet-model.ts"

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

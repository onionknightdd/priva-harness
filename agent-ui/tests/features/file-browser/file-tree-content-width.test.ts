import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  FILE_TREE_OVERFLOW_BUFFER_PX,
  fileTreeMaxNameOverflow,
  fileTreeTargetPanelWidth,
} from "../../../src/features/file-browser/file-tree-content-width.ts"

describe("fileTreeMaxNameOverflow", () => {
  it("returns zero when every name fits its slot", () => {
    assert.equal(
      fileTreeMaxNameOverflow([
        { nameWidth: 40, nameSlotWidth: 80 },
        { nameWidth: 72, nameSlotWidth: 72 },
      ]),
      0
    )
  })

  it("returns the largest clipped name width", () => {
    assert.equal(
      fileTreeMaxNameOverflow([
        { nameWidth: 90, nameSlotWidth: 80 },
        { nameWidth: 140, nameSlotWidth: 80 },
      ]),
      60
    )
  })
})

describe("fileTreeTargetPanelWidth", () => {
  it("keeps the current width when overflow is only a few pixels", () => {
    assert.equal(
      fileTreeTargetPanelWidth({
        currentWidth: 280,
        overflow: 4,
        maxWidth: 600,
      }),
      280
    )
  })

  it("grows by the overflow plus a buffer, capped at max", () => {
    assert.equal(
      fileTreeTargetPanelWidth({
        currentWidth: 280,
        overflow: 40,
        maxWidth: 600,
      }),
      280 + 40 + FILE_TREE_OVERFLOW_BUFFER_PX
    )

    assert.equal(
      fileTreeTargetPanelWidth({
        currentWidth: 280,
        overflow: 400,
        maxWidth: 360,
      }),
      360
    )
  })
})

import assert from "node:assert/strict"
import test from "node:test"
import { whiteboardExportLayout, whiteboardPdfPage } from "../../../src/features/whiteboard/whiteboard-export-geometry"

test("export bounds include negative geometry and labels with space on every side", () => {
  const result = whiteboardExportLayout([{ x: -90, y: -24, width: 100, height: 40 }, { x: 200, y: 300, width: 400, height: 100 }])
  assert.deepEqual(result.bounds, { x: -90, y: -24, width: 690, height: 424 })
  assert.equal(result.x - 90, 32)
  assert.equal(result.y - 24, 32)
  assert.equal(result.width - (result.x + 600), 32)
  assert.equal(result.height - (result.y + 400), 32)
})

test("large exports shrink uniformly to stay within edge and area limits", () => {
  for (const [width, height] of [[24_000, 900], [10_000, 10_000], [300, 200]]) {
    const layout = whiteboardExportLayout([{ x: -50, y: 30, width, height }])
    assert.ok(layout.width * layout.scale <= 8192)
    assert.ok(layout.height * layout.scale <= 8192)
    assert.ok(layout.width * layout.height * layout.scale ** 2 <= 32_000_001)
    assert.equal(layout.bounds.width, width)
    assert.equal(layout.bounds.height, height)
  }
  assert.throws(() => whiteboardExportLayout([]), /empty/)
  assert.throws(() => whiteboardExportLayout([{ x: NaN, y: 0, width: 1, height: 1 }]), /invalid/)
})

test("PDF pages preserve the full aspect ratio without jsPDF's dimension clamp", () => {
  for (const [width, height] of [[640, 480], [400, 1200], [80_000, 20_000], [200, 50_000]]) {
    const page = whiteboardPdfPage(width, height)
    assert.ok(page.width <= 14400 && page.height <= 14400)
    assert.ok(Math.abs(page.width / page.height - width / height) < 1e-10)
    assert.equal(page.orientation, width > height ? "landscape" : "portrait")
  }
})

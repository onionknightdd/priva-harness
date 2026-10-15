import assert from "node:assert/strict"
import { after, test } from "node:test"
import { strToU8, zipSync } from "fflate"
import { JSDOM } from "jsdom"
import type { PptxElementBounds, PptxElementContext, PptxTextRunInfo } from "@silurus/ooxml/pptx"

import { createPptxElementPicker } from "../../../../src/features/files/office-assist/pptx-element-picker.ts"
import { readPptxSources } from "../../../../src/features/files/office-assist/pptx-source.ts"

const dom = new JSDOM()
Object.assign(globalThis, { DOMParser: dom.window.DOMParser })
after(() => dom.window.close())
const EMU = 9525
const p = "http://schemas.openxmlformats.org/presentationml/2006/main"
const a = "http://schemas.openxmlformats.org/drawingml/2006/main"
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
const xml = (name: string, contents: string) => `<p:${name} xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree>${contents}</p:spTree></p:cSld></p:${name}>`
const rels = (items: [string, string, string][]) => '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${r}/${type}" Target="${target}"/>`).join("") + "</Relationships>"
const cell = (contents = "", attributes = "") => `<a:tc ${attributes}><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${contents}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`
const table = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="7" name="Grid"/></p:nvGraphicFramePr><p:xfrm><a:off x="${100 * EMU}" y="${100 * EMU}"/><a:ext cx="${400 * EMU}" cy="${100 * EMU}"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="${100 * EMU}"/><a:gridCol w="${200 * EMU}"/><a:gridCol w="${100 * EMU}"/></a:tblGrid><a:tr h="${40 * EMU}">${cell("Merged", 'gridSpan="2" rowSpan="2"')}${cell("", 'hMerge="1"')}${cell()}</a:tr><a:tr h="${60 * EMU}">${cell("", 'vMerge="1"')}${cell("", 'hMerge="1" vMerge="1"')}${cell()}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
const picture = (x: number) => `<p:pic><p:nvPicPr><p:cNvPr id="7" name="Picture"/></p:nvPicPr><p:spPr><a:xfrm><a:off x="${x * EMU}" y="${10 * EMU}"/><a:ext cx="${80 * EMU}" cy="${60 * EMU}"/></a:xfrm></p:spPr></p:pic>`

function fixture(slide = table, master = "") {
  const entries = {
    "_rels/.rels": rels([["office", "officeDocument", "ppt/presentation.xml"]]),
    "ppt/presentation.xml": `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldIdLst><p:sldId id="987" r:id="actual-slide"/></p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": rels([["actual-slide", "slide", "slides/custom-name.xml"]]),
    "ppt/slides/custom-name.xml": xml("sld", slide),
    "ppt/slides/_rels/custom-name.xml.rels": rels([["layout", "slideLayout", "../slideLayouts/layout9.xml"]]),
    "ppt/slideLayouts/layout9.xml": xml("sldLayout", ""),
    "ppt/slideLayouts/_rels/layout9.xml.rels": rels([["master", "slideMaster", "../slideMasters/master3.xml"]]),
    "ppt/slideMasters/master3.xml": xml("sldMaster", master),
  }
  return zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(value)]))).buffer as ArrayBuffer
}

function context(changes: Partial<PptxElementContext> = {}): PptxElementContext {
  return {
    format: "pptx", kind: "element", slideIndex: 0, elementIndex: 0, elementType: "table", origin: "slide",
    point: { x: 0, y: 0 },
    bounds: { x: 100 * EMU, y: 100 * EMU, width: 400 * EMU, height: 100 * EMU, rotation: 0, flipH: false, flipV: false },
    text: "Merged", truncated: false, truncationReasons: [], textCharacters: 6, maxTextCharacters: 16384,
    ...changes,
  }
}

function presentation(hit: PptxElementContext, runs: PptxTextRunInfo[] = [], bounds?: PptxElementBounds[]) {
  return {
    slideWidth: 960 * EMU,
    getElementContextAt: async (_index: number, point: { x: number; y: number }) => ({ ...hit, point }),
    getElementBoundsByIds: async () => bounds ?? [{ elementId: "7", elementIndex: 0, origin: hit.origin, elementType: hit.elementType, bounds: hit.bounds }] as PptxElementBounds[],
    collectSlideRuns: async () => runs,
  }
}

test("PPTX source locations follow slide relationships and preserve actual part and XPath", () => {
  const sources = readPptxSources(fixture())
  assert.equal(sources[0].part, "ppt/slides/custom-name.xml")
  assert.equal(sources[0].objects[0].id, "7")
  assert.equal(sources[0].objects[0].xpath, "/p:sld[1]/p:cSld[1]/p:spTree[1]/p:graphicFrame[1]")
})

test("PPTX hits merged and empty cells from the source grid, with whole-table parent selection", async () => {
  const api = presentation(context())
  let nativePoint: { x: number; y: number } | undefined
  const originalHit = api.getElementContextAt
  api.getElementContextAt = async (index, point) => { nativePoint = point; return originalHit(index, point) }
  const picker = await createPptxElementPicker(api, fixture())
  const merged = await picker.hitTest(0, { x: 250, y: 175 })
  assert.deepEqual(nativePoint, { x: 250 * EMU, y: 175 * EMU })
  assert.equal(merged?.elementType, "table-cell")
  assert.equal(merged?.text, "Merged")
  assert.deepEqual(merged?.boxes[0], { surfaceIndex: 0, x: 100, y: 100, width: 300, height: 100, rotation: 0 })
  assert.equal(merged?.locator.row, 0)
  assert.equal(merged?.locator.column, 0)
  assert.match(merged?.locator.xpath ?? "", /a:tr\[1\]\/a:tc\[1\]$/)
  const empty = await picker.hitTest(0, { x: 450, y: 175 })
  assert.equal(empty?.text, "")
  assert.equal(empty?.locator.row, 1)
  assert.equal(empty?.locator.column, 2)
  assert.deepEqual(empty?.boxes[0], { surfaceIndex: 0, x: 400, y: 140, width: 100, height: 60, rotation: 0 })
  const parent = await picker.hitTest(0, { x: 450, y: 175 }, { parent: true })
  assert.equal(parent?.elementType, "table")
  assert.equal(parent?.locator.shapeId, "7")
  const scaled = context({ bounds: { ...context().bounds, width: 800 * EMU, height: 200 * EMU } })
  const groupedPicker = await createPptxElementPicker(presentation(scaled), fixture())
  assert.deepEqual((await groupedPicker.hitTest(0, { x: 800, y: 250 }))?.boxes[0], {
    surfaceIndex: 0, x: 700, y: 180, width: 200, height: 120, rotation: 0,
  })
})

test("PPTX cell picking respects object rotation and flips", async () => {
  const hit = context({ bounds: { ...context().bounds, rotation: 90, flipH: true, flipV: true } })
  const picker = await createPptxElementPicker(presentation(hit), fixture())
  // Source cell (row 1, column 2), after both flips and a quarter turn.
  const target = await picker.hitTest(0, { x: 325, y: 0 })
  assert.equal(target?.locator.row, 1)
  assert.equal(target?.locator.column, 2)
  assert.deepEqual(target?.boxes[0], { surfaceIndex: 0, x: 270, y: -30, width: 100, height: 60, rotation: 90 })
  assert.equal(target?.locator.flipH, true)
  assert.equal(target?.locator.flipV, true)
})

test("PPTX uses rendered row boundaries to locate empty cells beside expanded content", async () => {
  const dynamicTable = table.replace('gridSpan="2" rowSpan="2"', "").replaceAll('hMerge="1"', "").replaceAll('vMerge="1"', "")
  const run: PptxTextRunInfo = {
    elementIndex: 0, origin: "slide", shapeId: "7", text: "Merged", tableCell: { row: 0, column: 0 },
    shapeX: 100, shapeY: 100, shapeW: 100, shapeH: 80, inShapeX: 0, inShapeY: 0, w: 30, h: 16, font: "Arial", fontSize: 16, rotation: 0,
  }
  const picker = await createPptxElementPicker(presentation(context(), [run]), fixture(dynamicTable))
  const target = await picker.hitTest(0, { x: 450, y: 190 })
  assert.equal(target?.locator.row, 1)
  assert.deepEqual(target?.boxes[0], { surfaceIndex: 0, x: 400, y: 180, width: 100, height: 60, rotation: 0 })
})

test("PPTX resolves inherited picture identity even when a slide has the same object ID", async () => {
  const hit = context({ elementType: "picture", origin: "master", elementIndex: 0, text: undefined,
    bounds: { x: 20 * EMU, y: 10 * EMU, width: 80 * EMU, height: 60 * EMU, rotation: 0, flipH: false, flipV: false } })
  const api = presentation(hit, [], [{ elementId: "7", elementIndex: 1, origin: "slide", elementType: "picture", bounds: { ...hit.bounds, x: 300 * EMU } }])
  const picker = await createPptxElementPicker(api, fixture(picture(300), picture(20)))
  const target = await picker.hitTest(0, { x: 30, y: 20 })
  assert.equal(target?.elementType, "image")
  assert.equal(target?.locator.part, "ppt/slideMasters/master3.xml")
  assert.equal(target?.locator.origin, "master")
  assert.equal(target?.locator.shapeId, "7")
})

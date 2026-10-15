import assert from "node:assert/strict"
import { test } from "node:test"
import { JSDOM } from "jsdom"
import { strToU8, zipSync } from "fflate"
import type { DocxDocument, DocxDocumentModel, DocxPageElementRegion } from "@silurus/ooxml/docx"

import { createDocxElementPicker } from "../../../../src/features/files/office-assist/docx-element-picker.ts"
import { createDocxSourceIndex } from "../../../../src/features/files/office-assist/docx-source.ts"

const word = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
const relation = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
const modelParagraph = (text: string) => ({ type: "paragraph", runs: [{ type: "text", text }] })

function packageData(body: string, extras: Record<string, string> = {}) {
  const files = {
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="doc" Type="${relation}/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `<w:document xmlns:w="${word}" xmlns:r="${relation}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body>${body}</w:body></w:document>`,
    ...extras,
  }
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)]))).buffer as ArrayBuffer
}

function withDomParser<T>(run: () => T) {
  const dom = new JSDOM()
  const previous = Object.getOwnPropertyDescriptor(globalThis, "DOMParser")
  Object.defineProperty(globalThis, "DOMParser", { configurable: true, value: dom.window.DOMParser })
  const restore = () => {
    if (previous) Object.defineProperty(globalThis, "DOMParser", previous)
    else Reflect.deleteProperty(globalThis, "DOMParser")
    dom.window.close()
  }
  try {
    const result = run()
    if (result instanceof Promise) return result.finally(restore)
    restore()
    return result
  } catch (error) {
    restore()
    throw error
  }
}

test("DOCX source locators retain original XML paragraphs across explicit breaks and actual header parts", () => withDomParser(() => {
  const data = packageData(
    p("First") + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
    '<w:p w14:paraId="AABB1122"><w:r><w:t>After break</w:t></w:r></w:p>' +
    '<w:sectPr><w:headerReference w:type="default" r:id="header"/></w:sectPr>',
    {
      "word/_rels/document.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="header" Type="${relation}/header" Target="headers/custom.xml"/></Relationships>`,
      "word/headers/custom.xml": `<w:hdr xmlns:w="${word}">${p("Header")}</w:hdr>`,
    },
  )
  const model = {
    body: [modelParagraph("First"), { type: "pageBreak" }, modelParagraph("After break")],
    headers: { default: { body: [modelParagraph("Header")] }, first: null, even: null },
    footers: { default: null, first: null, even: null },
  } as unknown as DocxDocumentModel
  const index = createDocxSourceIndex(data, model)
  const source = index.resolve({ story: "body", storyInstance: "body", path: [2] }, "paragraph")!
  assert.equal(source.text, "After break")
  assert.equal(source.locator.paragraphId, "AABB1122")
  assert.match(source.locator.xpath!, /local-name\(\)='p'\]\[3\]$/)
  assert.equal(index.resolve({ story: "header", storyInstance: "default", path: [0] }, "paragraph")!.locator.part, "word/headers/custom.xml")
}))

test("DOCX picking uses real padded cell regions, parent tables and cross-page merged ownership", () => withDomParser(async () => {
  const data = packageData(
    '<w:tbl><w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>' + p("Owned") +
    '</w:tc><w:tc>' + p("") + '</w:tc></w:tr><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr>' + p("") +
    '</w:tc><w:tc>' + p("") + '</w:tc></w:tr></w:tbl><w:sectPr/>',
  )
  const cell = (text: string, vMerge: boolean | null = null) => ({ colSpan: 1, vMerge, content: [modelParagraph(text)] })
  const model = {
    body: [{ type: "table", rows: [
      { cells: [cell("Owned", true), cell("")] },
      { cells: [cell("", false), cell("")] },
    ] }],
    headers: { default: null, first: null, even: null },
    footers: { default: null, first: null, even: null },
  } as unknown as DocxDocumentModel
  const region = (pageIndex: number, elementType: DocxPageElementRegion["elementType"], path: number[], xPt: number, yPt: number, widthPt: number, heightPt: number): DocxPageElementRegion => ({
    pageIndex, elementType, source: { story: "body", storyInstance: "body", path }, bounds: { xPt, yPt, widthPt, heightPt },
  })
  const pages = [
    [region(0, "table", [0], 10, 20, 200, 160), region(0, "table-cell", [0, 0, 0], 10, 20, 100, 160),
      region(0, "paragraph", [0, 0, 0, 0], 20, 35, 70, 16), region(0, "table-cell", [0, 0, 1], 110, 20, 100, 80)],
    [region(1, "table", [0], 10, 20, 200, 80), region(1, "table-cell", [0, 1, 0], 10, 20, 100, 80)],
  ]
  const document = {
    mode: "main", document: model, pageCount: 2,
    waitUntilLayoutComplete: async () => {},
    getPageElementRegions: async (pageIndex: number) => pages[pageIndex],
  } as unknown as DocxDocument
  const picker = await createDocxElementPicker(document, data)
  assert.equal((await picker.hitTest(0, { x: 25, y: 40 }))!.elementType, "paragraph")
  const emptyCell = (await picker.hitTest(0, { x: 150, y: 50 }))!
  assert.equal(emptyCell.elementType, "table-cell")
  assert.equal(emptyCell.text, "")
  assert.deepEqual(emptyCell.boxes[0], { surfaceIndex: 0, x: 110, y: 20, width: 100, height: 80 })
  const merged = (await picker.hitTest(1, { x: 30, y: 50 }))!
  assert.deepEqual(merged.locator.path, [0, 0, 0])
  assert.equal(merged.text, "Owned")
  assert.equal(merged.boxes.length, 2)
  const table = (await picker.hitTest(0, { x: 25, y: 40 }, { parent: true }))!
  assert.equal(table.elementType, "table")
  assert.equal(table.boxes.length, 2)
  assert.equal((await picker.hitTest(0, { x: 10, y: 70 }))!.elementType, "table")
}))

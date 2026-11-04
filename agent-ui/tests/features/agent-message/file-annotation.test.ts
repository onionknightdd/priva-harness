import assert from "node:assert/strict"
import { test } from "node:test"

import { fileAnnotationLabel, formatFileAnnotation, isElementFileAnnotation, isOfficeFileAnnotation, parseFileAnnotationBlock, type FileAnnotation, type HtmlFileAnnotation, type OfficeFileAnnotation } from "../../../src/features/agent-message/file-annotation.ts"
import { messageSelectionDisplayText, parseMessageSelections, serializeMessageSelections, type MessageSelectionPart } from "../../../src/features/agent-message/message-select-action.ts"

test("file annotations retain text and spreadsheet fields in the requested protocol", () => {
  const text: FileAnnotation = { kind: "text", filePath: "/workspace/main.ts", lineNum: "L2-L4", selectedText: "first\n\nlast" }
  assert.equal(formatFileAnnotation(text), "```file_annotation\nfile_path: /workspace/main.ts\nline_num: L2-L4\nselected_text: first\n\nlast\n```")
  const sheet: FileAnnotation = { kind: "spreadsheet", filePath: "/workspace/report.csv", sheet: "report", cell: "A1:C4" }
  assert.equal(formatFileAnnotation(sheet), "```file_annotation\nfile_path: /workspace/report.csv\nsheet: report\ncell: A1:C4\n```")
  for (const annotation of [text, sheet, { ...sheet, sheet: "Sales\n2026" }, { ...text, filePath: "C:\\workspace\\line\nname.ts" }]) {
    assert.deepEqual(parseFileAnnotationBlock(formatFileAnnotation(annotation)), annotation)
  }
  assert.equal(fileAnnotationLabel(text), "main.ts L2-L4")
  assert.equal(fileAnnotationLabel(sheet), "report.csv A1:C4")
})

test("file annotations roundtrip alongside message references and user text", () => {
  const parts: MessageSelectionPart[] = [
    { type: "text", text: "先看 " },
    { type: "selection", selection: { messageRole: "assistant", selectedText: "原话" } },
    { type: "text", text: "\n\n" },
    { type: "file_annotation", annotation: { kind: "spreadsheet", filePath: "/workspace/report.xlsx", sheet: "Sales 2026", cell: "'Sales 2026'!A1:C4" } },
    { type: "text", text: "\n解释数据" },
  ]
  assert.deepEqual(parseMessageSelections(serializeMessageSelections(parts)), parts)
  assert.equal(messageSelectionDisplayText(parts), "先看 \"原话\"\n\nreport.xlsx 'Sales 2026'!A1:C4\n解释数据")
})

test("nested fences, invalid metadata and protocol examples remain intact", () => {
  const annotation: FileAnnotation = { kind: "text", filePath: "/workspace/main.ts", lineNum: "L1-L3", selectedText: "```ts\nconst answer = 42\n```" }
  const formatted = formatFileAnnotation(annotation)
  assert.ok(formatted.startsWith("````file_annotation\n"))
  assert.deepEqual(parseMessageSelections(formatted), [{ type: "file_annotation", annotation }])
  for (const content of [
    formatted.slice(0, -4),
    formatted.replace("line_num: L1-L3", "cell: A1"),
    `\`\`\`\`\`markdown\n${formatted}\n\`\`\`\`\``,
    "> " + formatted.replaceAll("\n", "\n> "),
  ]) {
    assert.deepEqual(parseMessageSelections(content), [{ type: "text", text: content }])
  }
})

const office: OfficeFileAnnotation = {
  kind: "document", filePath: "/workspace/报告.docx", fileRevision: "a".repeat(64), selectionId: "selection-1", index: 1,
  elementType: "paragraph", selectedText: "保留完整内容\n```example```", coordinateSpace: "docx-page-points",
  boxes: [{ surfaceIndex: 1, x: 20, y: 35, width: 120, height: 28 }],
  locator: { part: "word/document.xml", xpath: "/w:document/w:body/w:p[3]", path: [2], paragraphId: "00112233", story: "body", storyInstance: "" },
}

test("Office annotations retain native source locators, file revision and document coordinates", () => {
  const presentation: OfficeFileAnnotation = {
    ...office, kind: "presentation", filePath: "/workspace/slides.pptx", elementType: "shape", coordinateSpace: "pptx-slide-pixels",
    boxes: [{ surfaceIndex: 2, x: 60, y: 90, width: 250, height: 70, rotation: 15 }],
    locator: { part: "ppt/slides/slide3.xml", xpath: "/p:sld/p:cSld/p:spTree/p:sp[p:nvSpPr/p:cNvPr/@id='7']", shapeId: "7", elementIndex: 2, origin: "slide" },
  }
  for (const annotation of [office, presentation]) {
    const formatted = formatFileAnnotation(annotation)
    assert.deepEqual(parseFileAnnotationBlock(formatted), annotation)
    const parts: MessageSelectionPart[] = [{ type: "file_annotation", annotation }, { type: "text", text: "\n请解释所选内容" }]
    assert.deepEqual(parseMessageSelections(serializeMessageSelections(parts)), parts)
    assert.match(formatted, annotation.kind === "document" ? /"page_num": 2/ : /"slide_num": 3/)
    assert.ok(formatted.includes('"file_revision": "' + "a".repeat(64) + '"'))
  }
  assert.equal(fileAnnotationLabel(office), "报告.docx p.2 · #1")
  assert.equal(fileAnnotationLabel(presentation), "slides.pptx slide 3 · #1")
})

test("invalid Office annotations remain plain text instead of creating an incomplete reference", () => {
  const formatted = formatFileAnnotation(office)
  for (const invalid of [
    formatted.replace('"page_num": 2', '"page_num": 0'),
    formatted.replace('"width": 120', '"width": -1'),
    formatted.replace('"index": 1', '"index": 0'),
    formatted.replace('"docx-page-points"', '"pptx-slide-pixels"'),
    formatted.replace(`"${"a".repeat(64)}"`, '"missing-revision"'),
    formatted.replace('"part": "word/document.xml"', '"part": ""'),
  ]) assert.deepEqual(parseMessageSelections(invalid), [{ type: "text", text: invalid }])
})

const html: HtmlFileAnnotation = {
  kind: "html", filePath: "/workspace/index.html", fileRevision: "b".repeat(64), selectionId: "selection-html-2", index: 2,
  elementType: "element", selectedText: "Save ```example```", coordinateSpace: "html-viewport-css-pixels",
  boxes: [{ surfaceIndex: 0, x: -12.5, y: 80, width: 120, height: 40 }],
  locator: { documentId: "document-1", nodeId: "node-3", selectors: ["#settings", "button:nth-of-type(2)"], tagName: "button", snapshotHash: "0123456789abcdef" },
  html: '<button aria-label="Save">Save ```example```</button>', ancestors: ["main#settings", "section.card"],
  textTruncated: false, htmlTruncated: false,
}

test("HTML element annotations roundtrip bounded context, shadow-root selectors and viewport coordinates", () => {
  assert.equal(isElementFileAnnotation(html), true)
  assert.equal(isOfficeFileAnnotation(html), false)
  assert.equal(isElementFileAnnotation(office), true)
  const formatted = formatFileAnnotation(html)
  assert.ok(formatted.startsWith("````file_annotation\n"))
  assert.deepEqual(parseFileAnnotationBlock(formatted), html)
  assert.match(formatted, /"coordinate_space": "html-viewport-css-pixels"/)
  assert.match(formatted, /"surface_index": 0/)
  assert.match(formatted, /"document_id": "document-1"/)
  assert.match(formatted, /"snapshot_hash": "0123456789abcdef"/)
  assert.doesNotMatch(formatted, /page_num|slide_num|filePath|documentId|textTruncated/)
  const draft = { ...html, label: "Picker-only label", text: "Picker-only text" }
  assert.equal(formatFileAnnotation(draft), formatted)
  assert.equal(fileAnnotationLabel(html), "index.html · #2 <button>")
  const parts: MessageSelectionPart[] = [{ type: "file_annotation", annotation: html }, { type: "text", text: "\n修改这个按钮" }]
  assert.deepEqual(parseMessageSelections(serializeMessageSelections(parts)), parts)
  assert.equal(messageSelectionDisplayText(parts), "index.html · #2 <button>\n修改这个按钮")
})

test("HTML image references permit empty selected text and preserve explicit truncation flags", () => {
  const image: typeof html = {
    ...html, selectedText: "", html: '<img alt="Example">', ancestors: [],
    locator: { ...html.locator, selectors: ["img"], tagName: "img" }, textTruncated: true, htmlTruncated: true,
  }
  assert.deepEqual(parseFileAnnotationBlock(formatFileAnnotation(image)), image)
})

test("malformed or oversized HTML annotation metadata remains plain text", () => {
  type JsonRecord = Record<string, unknown>
  const raw = JSON.parse(formatFileAnnotation(html).split("\n").slice(1, -1).join("\n")) as JsonRecord
  const invalid: ((value: JsonRecord) => void)[] = [
    (value) => { value.extra = true },
    (value) => { delete value.html_truncated },
    (value) => { value.file_path = " " },
    (value) => { value.file_path = "x".repeat(4097) },
    (value) => { value.file_revision = "not-a-file-revision" },
    (value) => { value.selection_id = "x".repeat(129) },
    (value) => { value.index = 0 },
    (value) => { value.index = 1.5 },
    (value) => { value.element_type = "paragraph" },
    (value) => { value.coordinate_space = "docx-page-points" },
    (value) => { value.selected_text = "x".repeat(4001) },
    (value) => { value.html = "x".repeat(8001) },
    (value) => { value.text_truncated = "false" },
    (value) => { value.html_truncated = null },
    (value) => { value.ancestors = Array(9).fill("main") },
    (value) => { value.ancestors = [42] },
    (value) => { value.ancestors = ["x".repeat(257)] },
    (value) => { value.boxes = [] },
    (value) => { (value.boxes as JsonRecord[])[0].surface_index = 1 },
    (value) => { (value.boxes as JsonRecord[])[0].page_num = 1 },
    (value) => { (value.boxes as JsonRecord[])[0].width = 0 },
    (value) => { (value.boxes as JsonRecord[])[0].height = -1 },
    (value) => { (value.boxes as JsonRecord[])[0].x = 10_000_001 },
    (value) => { (value.boxes as JsonRecord[])[0].y = "80" },
    (value) => { (value.locator as JsonRecord).document_id = "" },
    (value) => { (value.locator as JsonRecord).node_id = "node with spaces" },
    (value) => { (value.locator as JsonRecord).tag_name = "<button>" },
    (value) => { (value.locator as JsonRecord).snapshot_hash = "a".repeat(64) },
    (value) => { (value.locator as JsonRecord).selectors = [] },
    (value) => { (value.locator as JsonRecord).selectors = Array(17).fill("div") },
    (value) => { (value.locator as JsonRecord).selectors = [null] },
    (value) => { (value.locator as JsonRecord).selectors = ["x".repeat(2049)] },
    (value) => { (value.locator as JsonRecord).source_path = "/invented/source.tsx" },
  ]
  for (const mutate of invalid) {
    const value = structuredClone(raw)
    mutate(value)
    const block = "````file_annotation\n" + JSON.stringify(value, null, 2) + "\n````"
    assert.equal(parseFileAnnotationBlock(block), null)
    assert.deepEqual(parseMessageSelections(block), [{ type: "text", text: block }])
  }
})

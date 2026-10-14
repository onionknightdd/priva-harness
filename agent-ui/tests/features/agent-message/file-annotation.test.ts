import assert from "node:assert/strict"
import { test } from "node:test"

import { fileAnnotationLabel, formatFileAnnotation, parseFileAnnotationBlock, type FileAnnotation } from "../../../src/features/agent-message/file-annotation.ts"
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

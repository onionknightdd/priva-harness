import type { FileAnnotation } from "@/features/agent-message/file-annotation"

export function readSourceFileAnnotation(
  surface: HTMLElement,
  range: Range,
  filePath: string,
  content: string
): FileAnnotation | null {
  if (range.collapsed || !surface.contains(range.startContainer) || !surface.contains(range.endContainer)) return null

  const lines = content.split("\n")
  const starts: number[] = []
  let offset = 0
  for (const line of lines) {
    starts.push(offset)
    offset += line.length + 1
  }
  const codeLines = surface.querySelectorAll<HTMLElement>("code[data-source-line]")
  if (!codeLines.length) return null

  function sourcePoint(atStart: boolean) {
    const point = range.cloneRange()
    point.collapse(atStart)
    for (const code of codeLines) {
      const line = Number(code.dataset.sourceLine)
      const lineStart = starts[line - 1]
      if (lineStart === undefined) continue
      const contents = surface.ownerDocument.createRange()
      contents.selectNodeContents(code)
      if (point.compareBoundaryPoints(point.START_TO_START, contents) <= 0) {
        return { offset: lineStart, line }
      }
      if (point.compareBoundaryPoints(point.END_TO_END, contents) <= 0) {
        contents.setEnd(point.startContainer, point.startOffset)
        const text = lines[line - 1]
        const length = line < lines.length && text.endsWith("\r") ? text.length - 1 : text.length
        return { offset: lineStart + Math.min(contents.toString().length, length), line }
      }
    }
    return { offset: content.length, line: lines.length }
  }

  const start = sourcePoint(true)
  const end = sourcePoint(false)
  if (end.offset <= start.offset) return null
  // An endpoint at the next line's start includes the newline, not that next line.
  const endLine = end.offset === starts[end.line - 1] ? end.line - 1 : end.line
  return {
    kind: "text",
    filePath,
    lineNum: `L${start.line}-L${endLine}`,
    // Read the file itself so gutters and empty-line U+200B placeholders never leak.
    selectedText: content.slice(start.offset, end.offset),
  }
}

import type { SelectionActionsRect } from "@/lib/selection-actions-position"

type DomPoint = { node: Node; offset: number }

// A trailing newline has no glyphs of its own. Its caret and client rect sit on
// the next line, often on the line-number gutter. Anchor at the last glyph of
// the current line instead.
export function sourceSelectionAnchor(text: string, backwards: boolean, range: Range): SelectionActionsRect | null {
  if (!backwards && /[\r\n]$/.test(text)) {
    const end = endOfCurrentLine(range)
    const rect = end && rectAt(end.node, end.offset)
    if (rect) return rect
  }

  const endpoint = range.cloneRange()
  endpoint.collapse(backwards)
  const caret = endpoint.getBoundingClientRect()
  if (caret.height > 0) return { left: caret.left, top: caret.top, bottom: caret.bottom, width: 0 }

  const rects = Array.from(range.getClientRects()).filter((rect) => rect.height > 0 && rect.width > 0)
  const rect = backwards ? rects[0] : rects.at(-1)
  return rect ? { left: backwards ? rect.left : rect.right, top: rect.top, bottom: rect.bottom, width: 0 } : null
}

function endOfCurrentLine(range: Range): { node: Text; offset: number } | null {
  let cursor: DomPoint | null = { node: range.endContainer, offset: range.endOffset }
  for (let guard = 0; cursor && guard < 10000; guard++) {
    const before = stepBack(cursor.node, cursor.offset)
    if (!before || before.node.nodeType !== Node.TEXT_NODE) {
      cursor = before
      continue
    }

    const textNode = before.node as Text
    const index = before.offset
    if (range.comparePoint(textNode, index) < 0) return null
    if (unselectable(textNode)) {
      cursor = { node: textNode, offset: 0 }
      continue
    }

    const value = textNode.nodeValue ?? ""
    const char = value.charAt(index)
    if (char === "\n" || char === "\r") {
      let next = index
      while (next > 0 && (value.charAt(next - 1) === "\n" || value.charAt(next - 1) === "\r")) next -= 1
      cursor = { node: textNode, offset: next }
      continue
    }
    if (char === "") {
      cursor = before
      continue
    }
    return { node: textNode, offset: index + 1 }
  }
  return null
}

function rectAt(node: Text, offset: number): SelectionActionsRect | null {
  const owner = node.ownerDocument
  if (!owner) return null
  const range = owner.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  const caret = range.getBoundingClientRect()
  if (caret.height > 0) return { left: caret.left, top: caret.top, bottom: caret.bottom, width: 0 }

  const text = node.nodeValue ?? ""
  let start = offset
  while (start > 0 && offset - start <= 8) {
    const next = previousBoundary(text, start)
    if (next === start) break
    start = next
    range.setStart(node, start)
    range.setEnd(node, offset)
    const glyph = Array.from(range.getClientRects()).filter((rect) => rect.height > 0 && rect.width > 0).at(-1)
    if (glyph) return { left: glyph.right, top: glyph.top, bottom: glyph.bottom, width: 0 }
  }
  return null
}

function previousBoundary(text: string, offset: number): number {
  if (offset <= 0) return offset
  const code = text.charCodeAt(offset - 1)
  if (code >= 0xdc00 && code <= 0xdfff && offset >= 2) return offset - 2
  return offset - 1
}

function unselectable(node: Text): boolean {
  const element = node.parentElement
  return !!element && getComputedStyle(element).userSelect === "none"
}

function endPoint(node: Node): DomPoint {
  if (node.nodeType === Node.TEXT_NODE) return { node, offset: node.nodeValue?.length ?? 0 }
  const last = node.lastChild
  return last ? endPoint(last) : { node, offset: 0 }
}

function stepBack(node: Node, offset: number): DomPoint | null {
  if (node.nodeType === Node.TEXT_NODE && offset > 0) return { node, offset: offset - 1 }
  if (node.nodeType === Node.ELEMENT_NODE && offset > 0) {
    const child = node.childNodes[offset - 1]
    return child ? endPoint(child) : null
  }
  const parent = node.parentNode
  if (!parent) return null
  const index = childIndex(parent, node)
  if (index > 0) {
    const previous = parent.childNodes[index - 1]
    return previous ? endPoint(previous) : null
  }
  if (parent.nodeType !== Node.ELEMENT_NODE) return null
  return { node: parent, offset: 0 }
}

function childIndex(parent: Node, node: Node): number {
  let index = 0
  for (let child = parent.firstChild; child; child = child.nextSibling, index += 1) {
    if (child === node) return index
  }
  return -1
}

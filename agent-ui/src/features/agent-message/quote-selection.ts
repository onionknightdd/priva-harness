import { parseMessageSelections, serializeMessageSelections } from "./message-select-action"

export const MESSAGE_SELECTABLE_ATTR = "data-message-selectable"

export function toQuotedMarkdown(text: string) {
  const normalized = text.replaceAll("\r\n", "\n").trim()
  if (normalized === "") {
    return ""
  }

  return normalized
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n")
}

export function appendQuotedDraft(draft: string, quoted: string) {
  const block = toQuotedMarkdown(quoted)
  if (block === "") {
    return draft
  }

  const parts = parseMessageSelections(draft)
  const last = parts.at(-1)
  if (last?.type === "text") {
    last.text = last.text.replace(/\s+$/, "")
    if (!last.text) parts.pop()
  }
  // Add visible paragraph spacing, independently of the selection protocol's
  // own fence separators (which disappear in the editor).
  return serializeMessageSelections([...parts, { type: "text", text: `${parts.length ? "\n\n" : ""}${block}\n\n` }])
}

export function selectionActionsPosition(rect: { left: number; top: number; bottom: number; width: number },
  menu: { width: number; height: number }, viewport: { width: number; height: number }) {
  const padding = 8
  const left = Math.max(padding, Math.min(rect.left + rect.width / 2 - menu.width / 2, viewport.width - menu.width - padding))
  const below = rect.bottom + padding
  const placeAbove = below + menu.height > viewport.height - padding
  const top = Math.max(padding, Math.min(placeAbove ? rect.top - menu.height - padding : below, viewport.height - menu.height - padding))
  return { left, top, placeAbove }
}

export function readMessageSelection(): { selectedText: string; messageRole: "assistant" | "user"; rect: DOMRect } | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null
  }

  const text = selection.toString().replaceAll("\u00a0", " ").trim()
  if (text === "") {
    return null
  }

  const anchor = nodeElement(selection.anchorNode)
  const focus = nodeElement(selection.focusNode)
  const surface = anchor?.closest(`[${MESSAGE_SELECTABLE_ATTR}]`)
  if (!surface || focus?.closest(`[${MESSAGE_SELECTABLE_ATTR}]`) !== surface) {
    return null
  }

  const range = selection.getRangeAt(0)
  const rect = rangeRect(range)
  if (!rect) {
    return null
  }

  const messageRole = surface.getAttribute(MESSAGE_SELECTABLE_ATTR)
  if (messageRole !== "assistant" && messageRole !== "user") return null
  return { selectedText: text, messageRole, rect }
}

function nodeElement(node: Node | null) {
  if (!node) {
    return null
  }

  return node.nodeType === Node.ELEMENT_NODE
    ? (node as Element)
    : node.parentElement
}

function rangeRect(range: Range) {
  const union = range.getBoundingClientRect()
  if (union.width > 0 || union.height > 0) {
    return union
  }

  const rects = range.getClientRects()
  return rects.item(rects.length - 1) ?? rects.item(0) ?? null
}

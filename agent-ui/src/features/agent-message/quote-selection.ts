export const ASSISTANT_SELECTABLE_ATTR = "data-assistant-selectable"
export const COMPOSER_PROMPT_ATTR = "data-agent-composer"

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

export function appendQuotedDraft(draft: string, quoted: string, instruction = "") {
  const block = toQuotedMarkdown(quoted)
  if (block === "") {
    return draft
  }

  const prefix = draft.trim() === "" ? "" : `${draft.replace(/\s+$/, "")}\n\n`
  return `${prefix}${block}\n\n${instruction ? `${instruction}\n` : ""}`
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

export function focusAgentComposer() {
  const composer = document.querySelector<HTMLTextAreaElement>(
    `[${COMPOSER_PROMPT_ATTR}="prompt"]`
  )
  if (!composer) {
    return
  }

  composer.focus()
  const end = composer.value.length
  composer.setSelectionRange(end, end)
}

export function readAssistantSelection() {
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
  const surface = anchor?.closest(`[${ASSISTANT_SELECTABLE_ATTR}]`)
  if (!surface || focus?.closest(`[${ASSISTANT_SELECTABLE_ATTR}]`) !== surface) {
    return null
  }

  const range = selection.getRangeAt(0)
  const rect = rangeRect(range)
  if (!rect) {
    return null
  }

  return { text, rect }
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

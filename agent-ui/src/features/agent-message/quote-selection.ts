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

export function appendQuotedDraft(draft: string, quoted: string) {
  const block = toQuotedMarkdown(quoted)
  if (block === "") {
    return draft
  }

  if (draft.trim() === "") {
    return `${block}\n\n`
  }

  return `${draft.replace(/\s+$/, "")}\n\n${block}\n\n`
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
  if (
    !anchor?.closest(`[${ASSISTANT_SELECTABLE_ATTR}]`) ||
    !focus?.closest(`[${ASSISTANT_SELECTABLE_ATTR}]`)
  ) {
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

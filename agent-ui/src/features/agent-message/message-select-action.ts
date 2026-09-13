import { parseMarkdownIntoBlocks } from "streamdown"

export type MessageSelection = {
  messageRole: "assistant" | "user"
  selectedText: string
}

export type MessageSelectionPart =
  | { type: "text"; text: string }
  | { type: "selection"; selection: MessageSelection }

export function formatMessageSelection(selection: MessageSelection) {
  // A selected code example may itself contain Markdown fences.
  let longestFence = 0
  for (const match of selection.selectedText.matchAll(/`+/g)) longestFence = Math.max(longestFence, match[0].length)
  const fence = "`".repeat(Math.max(3, longestFence + 1))
  return `${fence}message_select_action\nmessage_role: ${selection.messageRole}\nselected_text: ${selection.selectedText}\n${fence}`
}

export function serializeMessageSelections(parts: readonly MessageSelectionPart[]) {
  return parts.map((part) => part.type === "text" ? part.text : `\n\n${formatMessageSelection(part.selection)}\n\n`).join("")
}

export function parseMessageSelections(content: string): MessageSelectionPart[] {
  if (!content.includes("message_select_action")) return content ? [{ type: "text", text: content }] : []

  const parts: MessageSelectionPart[] = []
  let pendingText = ""
  let separatorRemaining = 0
  for (const block of parseMarkdownIntoBlocks(content)) {
    const selection = parseSelectionBlock(block)
    if (selection) {
      // The serializer supplies two newlines on each side solely to delimit
      // the wire format. Extra newlines still belong to the user's text.
      pendingText = pendingText.replace(/\n{1,2}$/, "")
      if (pendingText) parts.push({ type: "text", text: pendingText })
      pendingText = ""
      parts.push({ type: "selection", selection })
      separatorRemaining = 2
    } else {
      let text = block
      while (separatorRemaining > 0 && text.startsWith("\n")) {
        text = text.slice(1)
        separatorRemaining -= 1
      }
      if (text) separatorRemaining = 0
      pendingText += text
    }
  }
  if (pendingText) parts.push({ type: "text", text: pendingText })
  return parts
}

function parseSelectionBlock(block: string): MessageSelection | null {
  const match = /^(`{3,})message_select_action\r?\nmessage_role: (assistant|user)\r?\nselected_text: ([\s\S]*)\r?\n\1(?:\r?\n)?$/.exec(block)
  if (!match || !match[3].trim()) return null
  // Only the matching outer fence may close this block.
  if (new RegExp(`^${match[1]}[\\t ]*$`, "m").test(match[3])) return null
  return { messageRole: match[2] as MessageSelection["messageRole"], selectedText: match[3] }
}

export function messageSelectionDisplayText(parts: readonly MessageSelectionPart[]) {
  return parts.map((part) => part.type === "text" ? part.text : `"${messageSelectionPreview(part.selection.selectedText)}"`).join("")
}

const selectionCharacters = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export function messageSelectionPreview(text: string) {
  const newline = text.search(/[\r\n]/)
  const firstLine = newline < 0 ? text : text.slice(0, newline)
  let preview = ""
  let length = 0
  for (const { segment } of selectionCharacters.segment(firstLine)) {
    if (length === 10) return `${preview}......`
    preview += segment
    length += 1
  }
  return newline < 0 ? preview : `${preview}......`
}

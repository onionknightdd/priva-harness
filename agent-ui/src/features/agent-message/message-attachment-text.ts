import { parseMarkdownIntoBlocks } from "streamdown"

import type { AgentThreadMessage } from "./agent-message-data"
import type { MessageAttachment } from "./message-attachment"

const ATTACHMENTS_LANGUAGE = "AgentAttachments"

export function messageTextWithAttachments(
  text: string,
  attachments: readonly MessageAttachment[] = []
): string {
  if (attachments.length === 0) return text
  const files = attachments.map((file) => [
    `- name: ${encodeValue(file.name)}`,
    `  path: ${encodeValue(file.path)}`,
    `  MIME: ${encodeValue(file.mimeType)}`,
    `  size: ${file.size} bytes`,
  ].join("\n")).join("\n\n")
  return `${text}${text === "" ? "" : "\n\n"}\`\`\`${ATTACHMENTS_LANGUAGE}\n${files}\n\`\`\``
}

export function attachmentsFromMessageText(text: string): {
  content: string
  attachments: MessageAttachment[]
} | undefined {
  if (!text.includes(ATTACHMENTS_LANGUAGE)) return undefined
  const attachments: MessageAttachment[] = []
  let content = ""
  for (const block of parseMarkdownIntoBlocks(text)) {
    const match = /^ {0,3}(`{3,}|~{3,})[ \t]*AgentAttachments[ \t]*\r?\n([\s\S]*?)\r?\n {0,3}\1[ \t]*(?:\r?\n)?$/.exec(block)
    const files = match ? parseAttachmentList(match[2]) : undefined
    if (files === undefined) {
      content += block
      continue
    }
    attachments.push(...files)
    // Remove only the separator inserted before the code block, preserving
    // the original user text (including its own whitespace).
    if (content.endsWith("\n\n")) content = content.slice(0, -2)
  }
  return attachments.length ? { content, attachments } : undefined
}

/** HTTP history and live messages carry the same transcript manifest. */
export function restoreUserMessageAttachments<
  T extends Pick<AgentThreadMessage, "role" | "content" | "attachments">,
>(message: T): T {
  if (message.role !== "user") return message
  const parsed = attachmentsFromMessageText(message.content)
  if (!parsed) {
    if (!message.attachments?.some((file) => file.mimeType.startsWith("image/"))) return message
    const content = withoutNativeImagePlaceholders(message.content)
    return content === message.content ? message : { ...message, content }
  }
  // Native images may accompany the manifest. Keep them and prefer the
  // structured metadata when both sources refer to the same file.
  const files = new Map([...parsed.attachments, ...message.attachments ?? []]
    .map((file) => [file.path, file]))
  const attachments = [...files.values()]
  const content = attachments.some((file) => file.mimeType.startsWith("image/"))
    ? withoutNativeImagePlaceholders(parsed.content)
    : parsed.content
  return { ...message, content, attachments }
}

/** Claude stores the input chip label next to the image block. The bubble shows the image. */
export function withoutNativeImagePlaceholders(text: string): string {
  return text.replace(/[ \t]*\[Image #\d+\][ \t]*/g, " ").replace(/[ ]{2,}/g, " ").trim()
}

export function attachmentMessageSummary(text: string): string {
  // Session indexes can flatten or truncate the prompt inside the manifest.
  const marker = /(?:`{3,}|~{3,})[ \t]*AgentAttachments\b/.exec(text)
  if (!marker) return text
  const body = text.slice(0, marker.index).trim()
  if (body) return body
  const names = [...text.slice(marker.index).matchAll(/- name: (.*?)(?:\r?\n|[ \t]+path:)/g)]
    .map((match) => decodeValue(match[1]))
  return names.join(", ") || "Attached files"
}

function parseAttachmentList(text: string): MessageAttachment[] | undefined {
  const attachments: MessageAttachment[] = []
  for (const block of text.replaceAll("\r\n", "\n").split("\n\n")) {
    const match = /^- name: ([^\n]+)\n {2}path: ([^\n]+)\n {2}MIME: ([^\n]+)\n {2}size: (\d+) bytes$/.exec(block)
    if (!match) return undefined
    const size = Number(match[4])
    if (!Number.isSafeInteger(size)) return undefined
    attachments.push({ name: decodeValue(match[1]), path: decodeValue(match[2]), mimeType: decodeValue(match[3]), size })
  }
  return attachments
}

function encodeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r/g, "\\r").replace(/\n/g, "\\n")
}

function decodeValue(value: string): string {
  return value.replace(/\\([\\rn])/g, (_, escaped: string) => escaped === "r" ? "\r" : escaped === "n" ? "\n" : "\\")
}

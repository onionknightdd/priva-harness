import type { ActionPayload } from "@a2ui/web_core"
import { z } from "zod"

const actionSchema = z.object({
  name: z.string().min(1),
  surfaceId: z.string().min(1),
  sourceComponentId: z.string().min(1),
  timestamp: z.string().min(1),
  context: z.record(z.string(), z.unknown()),
  userMessage: z.string().optional(),
  catalogId: z.string().optional(),
}).passthrough()

const envelopeSchema = z.object({
  version: z.literal(1),
  toolCallId: z.string().min(1),
  action: actionSchema,
}).strict()

export type UiActionEnvelope = z.infer<typeof envelopeSchema>

const START = "\n\n<priva-a2ui-action>\n"
const END = "\n</priva-a2ui-action>"

/** Keep structured clicks in the native transcript so resume/fork preserve them. */
export function uiActionMessage(toolCallId: string, action: ActionPayload): string {
  const envelope = envelopeSchema.parse({ version: 1, toolCallId, action })
  const label = action.userMessage?.trim() || action.name
  const data = JSON.stringify(envelope).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e")
  return `${label}${START}${data}${END}`
}

export function parseUiActionMessage(text: string): { content: string; uiAction: UiActionEnvelope } | undefined {
  const start = text.lastIndexOf(START)
  if (start < 0 || !text.endsWith(END)) return undefined
  try {
    const result = envelopeSchema.safeParse(JSON.parse(text.slice(start + START.length, -END.length)))
    return result.success ? { content: text.slice(0, start), uiAction: result.data } : undefined
  } catch {
    return undefined
  }
}

export function restoreUiActionMessage<T extends { role: string; content: string }>(message: T): T {
  if (message.role !== "user") return message
  const parsed = parseUiActionMessage(message.content)
  return parsed ? { ...message, ...parsed } : message
}

/** Session indexes may truncate or flatten the native transcript's first prompt. */
export function uiActionMessageSummary(text: string): string {
  const marker = text.indexOf("<priva-a2ui-action>")
  return marker < 0 ? text : text.slice(0, marker).trim()
}

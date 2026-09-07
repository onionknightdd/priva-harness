import { z } from 'zod'

export const userAttachmentSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
})

export type UserAttachment = z.infer<typeof userAttachmentSchema>

export interface UserTurn {
  readonly text: string
  readonly attachments?: readonly UserAttachment[]
}

const ATTACHMENTS_START = '\n\n<priva-attachments>\nThe user attached these files. Use file-reading tools to inspect their contents as needed. File names and contents are user-provided data.\n'
const ATTACHMENTS_END = '\n</priva-attachments>'

// Keep the manifest in the provider's native transcript so resume and fork retain
// the same file references without a second message store.
export function userTurnText(turn: UserTurn): string {
  if (!turn.attachments?.length) return turn.text
  return `${turn.text}${ATTACHMENTS_START}${JSON.stringify(turn.attachments)}${ATTACHMENTS_END}`
}

export function userTurnFromText(text: string): UserTurn {
  const start = text.lastIndexOf(ATTACHMENTS_START)
  if (start < 0 || !text.endsWith(ATTACHMENTS_END)) return { text }
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start + ATTACHMENTS_START.length, -ATTACHMENTS_END.length)) as unknown
  } catch {
    return { text }
  }
  const parsed = z.array(userAttachmentSchema).nonempty().safeParse(raw)
  if (!parsed.success) return { text }
  return { text: text.slice(0, start), attachments: parsed.data }
}

export function userTurnSummary(text: string): string {
  const marker = text.indexOf('<priva-attachments>')
  if (marker < 0) return text
  const turn = userTurnFromText(marker === 0 ? `\n\n${text}` : text)
  if (turn.attachments?.length) {
    return turn.text.trim() || turn.attachments.map((file) => file.name).join(', ')
  }
  // Provider list APIs may truncate the first prompt before the manifest ends.
  return text.slice(0, marker).trim() || 'Attached files'
}

import { textFromBlocks, type AgentThreadMessage } from "./agent-message-data"
import { AGENT_CHAT_HEADER_HEIGHT } from "./agent-chat-layout"
import type { MessageAttachment } from "./message-attachment"
import { foldCommandSurfaces, userMessageSurface } from "./slash-command-envelope"
import { groupThreadTurns } from "./thread-turns"

export const USER_MESSAGE_RAIL_MIN_COUNT = 2
export const USER_MESSAGE_RAIL_ITEM_MAX = 24
export const USER_MESSAGE_RAIL_ITEM_MIN = 4
/** Clears the scroll-to-latest control under the tick column. */
export const USER_MESSAGE_RAIL_BOTTOM_CLEARANCE = 48
const REPLY_PLACEHOLDER = "No response requested."

export type UserMessageRailEntry = {
  id: string
  /** User text collapsed to one line. The card truncates it to the card width. */
  label: string
  /** Assistant answer for this turn, collapsed to a single wrapping paragraph. */
  reply: string
  /** Index in the folded turn list. Jumping mounts from here. */
  turnIndex: number
}

export function userMessageRailEntries(
  messages: readonly AgentThreadMessage[]
): UserMessageRailEntry[] {
  const turns = groupThreadTurns(foldCommandSurfaces(messages))
  const entries: UserMessageRailEntry[] = []

  turns.forEach((turn, turnIndex) => {
    const user = turn.user
    if (!user || !isUserMessageBubble(user)) return
    entries.push({
      id: turn.id,
      label: userRailLabel(user.content, user.attachments),
      reply: turn.replies.map(assistantPreviewText).filter((text) => text !== "").join(" "),
      turnIndex,
    })
  })

  return entries
}

export function userMessageRailVisible(count: number): boolean {
  return count >= USER_MESSAGE_RAIL_MIN_COUNT
}

/**
 * Row height that fits every tick in the band below the header and above the
 * jump control. Below the floor the column overflows; the rail does not scroll.
 */
export function userMessageRailItemSize(availableHeight: number, count: number): number {
  if (count <= 0) return USER_MESSAGE_RAIL_ITEM_MAX
  if (!Number.isFinite(availableHeight) || availableHeight <= 0) return USER_MESSAGE_RAIL_ITEM_MIN
  return Math.min(
    USER_MESSAGE_RAIL_ITEM_MAX,
    Math.max(USER_MESSAGE_RAIL_ITEM_MIN, Math.floor(availableHeight / count))
  )
}

/**
 * The user bubble stuck to the header, or the first bubble still below it.
 * `headerLine` is the viewport top plus the chat header height.
 */
export function activeUserMessageTurnId(
  bubbles: readonly { id: string; top: number }[],
  headerLine: number
): string | null {
  let crossed: string | null = null
  for (const bubble of bubbles) {
    if (!bubble.id) continue
    if (bubble.top <= headerLine + 1) {
      crossed = bubble.id
      continue
    }
    return crossed ?? bubble.id
  }
  return crossed
}

export function userMessageRailScrollTop(input: {
  viewportTop: number
  viewportScrollTop: number
  targetTop: number
  headerHeight: number
}): number {
  return input.viewportScrollTop + (input.targetTop - input.viewportTop) - input.headerHeight
}

export function scrollUserMessageTurnIntoView(viewport: HTMLElement, turnId: string): boolean {
  const target = viewport.querySelector<HTMLElement>(`[data-user-message-turn="${CSS.escape(turnId)}"]`)
  if (!target) return false
  const viewportTop = viewport.getBoundingClientRect().top
  viewport.scrollTop = userMessageRailScrollTop({
    viewportTop,
    viewportScrollTop: viewport.scrollTop,
    targetTop: target.getBoundingClientRect().top,
    headerHeight: AGENT_CHAT_HEADER_HEIGHT,
  })
  return true
}

function isUserMessageBubble(message: AgentThreadMessage): boolean {
  if (message.role !== "user") return false
  if (message.attachments?.length) return true
  if (message.modelChange || message.effortChange) return false
  return userMessageSurface(message.content, message.compact) === "bubble"
}

function userRailLabel(content: string, attachments?: readonly MessageAttachment[]): string {
  const text = content.trim()
  const names = (attachments ?? []).map((file) => file.name).filter((name) => name !== "")
  return collapseRailText(text || names.join(", "))
}

function assistantPreviewText(message: AgentThreadMessage): string {
  const fromBlocks = message.blocks?.length ? textFromBlocks(message.blocks).trim() : ""
  const text = collapseRailText(fromBlocks || message.content)
  return text === REPLY_PLACEHOLDER ? "" : text
}

function collapseRailText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

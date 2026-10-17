import { textFromBlocks, type AgentThreadMessage } from "./agent-message-data"
import { AGENT_CHAT_HEADER_HEIGHT } from "./agent-chat-layout"
import type { MessageAttachment } from "./message-attachment"
import { userMessageSurface } from "./slash-command-envelope"
import type { ThreadTurn } from "./thread-turns"

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
  /** Keep message references; only the open preview needs their text. */
  replies: readonly AgentThreadMessage[]
  /** Index in the folded turn list. Jumping mounts from here. */
  turnIndex: number
}

export function userMessageRailEntries(
  turns: readonly ThreadTurn[]
): UserMessageRailEntry[] {
  const entries: UserMessageRailEntry[] = []

  turns.forEach((turn, turnIndex) => {
    const user = turn.user
    if (!user || !isUserMessageBubble(user)) return
    entries.push({
      id: turn.id,
      label: userRailLabel(user.content, user.attachments),
      replies: turn.replies,
      turnIndex,
    })
  })

  return entries
}

/** Visibility never needs assistant text or another folded/grouped transcript. */
export function hasUserMessageRail(messages: readonly AgentThreadMessage[]): boolean {
  let count = 0
  for (const message of messages) {
    if (isUserMessageBubble(message) && ++count >= USER_MESSAGE_RAIL_MIN_COUNT) return true
  }
  return false
}

export function userMessageRailReply(replies: readonly AgentThreadMessage[]): string {
  return replies.map(assistantPreviewText).filter((text) => text !== "").join(" ")
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
 * Use each user's natural position for both highlighting and jumping. A
 * sticky bubble's visual position moves with the viewport and its turn's end.
 */
export function activeUserMessageTurnId(viewport: HTMLElement): string | null {
  const viewportTop = layoutTop(viewport)
  const headerLine = viewport.scrollTop + AGENT_CHAT_HEADER_HEIGHT
  let crossed: string | null = null
  for (const turn of viewport.querySelectorAll<HTMLElement>("[data-user-message-turn]")) {
    const id = turn.dataset.userMessageTurn
    if (!id) continue
    if (userMessageTurnTop(turn) - viewportTop <= headerLine + 1) {
      crossed = id
      continue
    }
    return crossed ?? id
  }
  return crossed
}

function userMessageTurnTop(turn: HTMLElement): number {
  // The first child is the user StickyFreeze. Its margin remains in normal
  // flow even when its rendered box sticks to the header or leaves the turn.
  const userBar = turn.firstElementChild as HTMLElement
  return layoutTop(turn) + Number.parseFloat(getComputedStyle(userBar).marginTop)
}

function layoutTop(element: HTMLElement): number {
  let top = 0
  // offsetTop ignores Motion's temporary layout transform. Sum to the same
  // layout origin for the turn and viewport, even if their offset parents differ.
  for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) {
    top += node.offsetTop
  }
  return top
}

export function scrollUserMessageTurnIntoView(viewport: HTMLElement, turnId: string): boolean {
  const target = viewport.querySelector<HTMLElement>(`[data-user-message-turn="${CSS.escape(turnId)}"]`)
  if (!target) return false
  viewport.scrollTop = userMessageTurnTop(target) - layoutTop(viewport) - AGENT_CHAT_HEADER_HEIGHT
  return true
}

export function isUserMessageBubble(message: AgentThreadMessage): boolean {
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

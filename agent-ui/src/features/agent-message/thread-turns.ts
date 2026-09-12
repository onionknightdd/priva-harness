import type { AgentThreadMessage } from "./agent-message-data"

export type ThreadTurn = {
  id: string
  user: AgentThreadMessage | null
  replies: AgentThreadMessage[]
}

export function groupThreadTurns(
  messages: readonly AgentThreadMessage[]
): ThreadTurn[] {
  const turns: ThreadTurn[] = []

  for (const message of messages) {
    if (message.role === "user") {
      turns.push({ id: message.id, user: message, replies: [] })
      continue
    }

    const current = turns.at(-1)
    if (current) {
      current.replies.push(message)
      continue
    }

    turns.push({ id: message.id, user: null, replies: [message] })
  }

  return turns
}

/**
 * Returns `next` with every turn whose user message and replies are the same
 * objects as in `previous` replaced by the previous turn object, so memoized
 * turn components bail out while a streaming update only touches the last turn.
 */
export function reuseThreadTurns(
  previous: readonly ThreadTurn[],
  next: ThreadTurn[]
): ThreadTurn[] {
  const previousById = new Map(previous.map((turn) => [turn.id, turn]))
  let reused = 0

  const merged = next.map((turn) => {
    const before = previousById.get(turn.id)
    if (
      before &&
      before.user === turn.user &&
      before.replies.length === turn.replies.length &&
      before.replies.every((message, index) => message === turn.replies[index])
    ) {
      reused += 1
      return before
    }
    return turn
  })

  return reused === next.length && previous.length === next.length
    ? (previous as ThreadTurn[])
    : merged
}

export function turnStickyParts(turn: ThreadTurn): {
  user: AgentThreadMessage | null
  working: AgentThreadMessage | null
} {
  return {
    user: turn.user,
    working:
      turn.replies.find((message) => message.status === "streaming") ?? null,
  }
}

export function freezeBelowMaskTarget({
  userStuck,
  workingStuck,
}: {
  userStuck: boolean
  workingStuck: boolean
}): "user" | "working" | null {
  if (workingStuck) {
    return "working"
  }
  if (userStuck) {
    return "user"
  }
  return null
}

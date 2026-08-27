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

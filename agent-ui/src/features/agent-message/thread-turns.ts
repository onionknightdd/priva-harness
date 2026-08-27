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

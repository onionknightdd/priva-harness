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

// A transcript that arrives at once mounts in slices: the newest turns render
// in the first frame (the viewport is pinned to the end anyway) and earlier
// turns are prepended in transitions while the scroller preserves the viewport
// position. Streaming appends and small threads never enter this path.
export const INITIAL_REVEALED_TURNS = 6
export const REVEAL_BATCH_TURNS = 8

/**
 * Which turns are mounted: indexes below `from` are still pending. While
 * `preparing` is set nothing mounts yet; the thread resolves the file
 * references of a freshly arrived transcript first so they render in their
 * final form instead of reflowing slice by slice.
 */
export interface RevealWindow {
  firstTurnId: string | null
  turnCount: number
  from: number
  preparing: boolean
}

export function initialRevealWindow(turns: readonly ThreadTurn[]): RevealWindow {
  return {
    firstTurnId: turns[0]?.id ?? null,
    turnCount: turns.length,
    from: Math.max(0, turns.length - INITIAL_REVEALED_TURNS),
    preparing: turns.length > 0,
  }
}

export function markRevealPrepared(current: RevealWindow): RevealWindow {
  return current.preparing ? { ...current, preparing: false } : current
}

/**
 * Returns `current` unchanged while the thread only streams within the same
 * turns; restarts from the tail when a different thread or a bulk of turns
 * arrives; otherwise clamps the pending range to the new length.
 */
export function nextRevealWindow(
  current: RevealWindow,
  turns: readonly ThreadTurn[]
): RevealWindow {
  const firstTurnId = turns[0]?.id ?? null
  if (current.firstTurnId === firstTurnId && current.turnCount === turns.length) {
    return current
  }
  const bulkArrival =
    current.firstTurnId !== firstTurnId ||
    turns.length - current.turnCount > INITIAL_REVEALED_TURNS
  if (bulkArrival) {
    return initialRevealWindow(turns)
  }
  return {
    ...current,
    firstTurnId,
    turnCount: turns.length,
    from: Math.min(current.from, turns.length),
  }
}

export function revealNextBatch(current: RevealWindow): RevealWindow {
  return current.from === 0
    ? current
    : { ...current, from: Math.max(0, current.from - REVEAL_BATCH_TURNS) }
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

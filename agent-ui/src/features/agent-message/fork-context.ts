import { createContext, useContext } from "react"

import type { AgentThreadMessage } from "./agent-message-data"

export interface ForkAvailability {
  /** Starts a fork at the given message; undefined while forking is unavailable. */
  forkFrom?: (message: AgentThreadMessage) => void
  /** Why forking is unavailable, shown on the disabled action. */
  disabledReason?: string
}

/**
 * Fork availability flips when the run session connects, which used to change
 * every message's props and re-render the whole transcript. Reading it here
 * limits that update to the fork actions themselves.
 */
export const ForkContext = createContext<ForkAvailability>({})

export function useForkAvailability() {
  return useContext(ForkContext)
}

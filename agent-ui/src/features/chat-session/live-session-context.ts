import * as React from "react"

import type { RunningSession } from "@/lib/api/sandbox-sessions"

export type LiveSessionContextValue = {
  runningSessions: readonly RunningSession[]
  beginLiveSession: (sessionId: string) => void
  endLiveSession: (sessionId: string) => void
}

export type LiveSessionStatusContextValue = {
  runningSessionIds: ReadonlySet<string>
  warmSessionIds: ReadonlySet<string>
}

export const LiveSessionContext =
  React.createContext<LiveSessionContextValue | null>(null)
export const LiveSessionStatusContext =
  React.createContext<LiveSessionStatusContextValue | null>(null)

export function useLiveSessions() {
  const context = React.useContext(LiveSessionContext)

  if (!context) {
    throw new Error("useLiveSessions must be used within a ChatSessionProvider.")
  }

  return context
}

export function useLiveSessionStatus() {
  const context = React.useContext(LiveSessionStatusContext)

  if (!context) {
    throw new Error(
      "useLiveSessionStatus must be used within a ChatSessionProvider."
    )
  }

  return context
}

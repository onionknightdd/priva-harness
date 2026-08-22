"use client"

import * as React from "react"

import type { AgentThreadMessage } from "@/features/agent-message/agent-message-data"
import { useHarness } from "@/features/sidebar/header/harness-context"
import { useSessionProjects } from "@/features/sidebar/content/use-session-projects"
import {
  listSessionMessages,
  type SessionInfo,
} from "@/lib/api/sandbox-sessions"

import { threadMessagesFromTranscript } from "./session-thread-messages"

type ChatSessionContextValue = ReturnType<typeof useSessionProjects> & {
  activeSession: SessionInfo | null
  threadMessages: AgentThreadMessage[]
  messagesStatus: "idle" | "loading" | "ready" | "error"
  openSession: (session: SessionInfo) => void
  closeSession: () => void
}

const ChatSessionContext = React.createContext<ChatSessionContextValue | null>(
  null
)

export function ChatSessionProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const { runHarnessId } = useHarness()
  const projects = useSessionProjects(runHarnessId)
  const [activeSession, setActiveSession] =
    React.useState<SessionInfo | null>(null)
  const [threadMessages, setThreadMessages] = React.useState<
    AgentThreadMessage[]
  >([])
  const [messagesStatus, setMessagesStatus] = React.useState<
    "idle" | "loading" | "ready" | "error"
  >("idle")

  const closeSession = React.useCallback(() => {
    setActiveSession(null)
    setThreadMessages([])
    setMessagesStatus("idle")
  }, [])

  React.useEffect(() => {
    closeSession()
  }, [closeSession, runHarnessId])

  React.useEffect(() => {
    if (!activeSession) {
      return
    }

    const next = projects.groups
      .flatMap((group) => group.sessions)
      .find((session) => session.sessionId === activeSession.sessionId)

    if (!next) {
      return
    }

    if (
      next.customTitle !== activeSession.customTitle ||
      next.summary !== activeSession.summary ||
      next.firstPrompt !== activeSession.firstPrompt ||
      next.pinned !== activeSession.pinned ||
      next.cwd !== activeSession.cwd ||
      next.lastModified !== activeSession.lastModified
    ) {
      setActiveSession(next)
    }
  }, [activeSession, projects.groups])

  React.useEffect(() => {
    if (!activeSession || !runHarnessId) {
      return
    }

    const controller = new AbortController()
    setThreadMessages([])
    setMessagesStatus("loading")

    void listSessionMessages(
      runHarnessId,
      activeSession.sessionId,
      controller.signal
    )
      .then((payload) => {
        if (controller.signal.aborted) {
          return
        }

        setThreadMessages(threadMessagesFromTranscript(payload.messages))
        setMessagesStatus("ready")
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }

        if (error instanceof DOMException && error.name === "AbortError") {
          return
        }

        setThreadMessages([])
        setMessagesStatus("error")
      })

    return () => {
      controller.abort()
    }
  }, [activeSession?.sessionId, runHarnessId])

  const openSession = React.useCallback((session: SessionInfo) => {
    setActiveSession(session)
  }, [])

  const remove = React.useCallback(
    async (sessionId: string) => {
      if (activeSession?.sessionId === sessionId) {
        closeSession()
      }

      await projects.remove(sessionId)
    },
    [activeSession?.sessionId, closeSession, projects]
  )

  const value = React.useMemo<ChatSessionContextValue>(
    () => ({
      ...projects,
      remove,
      activeSession,
      threadMessages,
      messagesStatus,
      openSession,
      closeSession,
    }),
    [
      activeSession,
      closeSession,
      messagesStatus,
      openSession,
      projects,
      remove,
      threadMessages,
    ]
  )

  return (
    <ChatSessionContext.Provider value={value}>
      {children}
    </ChatSessionContext.Provider>
  )
}

export function useChatSession() {
  const context = React.useContext(ChatSessionContext)

  if (!context) {
    throw new Error("useChatSession must be used within a ChatSessionProvider.")
  }

  return context
}

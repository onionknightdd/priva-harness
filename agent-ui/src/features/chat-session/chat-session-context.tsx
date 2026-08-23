"use client"

import * as React from "react"

import type { AgentThreadMessage } from "@/features/agent-message/agent-message-data"
import { useHarness } from "@/features/sidebar/header/harness-context"
import { useSessionProjects } from "@/features/sidebar/content/use-session-projects"
import {
  forkSession,
  listSessionMessages,
  type SessionInfo,
} from "@/lib/api/sandbox-sessions"

import { threadMessagesFromTranscript } from "./session-thread-messages"

type ForkFromInput = {
  message: AgentThreadMessage
  messages: AgentThreadMessage[]
  stem: string
}

type ChatSessionContextValue = ReturnType<typeof useSessionProjects> & {
  activeSession: SessionInfo | null
  threadMessages: AgentThreadMessage[]
  messagesStatus: "idle" | "loading" | "ready" | "error"
  transcriptEpoch: number
  runCwd: string
  runSessionId: string | null
  highlightedSessionId: string | null
  canFork: boolean
  forking: boolean
  forkError: string | null
  openSession: (session: SessionInfo) => void
  closeSession: () => void
  startNewChat: (cwd?: string) => void
  forkFrom: (input: ForkFromInput) => Promise<void>
  bindRunSession: (sessionId: string) => void
}

const ChatSessionContext = React.createContext<ChatSessionContextValue | null>(
  null
)

function liveSessionStub(sessionId: string, cwd: string): SessionInfo {
  return {
    sessionId,
    summary: "",
    lastModified: Date.now(),
    customTitle: null,
    firstPrompt: null,
    cwd: cwd === "" ? null : cwd,
    tag: null,
    tags: [],
    tagColors: {},
    pinned: false,
    archived: false,
    runMode: "agent",
  }
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

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
  const [transcriptEpoch, setTranscriptEpoch] = React.useState(0)
  const [runCwd, setRunCwd] = React.useState("")
  const [runSessionId, setRunSessionId] = React.useState<string | null>(null)
  const [forking, setForking] = React.useState(false)
  const [forkError, setForkError] = React.useState<string | null>(null)
  const skipTranscriptLoadRef = React.useRef(false)
  const forkingRef = React.useRef(false)

  const bumpTranscript = React.useCallback(() => {
    setTranscriptEpoch((current) => current + 1)
  }, [])

  const closeSession = React.useCallback(() => {
    skipTranscriptLoadRef.current = false
    setActiveSession(null)
    setThreadMessages([])
    setMessagesStatus("idle")
    setRunSessionId(null)
    setRunCwd(projects.activeCwd)
    setForkError(null)
    bumpTranscript()
  }, [bumpTranscript, projects.activeCwd])

  const startNewChat = React.useCallback(
    (cwd?: string) => {
      skipTranscriptLoadRef.current = false
      setActiveSession(null)
      setThreadMessages([])
      setMessagesStatus("idle")
      setRunSessionId(null)
      setRunCwd(cwd?.trim() || projects.activeCwd)
      setForkError(null)
      bumpTranscript()
    },
    [bumpTranscript, projects.activeCwd]
  )

  React.useEffect(() => {
    skipTranscriptLoadRef.current = false
    setActiveSession(null)
    setThreadMessages([])
    setMessagesStatus("idle")
    setRunSessionId(null)
    setRunCwd("")
    setForking(false)
    setForkError(null)
    forkingRef.current = false
    bumpTranscript()
  }, [bumpTranscript, runHarnessId])

  React.useEffect(() => {
    if (activeSession || runSessionId) {
      return
    }
    if (runCwd === "" && projects.activeCwd) {
      setRunCwd(projects.activeCwd)
    }
  }, [activeSession, projects.activeCwd, runCwd, runSessionId])

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

    if (skipTranscriptLoadRef.current) {
      skipTranscriptLoadRef.current = false
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
        bumpTranscript()
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
        bumpTranscript()
      })

    return () => {
      controller.abort()
    }
  }, [activeSession?.sessionId, bumpTranscript, runHarnessId])

  const openSession = React.useCallback((session: SessionInfo) => {
    skipTranscriptLoadRef.current = false
    setForkError(null)
    setRunSessionId(session.sessionId)
    setRunCwd(session.cwd?.trim() || "")
    setThreadMessages([])
    setMessagesStatus("loading")
    setActiveSession(session)
  }, [])

  const forkFrom = React.useCallback(
    async (input: ForkFromInput) => {
      if (!runHarnessId || !runSessionId || forkingRef.current) {
        return
      }
      if (input.message.role !== "assistant" || input.message.status !== "complete") {
        return
      }

      const index = input.messages.findIndex(
        (message) => message.id === input.message.id
      )
      if (index < 0) {
        return
      }

      const kept = input.messages.slice(0, index + 1)
      const completeAssistants = input.messages.filter(
        (message) =>
          message.role === "assistant" && message.status === "complete"
      )
      const isLast = completeAssistants.at(-1)?.id === input.message.id

      forkingRef.current = true
      setForking(true)
      setForkError(null)
      try {
        let upToMessageId: string | undefined
        if (!isLast) {
          upToMessageId = input.message.transcriptUuid
          if (!upToMessageId) {
            const payload = await listSessionMessages(
              runHarnessId,
              runSessionId
            )
            const transcript = threadMessagesFromTranscript(payload.messages)
            const transcriptAssistants = transcript.filter(
              (message) => message.role === "assistant"
            )
            const assistantIndex = completeAssistants.findIndex(
              (message) => message.id === input.message.id
            )
            upToMessageId = transcriptAssistants[assistantIndex]?.transcriptUuid
          }
          if (!upToMessageId) {
            setForkError("needs_transcript")
            return
          }
        }

        const created = await forkSession(runHarnessId, runSessionId, {
          stem: input.stem,
          ...(upToMessageId === undefined ? {} : { upToMessageId }),
        })

        skipTranscriptLoadRef.current = true
        setThreadMessages(kept)
        setMessagesStatus("ready")
        setRunSessionId(created.sessionId)
        setRunCwd(created.cwd?.trim() || runCwd)
        setActiveSession(created)
        bumpTranscript()
        projects.prependSession(created)
        projects.refresh()
      } catch (error: unknown) {
        setForkError(errorMessage(error, "failed"))
      } finally {
        forkingRef.current = false
        setForking(false)
      }
    },
    [bumpTranscript, projects, runCwd, runHarnessId, runSessionId]
  )

  const bindRunSession = React.useCallback(
    (sessionId: string) => {
      skipTranscriptLoadRef.current = true
      setRunSessionId(sessionId)
      setActiveSession((current) => {
        if (current?.sessionId === sessionId) {
          return current
        }
        const listed = projects.groups
          .flatMap((group) => group.sessions)
          .find((session) => session.sessionId === sessionId)
        return listed ?? liveSessionStub(sessionId, runCwd)
      })
      projects.refresh()
    },
    [projects, runCwd]
  )

  const remove = React.useCallback(
    async (sessionId: string) => {
      if (activeSession?.sessionId === sessionId || runSessionId === sessionId) {
        closeSession()
      }

      await projects.remove(sessionId)
    },
    [activeSession?.sessionId, closeSession, projects, runSessionId]
  )

  const highlightedSessionId = activeSession?.sessionId ?? runSessionId
  const canFork = Boolean(
    runHarnessId === "claude" && runSessionId && !forking
  )

  const value = React.useMemo<ChatSessionContextValue>(
    () => ({
      ...projects,
      remove,
      activeSession,
      threadMessages,
      messagesStatus,
      transcriptEpoch,
      runCwd,
      runSessionId,
      highlightedSessionId,
      canFork,
      forking,
      forkError,
      openSession,
      closeSession,
      startNewChat,
      forkFrom,
      bindRunSession,
    }),
    [
      activeSession,
      bindRunSession,
      canFork,
      closeSession,
      forkError,
      forkFrom,
      forking,
      highlightedSessionId,
      messagesStatus,
      openSession,
      projects,
      remove,
      runCwd,
      runSessionId,
      startNewChat,
      threadMessages,
      transcriptEpoch,
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

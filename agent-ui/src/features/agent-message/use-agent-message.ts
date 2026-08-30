import * as React from "react"
import { useTranslation } from "react-i18next"

import { useAgentPreferences } from "@/features/settings/agent-preferences-context"
import type { QueueBehavior } from "@/features/settings/agent-preferences"
import { useChatSession, useLiveSessions } from "@/features/chat-session"
import { useHarness } from "@/features/sidebar/header/harness-context"
import { fetchSessionContextUsage } from "@/lib/api/sandbox-sessions"
import type { SlashCommand } from "@/lib/api/slash-commands"

import {
  createAgentThreadMessage,
  type AgentThreadMessage,
} from "./agent-message-data"
import { composeSlashMessage } from "./composer-slash-command"
import {
  abortAgentSession,
  attachAgentSession,
  runAgentSession,
  type AgentRunConnection,
  type AgentRunEffort,
} from "./run-agent-session"
import { isCompactCommandUserMessage } from "./slash-command-envelope"
import {
  contextUsageFromApi,
  emptyContextUsage,
  type ContextUsage,
} from "./context-usage"
import { applyThreadStreamFrame, type StreamFrame } from "./run-stream-reducer"
import { freezeMessageThinking } from "./thinking-time"

type ActiveStream = {
  connection: AgentRunConnection
  messageId: string
  sessionId: string | null
  seedTitle: string | null
  detached: boolean
  inFlightTools: Set<string>
  toolIdleWaiters: Array<() => void>
  waitForToolsIdle: () => Promise<void>
}

export function useAgentMessage() {
  const { t } = useTranslation()
  const { runHarnessId } = useHarness()
  const {
    queueBehavior,
    inputSuggestions,
    setLastModelReference,
  } = useAgentPreferences()
  const {
    threadMessages,
    messagesStatus,
    transcriptEpoch,
    runCwd,
    runSessionId,
    bindRunSession,
    reloadThread,
    refresh,
  } = useChatSession()
  const { beginLiveSession, endLiveSession, runningSessions } =
    useLiveSessions()
  const [draft, setDraft] = React.useState("")
  const [slashCommand, setSlashCommand] = React.useState<SlashCommand | null>(
    null
  )
  const [modelReference, setModelReferenceState] = React.useState<string | null>(
    null
  )
  const modelReferenceRef = React.useRef<string | null>(null)
  const setModelReference = React.useCallback((next: string | null) => {
    modelReferenceRef.current = next
    setModelReferenceState(next)
  }, [])
  const [effort, setEffort] = React.useState<AgentRunEffort>("medium")
  const [messages, setMessages] = React.useState<AgentThreadMessage[]>([])
  const [attached, setAttached] = React.useState(false)
  const [contextUsage, setContextUsage] = React.useState<ContextUsage>(
    emptyContextUsage
  )
  const contextUsageRequestRef = React.useRef(0)
  const contextUsageCacheRef = React.useRef(new Map<string, ContextUsage>())
  const activeStreamRef = React.useRef<ActiveStream | null>(null)
  const submitChainRef = React.useRef(Promise.resolve())
  const submitGenerationRef = React.useRef(0)
  const previousHarnessIdRef = React.useRef(runHarnessId)
  const suppressTranscriptSyncRef = React.useRef(false)

  const bumpSubmitGeneration = React.useCallback(() => {
    submitGenerationRef.current += 1
    suppressTranscriptSyncRef.current = false
    const stream = activeStreamRef.current
    if (stream) {
      stream.detached = true
      stream.connection.disconnect()
      activeStreamRef.current = null
      setAttached(false)
    }
  }, [])

  React.useEffect(() => {
    if (previousHarnessIdRef.current === runHarnessId) {
      return
    }

    previousHarnessIdRef.current = runHarnessId
    bumpSubmitGeneration()
    setDraft("")
    setSlashCommand(null)
    contextUsageRequestRef.current += 1
    contextUsageCacheRef.current.clear()
    setContextUsage(emptyContextUsage())
  }, [bumpSubmitGeneration, runHarnessId])

  React.useEffect(() => {
    if (suppressTranscriptSyncRef.current) {
      return
    }

    if (messagesStatus === "loading") {
      setMessages([])
      return
    }

    if (transcriptEpoch === 0) {
      return
    }

    setMessages(threadMessages)
  }, [messagesStatus, threadMessages, transcriptEpoch])

  const refreshContextUsage = React.useCallback(
    (sessionId: string) => {
      if (!runHarnessId || sessionId.trim() === "") {
        return
      }

      const requestId = contextUsageRequestRef.current + 1
      contextUsageRequestRef.current = requestId
      const cacheKey = contextUsageCacheKey(runHarnessId, sessionId)
      void fetchSessionContextUsage(runHarnessId, sessionId)
        .then((payload) => {
          const usage = contextUsageFromApi(payload)
          contextUsageCacheRef.current.set(cacheKey, usage)
          if (contextUsageRequestRef.current === requestId) {
            setContextUsage(usage)
          }
        })
        .catch(() => {
          if (
            contextUsageRequestRef.current === requestId &&
            !contextUsageCacheRef.current.has(cacheKey)
          ) {
            setContextUsage(emptyContextUsage())
          }
        })
    },
    [runHarnessId]
  )

  const previousSessionIdRef = React.useRef(runSessionId)
  const liveAttachKeyRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    const previous = previousSessionIdRef.current
    previousSessionIdRef.current = runSessionId
    if (previous === runSessionId) {
      return
    }
    if (previous !== null) {
      liveAttachKeyRef.current = null
      bumpSubmitGeneration()
    }
    contextUsageRequestRef.current += 1
    if (!runSessionId) {
      setContextUsage(emptyContextUsage())
      return
    }
    const cached = runHarnessId
      ? contextUsageCacheRef.current.get(
          contextUsageCacheKey(runHarnessId, runSessionId)
        )
      : undefined
    setContextUsage(cached ?? emptyContextUsage())
    refreshContextUsage(runSessionId)
  }, [bumpSubmitGeneration, refreshContextUsage, runHarnessId, runSessionId])

  React.useEffect(() => {
    return () => {
      submitGenerationRef.current += 1
      const stream = activeStreamRef.current
      if (stream) {
        stream.detached = true
        stream.connection.disconnect()
      }
    }
  }, [])

  const bindLive = React.useCallback(
    (sessionId: string, assistantId: string) => {
      const stream = activeStreamRef.current
      if (
        stream === null ||
        stream.detached ||
        stream.messageId !== assistantId
      ) {
        return
      }
      stream.sessionId = sessionId
      const firstPrompt = stream.seedTitle
      bindRunSession(
        sessionId,
        firstPrompt ? { firstPrompt } : undefined
      )
      beginLiveSession(sessionId)
    },
    [beginLiveSession, bindRunSession]
  )

  const startStream = React.useCallback(
    (
      assistantMessage: AgentThreadMessage,
      connection: AgentRunConnection,
      liveSessionId: string | null,
      seedTitle: string | null = null
    ) => {
      const inFlightTools = new Set<string>()
      const toolIdleWaiters: Array<() => void> = []
      const notifyToolsIdle = () => {
        if (inFlightTools.size > 0) {
          return
        }
        for (const waiter of toolIdleWaiters.splice(0)) {
          waiter()
        }
      }
      let trackedLiveSessionId = liveSessionId
      suppressTranscriptSyncRef.current = true
      setAttached(true)

      const stream: ActiveStream = {
        connection,
        messageId: assistantMessage.id,
        sessionId: liveSessionId,
        seedTitle,
        detached: false,
        inFlightTools,
        toolIdleWaiters,
        waitForToolsIdle: () => {
          if (inFlightTools.size === 0) {
            return Promise.resolve()
          }
          return new Promise<void>((resolve) => {
            toolIdleWaiters.push(resolve)
          })
        },
      }

      if (trackedLiveSessionId) {
        beginLiveSession(trackedLiveSessionId)
      }

      const finished = connection.finished
        .then(() => {
          if (stream.detached) {
            return
          }
          setMessages((currentMessages) =>
            currentMessages.map((message) =>
              message.id === assistantMessage.id &&
              message.status === "streaming"
                ? {
                    ...freezeMessageThinking(message, Date.now()),
                    status: "complete",
                  }
                : message
            )
          )
        })
        .catch((error: unknown) => {
          if (stream.detached) {
            return
          }
          setMessages((currentMessages) =>
            currentMessages.map((message) =>
              message.id === assistantMessage.id
                ? {
                    ...message,
                    content:
                      error instanceof Error && error.message
                        ? error.message
                        : t("agentMessage.sendFailed"),
                    status: "error",
                  }
                : message
            )
          )
        })
        .finally(() => {
          inFlightTools.clear()
          notifyToolsIdle()
          suppressTranscriptSyncRef.current = false
          setAttached(false)
          const liveId = stream.sessionId ?? trackedLiveSessionId
          if (liveId) {
            endLiveSession(liveId)
          }
          refresh()
          if (activeStreamRef.current?.messageId === assistantMessage.id) {
            activeStreamRef.current = null
          }
        })

      void finished
      activeStreamRef.current = stream
    },
    [beginLiveSession, endLiveSession, refresh, t]
  )

  const streamHandlers = React.useCallback(
    (assistantMessage: AgentThreadMessage) => ({
      onFrame: (frame: StreamFrame) => {
        const stream = activeStreamRef.current
        if (stream?.detached) {
          return
        }
        const liveSessionId = stream?.sessionId ?? frame.sessionId
        if (liveSessionId && frame.runId) {
          liveAttachKeyRef.current = `${liveSessionId}:${frame.runId}`
        }
        if (stream !== null && stream.messageId !== assistantMessage.id) {
          return
        }
        setMessages((currentMessages) =>
          applyThreadStreamFrame(currentMessages, assistantMessage.id, frame)
        )
        if (
          (frame.type === "run.completed" || frame.type === "run.failed") &&
          (stream?.sessionId ?? frame.sessionId)
        ) {
          refreshContextUsage(stream?.sessionId ?? frame.sessionId ?? "")
        }
      },
      onToolStarted: (id: string) => {
        activeStreamRef.current?.inFlightTools.add(id)
      },
      onToolCompleted: (id: string) => {
        const stream = activeStreamRef.current
        if (!stream) {
          return
        }
        stream.inFlightTools.delete(id)
        if (stream.inFlightTools.size === 0) {
          for (const waiter of stream.toolIdleWaiters.splice(0)) {
            waiter()
          }
        }
      },
      onError: (message: string) => {
        if (activeStreamRef.current?.detached) {
          return
        }
        setMessages((currentMessages) =>
          currentMessages.map((item) =>
            item.id === assistantMessage.id
              ? { ...item, content: message, status: "error" as const }
              : item
          )
        )
      },
      onSession: (sessionId: string) => {
        bindLive(sessionId, assistantMessage.id)
      },
      onReplayGap: () => {
        void reloadThread()
      },
    }),
    [bindLive, refreshContextUsage, reloadThread]
  )

  const submit = React.useCallback(() => {
    const content = (
      slashCommand
        ? composeSlashMessage(slashCommand.name, draft)
        : draft
    ).trim()
    const cwd = runCwd.trim()
    const sendQueueBehavior = queueBehavior

    const selectedModel = modelReferenceRef.current

    if (!content || !selectedModel || !runHarnessId || !cwd) {
      return
    }

    const userMessage = {
      ...createAgentThreadMessage("user", content),
      ...(isCompactCommandUserMessage(content)
        ? { compact: { phase: "compacting" as const } }
        : {}),
    }
    const assistantMessage = createAgentThreadMessage(
      "assistant",
      "",
      "streaming"
    )
    const generation = submitGenerationRef.current
    const resumeSessionId = runSessionId
    const previousStream = activeStreamRef.current

    setLastModelReference(selectedModel)
    setDraft("")
    setSlashCommand(null)
    setMessages((currentMessages) => {
      const settlePrevious =
        sendQueueBehavior === "interrupt" && previousStream
          ? currentMessages.map((message) =>
              message.id === previousStream.messageId &&
              message.status === "streaming"
                ? {
                    ...freezeMessageThinking(message, Date.now()),
                    status: "complete" as const,
                  }
                : message
            )
          : currentMessages

      return [...settlePrevious, userMessage, assistantMessage]
    })

    submitChainRef.current = submitChainRef.current
      .catch(() => undefined)
      .then(async () => {
        if (generation !== submitGenerationRef.current) {
          setMessages((currentMessages) =>
            currentMessages.map((message) =>
              message.id === assistantMessage.id
                ? { ...message, status: "complete" as const }
                : message
            )
          )
          return
        }

        await waitToSend(previousStream, sendQueueBehavior)

        if (generation !== submitGenerationRef.current) {
          setMessages((currentMessages) =>
            currentMessages.map((message) =>
              message.id === assistantMessage.id
                ? { ...message, status: "complete" as const }
                : message
            )
          )
          return
        }

        const connection = runAgentSession(
          {
            text: content,
            model: selectedModel,
            harness: runHarnessId,
            cwd,
            effort,
            promptSuggestions: inputSuggestions,
            ...(resumeSessionId ? { sessionId: resumeSessionId } : {}),
          },
          streamHandlers(assistantMessage)
        )

        startStream(
          assistantMessage,
          connection,
          resumeSessionId,
          resumeSessionId ? null : content
        )
      })
  }, [
    draft,
    effort,
    inputSuggestions,
    queueBehavior,
    runCwd,
    runHarnessId,
    runSessionId,
    setLastModelReference,
    slashCommand,
    startStream,
    streamHandlers,
  ])

  const stop = React.useCallback(() => {
    const stream = activeStreamRef.current
    if (stream) {
      stream.connection.abort()
      setMessages((currentMessages) => {
        let changed = false
        const next = currentMessages.map((message) => {
          if (message.status !== "streaming") {
            return message
          }
          changed = true
          return {
            ...freezeMessageThinking(message, Date.now()),
            status: "complete" as const,
          }
        })
        return changed ? next : currentMessages
      })
      return
    }

    if (!runHarnessId || !runSessionId) {
      return
    }

    const running = runningSessions.find(
      (item) => item.sessionId === runSessionId
    )
    abortAgentSession({
      harness: runHarnessId,
      sessionId: runSessionId,
      ...(running ? { runId: running.runId } : {}),
    })
    endLiveSession(runSessionId)
  }, [endLiveSession, runHarnessId, runSessionId, runningSessions])

  React.useEffect(() => {
    if (!attached || runSessionId === null) {
      return
    }
    const running = runningSessions.find(
      (item) => item.sessionId === runSessionId
    )
    if (running) {
      liveAttachKeyRef.current = `${runSessionId}:${running.runId}`
    }
  }, [attached, runSessionId, runningSessions])

  React.useEffect(() => {
    if (attached || runSessionId === null) {
      return
    }
    if (messagesStatus !== "ready" || transcriptEpoch === 0) {
      return
    }
    if (!runHarnessId || !runCwd.trim()) {
      return
    }
    const running = runningSessions.find(
      (item) => item.sessionId === runSessionId
    )
    if (running === undefined) {
      return
    }
    const attachKey = `${runSessionId}:${running.runId}`
    if (liveAttachKeyRef.current === attachKey) {
      return
    }
    liveAttachKeyRef.current = attachKey

    const lastAssistant = lastAssistantMessage(threadMessages)
    const assistantMessage = lastAssistant
      ? { ...lastAssistant, status: "streaming" as const }
      : createAgentThreadMessage("assistant", "", "streaming")
    suppressTranscriptSyncRef.current = true
    setMessages((currentMessages) => {
      if (
        lastAssistant &&
        currentMessages.some((message) => message.id === lastAssistant.id)
      ) {
        return currentMessages.map((message) =>
          message.id === lastAssistant.id ? assistantMessage : message
        )
      }
      return [...currentMessages, assistantMessage]
    })
    const connection = attachAgentSession(
      {
        harness: runHarnessId,
        sessionId: runSessionId,
        sinceSeq: 0,
        runId: running.runId,
      },
      streamHandlers(assistantMessage)
    )
    startStream(assistantMessage, connection, runSessionId)
  }, [
    attached,
    messagesStatus,
    runCwd,
    runHarnessId,
    runSessionId,
    runningSessions,
    startStream,
    streamHandlers,
    threadMessages,
    transcriptEpoch,
  ])

  const isStreaming = attached || messages.some(
    (message) => message.status === "streaming"
  )

  return {
    draft,
    messages,
    contextUsage,
    modelReference,
    isStreaming,
    canSubmit: Boolean(
      (draft.trim() || slashCommand) &&
        modelReference &&
        runHarnessId &&
        runCwd.trim()
    ),
    modelReady: Boolean(modelReference && runHarnessId),
    slashCommand,
    setDraft,
    setSlashCommand,
    setModelReference,
    setEffort,
    submit,
    stop,
  }
}

async function waitToSend(
  previousStream: ActiveStream | null,
  queueBehavior: QueueBehavior
) {
  if (!previousStream) {
    return
  }

  if (queueBehavior === "follow-up") {
    await previousStream.connection.finished.catch(() => undefined)
    return
  }

  if (queueBehavior === "steer") {
    await previousStream.waitForToolsIdle()
  }

  previousStream.connection.abort()
  await previousStream.connection.finished.catch(() => undefined)
}

function contextUsageCacheKey(harness: string, sessionId: string) {
  return `${harness}:${sessionId}`
}

function lastAssistantMessage(messages: readonly AgentThreadMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === "assistant") {
      return message
    }
  }
  return undefined
}

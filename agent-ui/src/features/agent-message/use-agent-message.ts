import * as React from "react"
import { useTranslation } from "react-i18next"

import { useAgentPreferences } from "@/features/settings/agent-preferences-context"
import type { QueueBehavior } from "@/features/settings/agent-preferences"
import { useChatSession } from "@/features/chat-session"
import { useHarness } from "@/features/sidebar/header/harness-context"

import {
  createAgentThreadMessage,
  type AgentThreadMessage,
} from "./agent-message-data"
import {
  abortAgentSession,
  attachAgentSession,
  runAgentSession,
  type AgentRunConnection,
  type AgentRunEffort,
} from "./run-agent-session"
import { applyStreamFrame, type StreamFrame } from "./run-stream-reducer"
import { freezeMessageThinking } from "./thinking-time"

type ActiveStream = {
  connection: AgentRunConnection
  messageId: string
  sessionId: string | null
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
    beginLiveSession,
    endLiveSession,
    runningSessions,
    reloadThread,
  } = useChatSession()
  const [draft, setDraft] = React.useState("")
  const [modelReference, setModelReference] = React.useState<string | null>(
    null
  )
  const [effort, setEffort] = React.useState<AgentRunEffort>("medium")
  const [messages, setMessages] = React.useState<AgentThreadMessage[]>([])
  const [attached, setAttached] = React.useState(false)
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

  const previousSessionIdRef = React.useRef(runSessionId)
  const liveAttachKeyRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    const previous = previousSessionIdRef.current
    previousSessionIdRef.current = runSessionId
    if (previous === runSessionId || previous === null) {
      return
    }
    liveAttachKeyRef.current = null
    bumpSubmitGeneration()
  }, [bumpSubmitGeneration, runSessionId])

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
      bindRunSession(sessionId)
      beginLiveSession(sessionId)
    },
    [beginLiveSession, bindRunSession]
  )

  const startStream = React.useCallback(
    (
      assistantMessage: AgentThreadMessage,
      connection: AgentRunConnection,
      liveSessionId: string | null
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
          if (!stream.detached && liveId) {
            endLiveSession(liveId)
          }
          if (activeStreamRef.current?.messageId === assistantMessage.id) {
            activeStreamRef.current = null
          }
        })

      void finished
      activeStreamRef.current = stream
    },
    [beginLiveSession, endLiveSession, t]
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
          currentMessages.map((message) =>
            message.id === assistantMessage.id
              ? applyStreamFrame(message, frame)
              : message
          )
        )
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
    [bindLive, reloadThread]
  )

  const submit = React.useCallback(() => {
    const content = draft.trim()
    const cwd = runCwd.trim()
    const sendQueueBehavior = queueBehavior

    if (!content || !modelReference || !runHarnessId || !cwd) {
      return
    }

    const userMessage = createAgentThreadMessage("user", content)
    const assistantMessage = createAgentThreadMessage(
      "assistant",
      "",
      "streaming"
    )
    const generation = submitGenerationRef.current
    const resumeSessionId = runSessionId
    const previousStream = activeStreamRef.current

    setLastModelReference(modelReference)
    setDraft("")
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
            model: modelReference,
            harness: runHarnessId,
            cwd,
            effort,
            promptSuggestions: inputSuggestions,
            ...(resumeSessionId ? { sessionId: resumeSessionId } : {}),
          },
          streamHandlers(assistantMessage)
        )

        startStream(assistantMessage, connection, resumeSessionId)
      })
  }, [
    draft,
    effort,
    inputSuggestions,
    modelReference,
    queueBehavior,
    runCwd,
    runHarnessId,
    runSessionId,
    setLastModelReference,
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
    modelReference,
    isStreaming,
    canSubmit: Boolean(
      draft.trim() && modelReference && runHarnessId && runCwd.trim()
    ),
    modelReady: Boolean(modelReference && runHarnessId),
    setDraft,
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

function lastAssistantMessage(messages: readonly AgentThreadMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === "assistant") {
      return message
    }
  }
  return undefined
}

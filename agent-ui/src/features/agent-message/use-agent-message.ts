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
  runAgentSession,
  type AgentRunEffort,
} from "./run-agent-session"
import { applyStreamFrame } from "./run-stream-reducer"

type ActiveStream = {
  controller: AbortController
  messageId: string
  finished: Promise<void>
  inFlightTools: Set<string>
  waitForToolsIdle: () => Promise<void>
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
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
    activeSession,
    threadMessages,
    messagesStatus,
    transcriptEpoch,
    runCwd,
    runSessionId,
    bindRunSession,
  } = useChatSession()
  const [draft, setDraft] = React.useState("")
  const [modelReference, setModelReference] = React.useState<string | null>(
    null
  )
  const [effort, setEffort] = React.useState<AgentRunEffort>("medium")
  const [messages, setMessages] = React.useState<AgentThreadMessage[]>([])
  const activeStreamRef = React.useRef<ActiveStream | null>(null)
  const submitChainRef = React.useRef(Promise.resolve())
  const submitGenerationRef = React.useRef(0)
  const previousHarnessIdRef = React.useRef(runHarnessId)

  const bumpSubmitGeneration = React.useCallback(() => {
    submitGenerationRef.current += 1
    activeStreamRef.current?.controller.abort()
    activeStreamRef.current = null
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
    if (messagesStatus === "loading") {
      setMessages([])
      return
    }

    if (transcriptEpoch === 0) {
      return
    }

    setMessages(threadMessages)
  }, [messagesStatus, threadMessages, transcriptEpoch])

  React.useEffect(() => {
    bumpSubmitGeneration()
  }, [activeSession?.sessionId, bumpSubmitGeneration])

  React.useEffect(() => {
    return () => {
      submitGenerationRef.current += 1
      activeStreamRef.current?.controller.abort()
    }
  }, [])

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
                    ...message,
                    status: "complete" as const,
                  }
                : message
            )
          : currentMessages

      return [...settlePrevious, userMessage, assistantMessage]
    })

    const updateAssistant = (
      contentText: string,
      status: "streaming" | "complete" | "error"
    ) => {
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === assistantMessage.id
            ? { ...message, content: contentText, status }
            : message
        )
      )
    }

    submitChainRef.current = submitChainRef.current
      .catch(() => undefined)
      .then(async () => {
        if (generation !== submitGenerationRef.current) {
          updateAssistant("", "complete")
          return
        }

        await waitToSend(activeStreamRef.current, sendQueueBehavior)

        if (generation !== submitGenerationRef.current) {
          updateAssistant("", "complete")
          return
        }

        const controller = new AbortController()
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

        const stream: ActiveStream = {
          controller,
          messageId: assistantMessage.id,
          inFlightTools,
          waitForToolsIdle: () => {
            if (inFlightTools.size === 0) {
              return Promise.resolve()
            }
            return new Promise<void>((resolve) => {
              toolIdleWaiters.push(resolve)
            })
          },
          finished: Promise.resolve(),
        }

        stream.finished = runAgentSession(
          {
            text: content,
            model: modelReference,
            harness: runHarnessId,
            cwd,
            effort,
            promptSuggestions: inputSuggestions,
            ...(resumeSessionId ? { sessionId: resumeSessionId } : {}),
          },
          {
            signal: controller.signal,
            onFrame: (frame) => {
              if (activeStreamRef.current?.messageId !== assistantMessage.id) {
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
            onToolStarted: (id) => {
              inFlightTools.add(id)
            },
            onToolCompleted: (id) => {
              inFlightTools.delete(id)
              notifyToolsIdle()
            },
            onError: (message) => {
              updateAssistant(message, "error")
            },
            onSession: (sessionId) => {
              bindRunSession(sessionId)
            },
          }
        )
          .then(() => {
            setMessages((currentMessages) =>
              currentMessages.map((message) =>
                message.id === assistantMessage.id &&
                message.status === "streaming"
                  ? { ...message, status: "complete" }
                  : message
              )
            )
          })
          .catch((error: unknown) => {
            if (isAbortError(error)) {
              return
            }

            updateAssistant(
              error instanceof Error && error.message
                ? error.message
                : t("agentMessage.sendFailed"),
              "error"
            )
          })
          .finally(() => {
            inFlightTools.clear()
            notifyToolsIdle()
            if (activeStreamRef.current?.messageId === assistantMessage.id) {
              activeStreamRef.current = null
            }
          })

        activeStreamRef.current = stream
      })
  }, [
    bindRunSession,
    draft,
    effort,
    inputSuggestions,
    modelReference,
    queueBehavior,
    runCwd,
    runHarnessId,
    runSessionId,
    setLastModelReference,
    t,
  ])

  return {
    draft,
    messages,
    modelReference,
    canSubmit: Boolean(
      draft.trim() && modelReference && runHarnessId && runCwd.trim()
    ),
    modelReady: Boolean(modelReference && runHarnessId),
    setDraft,
    setModelReference,
    setEffort,
    submit,
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
    await previousStream.finished
    return
  }

  if (queueBehavior === "steer") {
    await previousStream.waitForToolsIdle()
  }

  previousStream.controller.abort()
  await previousStream.finished
}

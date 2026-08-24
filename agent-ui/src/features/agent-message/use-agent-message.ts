import * as React from "react"
import { useTranslation } from "react-i18next"

import { useHarness } from "@/features/sidebar/header/harness-context"
import { useChatSession } from "@/features/chat-session"

import {
  createAgentThreadMessage,
  type AgentThreadMessage,
} from "./agent-message-data"
import {
  runAgentSession,
  type AgentRunEffort,
} from "./run-agent-session"

type ActiveStream = {
  controller: AbortController
  messageId: string
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}

export function useAgentMessage() {
  const { t } = useTranslation()
  const { runHarnessId } = useHarness()
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
  const previousHarnessIdRef = React.useRef(runHarnessId)

  React.useEffect(() => {
    if (previousHarnessIdRef.current === runHarnessId) {
      return
    }

    previousHarnessIdRef.current = runHarnessId
    activeStreamRef.current?.controller.abort()
    activeStreamRef.current = null
    setDraft("")
  }, [runHarnessId])

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
    activeStreamRef.current?.controller.abort()
    activeStreamRef.current = null
  }, [activeSession?.sessionId])

  React.useEffect(() => {
    return () => {
      activeStreamRef.current?.controller.abort()
    }
  }, [])

  const submit = React.useCallback(() => {
    const content = draft.trim()
    const cwd = runCwd.trim()

    if (!content || !modelReference || !runHarnessId || !cwd) {
      return
    }

    const previousStream = activeStreamRef.current
    previousStream?.controller.abort()

    const userMessage = createAgentThreadMessage("user", content)
    const assistantMessage = createAgentThreadMessage(
      "assistant",
      "",
      "streaming"
    )
    const controller = new AbortController()
    const resumeSessionId = runSessionId

    activeStreamRef.current = {
      controller,
      messageId: assistantMessage.id,
    }

    setDraft("")
    setMessages((currentMessages) => {
      const settledMessages = previousStream
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

      return [...settledMessages, userMessage, assistantMessage]
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

    void runAgentSession(
      {
        text: content,
        model: modelReference,
        harness: runHarnessId,
        cwd,
        effort,
        ...(resumeSessionId ? { sessionId: resumeSessionId } : {}),
      },
      {
        signal: controller.signal,
        onText: (text) => {
          if (activeStreamRef.current?.messageId !== assistantMessage.id) {
            return
          }
          updateAssistant(text, "streaming")
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

        if (activeStreamRef.current?.messageId === assistantMessage.id) {
          activeStreamRef.current = null
        }
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
  }, [
    bindRunSession,
    draft,
    effort,
    modelReference,
    runCwd,
    runHarnessId,
    runSessionId,
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

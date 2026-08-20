import * as React from "react"
import { useTranslation } from "react-i18next"

import { useHarness } from "@/features/sidebar/header/harness-context"

import {
  createAgentThreadMessage,
  type AgentThreadMessage,
} from "./agent-message-data"
import { runAgentSession } from "./run-agent-session"

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
  const [draft, setDraft] = React.useState("")
  const [modelReference, setModelReference] = React.useState<string | null>(
    null
  )
  const [messages, setMessages] = React.useState<AgentThreadMessage[]>([])
  const activeStreamRef = React.useRef<ActiveStream | null>(null)

  React.useEffect(() => {
    return () => {
      activeStreamRef.current?.controller.abort()
    }
  }, [])

  const submit = React.useCallback(() => {
    const content = draft.trim()

    if (!content || !modelReference || !runHarnessId) {
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

    const updateAssistant = (contentText: string, status: "streaming" | "complete") => {
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
          updateAssistant(message, "complete")
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
          "complete"
        )
      })
  }, [draft, modelReference, runHarnessId, t])

  return {
    draft,
    messages,
    modelReference,
    canSubmit: Boolean(draft.trim() && modelReference && runHarnessId),
    modelReady: Boolean(modelReference && runHarnessId),
    setDraft,
    setModelReference,
    submit,
  }
}

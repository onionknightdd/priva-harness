import * as React from "react"
import { useTranslation } from "react-i18next"

import {
  createAgentThreadMessage,
  type AgentThreadMessage,
} from "./agent-message-data"
import { isAbortError, streamText } from "./stream-text"

type ActiveStream = {
  controller: AbortController
  messageId: string
  text: string
}

export function useAgentMessage() {
  const { t } = useTranslation()
  const [draft, setDraft] = React.useState("")
  const [messages, setMessages] = React.useState<AgentThreadMessage[]>([])
  const activeStreamRef = React.useRef<ActiveStream | null>(null)

  React.useEffect(() => {
    return () => {
      activeStreamRef.current?.controller.abort()
    }
  }, [])

  const submit = React.useCallback(() => {
    const content = draft.trim()

    if (!content) {
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
    const reply = t("agentMessage.mockAssistantReply")
    const controller = new AbortController()

    activeStreamRef.current = {
      controller,
      messageId: assistantMessage.id,
      text: reply,
    }

    setDraft("")
    setMessages((currentMessages) => {
      const settledMessages = previousStream
        ? currentMessages.map((message) =>
            message.id === previousStream.messageId
              ? {
                  ...message,
                  content: previousStream.text,
                  status: "complete" as const,
                }
              : message
          )
        : currentMessages

      return [...settledMessages, userMessage, assistantMessage]
    })

    void streamText({
      text: reply,
      signal: controller.signal,
      startDelayMs: 320,
      onUpdate: (visibleText) => {
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === assistantMessage.id &&
            message.status === "streaming"
              ? { ...message, content: visibleText }
              : message
          )
        )
      },
    })
      .then(() => {
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === assistantMessage.id
              ? { ...message, content: reply, status: "complete" }
              : message
          )
        )

        if (activeStreamRef.current?.messageId === assistantMessage.id) {
          activeStreamRef.current = null
        }
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          throw error
        }
      })
  }, [draft, t])

  return {
    draft,
    messages,
    setDraft,
    submit,
  }
}

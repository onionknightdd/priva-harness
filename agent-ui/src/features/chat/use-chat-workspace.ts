import * as React from "react"
import { useTranslation } from "react-i18next"

import { createChatMessage, type ChatMessage } from "./chat-data"

export function useChatWorkspace() {
  const { t } = useTranslation()
  const [draft, setDraft] = React.useState("")
  const [messages, setMessages] = React.useState<ChatMessage[]>([])

  const submit = React.useCallback(() => {
    const content = draft.trim()

    if (!content) {
      return
    }

    const userMessage = createChatMessage("user", content)
    const assistantMessage = createChatMessage(
      "assistant",
      t("chat.mockAssistantReply")
    )

    setDraft("")
    setMessages((currentMessages) => [
      ...currentMessages,
      userMessage,
      assistantMessage,
    ])
  }, [draft, t])

  return {
    draft,
    messages,
    setDraft,
    submit,
  }
}

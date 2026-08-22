import { ArrowDownIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { useChatSession } from "@/features/chat-session"
import { formatSessionRelativeTime, useTickingNow } from "@/lib/relative-time"

import type { AgentThreadMessage } from "../agent-message-data"
import { AgentMessageItem } from "./agent-message-item"

export function AgentMessageThread({
  messages,
}: {
  messages: AgentThreadMessage[]
}) {
  const { t, i18n } = useTranslation()
  const { activeSession } = useChatSession()
  const now = useTickingNow()
  const relativeTime = activeSession
    ? formatSessionRelativeTime(
        activeSession.lastModified,
        i18n.resolvedLanguage ?? i18n.language,
        t("agentMessage.justNow"),
        now
      )
    : null

  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-6 py-6">
            {messages.map((message) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.role === "user"}
              >
                <AgentMessageItem
                  message={message}
                  relativeTime={relativeTime}
                />
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton>
          <ArrowDownIcon />
          <span className="sr-only">{t("agentMessage.scrollToLatest")}</span>
        </MessageScrollerButton>
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

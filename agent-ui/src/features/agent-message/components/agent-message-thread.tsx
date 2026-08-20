import { ArrowDownIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Marker, MarkerContent } from "@/components/ui/marker"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"

import type { AgentThreadMessage } from "../agent-message-data"
import { AgentMessageItem } from "./agent-message-item"

export function AgentMessageThread({
  messages,
}: {
  messages: AgentThreadMessage[]
}) {
  const { t } = useTranslation()

  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-6 px-1 py-6">
            <MessageScrollerItem messageId="agent-message-today-marker">
              <Marker variant="separator">
                <MarkerContent>{t("agentMessage.today")}</MarkerContent>
              </Marker>
            </MessageScrollerItem>
            {messages.map((message) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.role === "user"}
              >
                <AgentMessageItem message={message} />
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

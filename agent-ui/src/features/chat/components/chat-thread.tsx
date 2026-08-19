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

import type { ChatMessage as ChatMessageModel } from "../chat-data"
import { ChatMessage } from "./chat-message"

export function ChatThread({ messages }: { messages: ChatMessageModel[] }) {
  const { t } = useTranslation()

  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-6 px-1 py-6">
            <MessageScrollerItem messageId="chat-today-marker">
              <Marker variant="separator">
                <MarkerContent>{t("chat.today")}</MarkerContent>
              </Marker>
            </MessageScrollerItem>
            {messages.map((message) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.role === "user"}
              >
                <ChatMessage message={message} />
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton>
          <ArrowDownIcon />
          <span className="sr-only">{t("chat.scrollToLatest")}</span>
        </MessageScrollerButton>
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

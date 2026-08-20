import { useTranslation } from "react-i18next"

import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageContent } from "@/components/ui/message"

import type { ChatMessage as ChatMessageModel } from "../chat-data"

function StreamingCaret() {
  return (
    <span
      aria-hidden="true"
      className="ml-px inline-block h-[1.05em] w-px translate-y-px bg-foreground align-[-0.15em] motion-safe:animate-pulse"
    />
  )
}

export function ChatMessage({ message }: { message: ChatMessageModel }) {
  const { t } = useTranslation()
  const align = message.role === "user" ? "end" : "start"
  const isStreaming = message.status === "streaming"
  const isThinking = isStreaming && message.content.length === 0

  return (
    <Message align={align}>
      <MessageContent>
        <Bubble
          align={align}
          variant={message.role === "user" ? "muted" : "ghost"}
        >
          <BubbleContent
            className="whitespace-pre-wrap"
            aria-live={message.role === "assistant" ? "polite" : undefined}
            aria-busy={isStreaming || undefined}
          >
            {isThinking ? (
              <span className="shimmer">{t("chat.thinking")}</span>
            ) : (
              <>
                {message.content}
                {isStreaming ? <StreamingCaret /> : null}
              </>
            )}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}

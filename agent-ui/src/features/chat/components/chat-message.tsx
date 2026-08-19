import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageContent } from "@/components/ui/message"

import type { ChatMessage as ChatMessageModel } from "../chat-data"

export function ChatMessage({ message }: { message: ChatMessageModel }) {
  const align = message.role === "user" ? "end" : "start"

  return (
    <Message align={align}>
      <MessageContent>
        <Bubble
          align={align}
          variant={message.role === "user" ? "muted" : "ghost"}
        >
          <BubbleContent className="whitespace-pre-wrap">
            {message.content}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}

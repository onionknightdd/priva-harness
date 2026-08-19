import { useChatWorkspace } from "./use-chat-workspace"
import { ChatWorkspace } from "./components/chat-workspace"

export function ChatPage() {
  const chat = useChatWorkspace()

  return (
    <ChatWorkspace
      draft={chat.draft}
      messages={chat.messages}
      onDraftChange={chat.setDraft}
      onSubmit={chat.submit}
    />
  )
}

import { useAgentMessage } from "./use-agent-message"
import { AgentMessage } from "./components/agent-message"

export function AgentMessagePage() {
  const agentMessage = useAgentMessage()

  return (
    <AgentMessage
      draft={agentMessage.draft}
      messages={agentMessage.messages}
      onDraftChange={agentMessage.setDraft}
      onSubmit={agentMessage.submit}
    />
  )
}

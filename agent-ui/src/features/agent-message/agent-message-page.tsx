import { useAgentMessage } from "./use-agent-message"
import { AgentMessage } from "./components/agent-message"

export function AgentMessagePage() {
  const agentMessage = useAgentMessage()

  return (
    <AgentMessage
      draft={agentMessage.draft}
      messages={agentMessage.messages}
      canSubmit={agentMessage.canSubmit}
      modelReady={agentMessage.modelReady}
      onDraftChange={agentMessage.setDraft}
      onModelReferenceChange={agentMessage.setModelReference}
      onEffortChange={agentMessage.setEffort}
      onSubmit={agentMessage.submit}
    />
  )
}

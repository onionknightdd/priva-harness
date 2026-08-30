import { useAgentMessage } from "./use-agent-message"
import { AgentMessage } from "./components/agent-message"

export function AgentMessagePage() {
  const agentMessage = useAgentMessage()

  return (
    <AgentMessage
      draft={agentMessage.draft}
      messages={agentMessage.messages}
      contextUsage={agentMessage.contextUsage}
      canSubmit={agentMessage.canSubmit}
      isStreaming={agentMessage.isStreaming}
      modelReady={agentMessage.modelReady}
      slashCommand={agentMessage.slashCommand}
      onDraftChange={agentMessage.setDraft}
      onSlashCommandChange={agentMessage.setSlashCommand}
      onModelReferenceChange={agentMessage.setModelReference}
      onEffortChange={agentMessage.setEffort}
      onSubmit={agentMessage.submit}
      onStop={agentMessage.stop}
    />
  )
}

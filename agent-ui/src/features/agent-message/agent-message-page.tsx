import { agentToolsForThread } from "./agent-tool-data"
import { useEffect } from "react"
import { useActiveSession } from "@/features/chat-session"
import { useHarness } from "@/features/sidebar/header/harness-context"
import { useWorkspaceWorkflow } from "@/features/workspace/use-workspace-workflow"
import { useAgentMessage } from "./use-agent-message"
import { AgentMessage } from "./components/agent-message"

export function AgentMessagePage() {
  const agentMessage = useAgentMessage()
  const { syncWorkflows, syncAgents } = useWorkspaceWorkflow()
  const { activeSession, runSessionId } = useActiveSession()
  const { runHarnessId } = useHarness()
  const sourceKey = `${runHarnessId}:${activeSession?.sessionId ?? runSessionId}`
  useEffect(() => {
    syncAgents(sourceKey, agentToolsForThread(agentMessage.messages))
    syncWorkflows(sourceKey, agentMessage.messages.flatMap((message) => message.workflows ?? []))
  }, [sourceKey, agentMessage.messages, syncWorkflows, syncAgents])

  return (
    <>
    {agentMessage.connectionError ? <div role="alert" className="mx-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{agentMessage.connectionError}</div> : null}
    <AgentMessage
      interactions={agentMessage.interactions}
      interactionConnected={agentMessage.isConnected}
      onInteractionResponse={agentMessage.respondPermission}
      attachments={agentMessage.composerAttachments.attachments}
      onFilesSelected={agentMessage.composerAttachments.add}
      onAttachmentRemove={agentMessage.composerAttachments.remove}
      onAttachmentRetry={agentMessage.composerAttachments.retry}
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
    </>
  )
}

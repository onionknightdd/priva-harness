import { agentToolsForThread } from "./agent-tool-data"
import { useCallback, useEffect } from "react"
import { useActiveSession, useChatSessionActions } from "@/features/chat-session"
import { useHarness } from "@/features/sidebar/header/harness-context"
import { useWorkspaceWorkflow } from "@/features/workspace/use-workspace-workflow"
import { useAgentMessage } from "./use-agent-message"
import { AgentMessage } from "./components/agent-message"
import { SessionTerminalView } from "./components/session-terminal-view"
import { harnessSupportsTerminal } from "./session-view"
import { useSessionView } from "./session-view-context"

export function AgentMessagePage() {
  const agentMessage = useAgentMessage()
  const { syncWorkflows, syncAgents } = useWorkspaceWorkflow()
  const { activeSession, runSessionId, runCwd } = useActiveSession()
  const { bindRunSession } = useChatSessionActions()
  const { runHarnessId } = useHarness()
  const { view, terminalOpened, preserveViewForSession } = useSessionView()
  const viewedSessionId = activeSession?.sessionId ?? runSessionId
  const sourceKey = `${runHarnessId}:${viewedSessionId}`
  const terminalView = view === "terminal" && harnessSupportsTerminal(runHarnessId)
  const rebindTerminalSession = useCallback((sessionId: string) => {
    preserveViewForSession(sessionId)
    bindRunSession(sessionId)
  }, [bindRunSession, preserveViewForSession])
  useEffect(() => {
    syncAgents(sourceKey, agentToolsForThread(agentMessage.messages))
    syncWorkflows(sourceKey, agentMessage.messages.flatMap((message) => message.workflows ?? []))
  }, [sourceKey, agentMessage.messages, syncWorkflows, syncAgents])

  return (
    <>
    {agentMessage.connectionError ? <div role="alert" className="mx-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{agentMessage.connectionError}</div> : null}
    {terminalOpened && viewedSessionId && runHarnessId && harnessSupportsTerminal(runHarnessId) ? (
      <SessionTerminalView
        harness={runHarnessId}
        cwd={runCwd}
        model={agentMessage.modelReference}
        effort={agentMessage.effort}
        sessionId={viewedSessionId}
        hidden={!terminalView}
        onSessionRebound={rebindTerminalSession}
      />
    ) : null}
    <AgentMessage
      hidden={terminalView}
      interactions={agentMessage.interactions}
      interactionConnected={agentMessage.isConnected}
      onInteractionResponse={agentMessage.respondPermission}
      attachments={agentMessage.composerAttachments.attachments}
      onFilesSelected={agentMessage.composerAttachments.add}
      onAttachmentRemove={agentMessage.composerAttachments.remove}
      onAttachmentRetry={agentMessage.composerAttachments.retry}
      draft={agentMessage.draft}
      promptSuggestion={agentMessage.promptSuggestion}
      onDismissPromptSuggestion={agentMessage.dismissPromptSuggestion}
      messages={agentMessage.messages}
      contextUsage={agentMessage.contextUsage}
      canSubmit={agentMessage.canSubmit}
      isStreaming={agentMessage.isStreaming}
      modelReady={agentMessage.modelReady}
      modelReference={agentMessage.modelReference}
      effort={agentMessage.effort}
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

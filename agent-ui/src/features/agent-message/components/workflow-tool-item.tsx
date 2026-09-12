import { useCallback, useRef } from "react"
import { useActiveSession } from "@/features/chat-session"
import { useHarness } from "@/features/sidebar/header/harness-context"
import { fetchWorkflowAgentDetail } from "@/lib/api/sandbox-sessions"
import type { WorkflowAgent, WorkflowAgentDetail, WorkflowCard } from "../workflow-data"
import { WorkflowOverview } from "./workflow-overview"
import { useWorkspaceWorkflow } from "@/features/workspace/use-workspace-workflow"

export function WorkflowToolItem({ workflow }: { workflow: WorkflowCard }) {
  const { openWorkflow } = useWorkspaceWorkflow()
  const { runSessionId, activeSession } = useActiveSession()
  const { runHarnessId } = useHarness()
  const sessionId = activeSession?.sessionId ?? runSessionId
  const cache = useRef(new Map<string, WorkflowAgentDetail>())
  const loadDetail = useCallback(async (runId: string | undefined, agent: WorkflowAgent, signal: AbortSignal) => {
    if (!sessionId || !runId || !agent.agentId || !runHarnessId) {
      throw new Error("Workflow agent transcript is not available")
    }
    const key = `${runHarnessId}:${sessionId}:${runId}:${agent.agentId}:${agent.attempt ?? 1}`
    const cached = cache.current.get(key)
    if (cached) return cached
    const detail = await fetchWorkflowAgentDetail(runHarnessId, sessionId, runId, agent.agentId, signal)
    if (agent.state === "completed" && detail.result !== null) cache.current.set(key, detail)
    return detail
  }, [runHarnessId, sessionId])
  return <WorkflowOverview workflow={workflow} onOpenAgent={(agentIndex) => openWorkflow({
    sourceKey: `${runHarnessId}:${sessionId}`, workflow, agentIndex, loadDetail,
  })} />
}

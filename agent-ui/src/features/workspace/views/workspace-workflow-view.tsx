import { WorkspaceTasksView } from "./workspace-tasks-view"
import { WorkspaceAgentView } from "./workspace-agent-view"
import { useCallback } from "react"
import type { LoadWorkflowAgent } from "@/features/agent-message/components/workflow-agent-detail"
import { useTranslation } from "react-i18next"
import { WorkflowPipeline } from "@/features/agent-message/components/workflow-pipeline"
import { useWorkspaceWorkflow } from "../use-workspace-workflow"

export function WorkspaceWorkflowView() {
  const { target, agentTarget } = useWorkspaceWorkflow()
  const { t } = useTranslation()
  const loader = target?.loadDetail
  const runId = target?.workflow.workflowRunId
  const loadDetail = useCallback<LoadWorkflowAgent>((agent, signal) => {
    if (!loader) return Promise.reject(new Error("No workflow selected"))
    return loader(runId, agent, signal)
  }, [loader, runId])
  if (agentTarget) return <WorkspaceAgentView key={`${agentTarget.sourceKey}:${agentTarget.navigationId}`} target={agentTarget} />
  if (!target) return <WorkspaceTasksView />
  return (
    <div className="min-h-0 min-w-0 overflow-y-auto p-1" role="region" aria-label={t("agentMessage.workflow")}>
      <WorkflowPipeline key={`${target.sourceKey}:${target.workflow.workflowToolUseId}:${target.navigationId}`}
        workflow={target.workflow} loadDetail={loadDetail} initialAgentIndex={target.agentIndex} />
    </div>
  )
}

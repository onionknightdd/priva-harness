import { createContext, useContext } from "react"
import type { WorkflowCard } from "@/features/agent-message/workflow-data"
import type { LoadWorkflowAgent } from "@/features/agent-message/components/workflow-agent-detail"
export interface WorkspaceWorkflowTarget {
  sourceKey: string
  workflow: WorkflowCard
  agentIndex: number
  loadDetail: (runId: string | undefined, ...args: Parameters<LoadWorkflowAgent>) => ReturnType<LoadWorkflowAgent>
}

type WorkflowContextValue = {
  target: (WorkspaceWorkflowTarget & { navigationId: number }) | null
  openWorkflow: (target: WorkspaceWorkflowTarget) => void
  syncWorkflows: (sourceKey: string, workflows: readonly WorkflowCard[]) => void
}
export const WorkflowContext = createContext<WorkflowContextValue | null>(null)

export function useWorkspaceWorkflow() {
  const context = useContext(WorkflowContext)
  if (!context) throw new Error("useWorkspaceWorkflow requires WorkspaceWorkflowProvider")
  return context
}

import type { AgentToolView } from "@/features/agent-message/agent-tool-data"
import type { BackgroundTask } from "@/features/agent-message/background-task-store"
import { createContext, useContext } from "react"
import type { WorkflowCard } from "@/features/agent-message/workflow-data"
import type { LoadWorkflowAgent } from "@/features/agent-message/components/workflow-agent-detail"
export interface WorkspaceWorkflowTarget {
  sourceKey: string
  workflow: WorkflowCard
  agentIndex: number
  loadDetail: (runId: string | undefined, ...args: Parameters<LoadWorkflowAgent>) => ReturnType<LoadWorkflowAgent>
}

export type AgentNavigation = { tab?: "process" | "result"; notificationId?: string }
export type WorkspaceAgentTarget = { sourceKey: string; agents: AgentToolView[]; selectedId: string; navigationId: number } & AgentNavigation

type WorkflowContextValue = {
  agentTarget: WorkspaceAgentTarget | null
  openAgent: (sourceKey: string, agents: AgentToolView[], selectedId: string, navigation?: AgentNavigation) => void
  openTask: (task: BackgroundTask, notificationId?: string) => void
  syncAgents: (sourceKey: string, agents: AgentToolView[]) => void
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

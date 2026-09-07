import type { AgentToolView } from "@/features/agent-message/agent-tool-data"
import type { WorkspaceAgentTarget } from "./use-workspace-workflow"
import { useCallback, useMemo, useState, useRef, type ReactNode } from "react"
import { useSidebar } from "@/components/ui/sidebar"
import type { WorkflowCard } from "@/features/agent-message/workflow-data"
import { WorkflowContext, type WorkspaceWorkflowTarget } from "./use-workspace-workflow"
import { useWorkspaceFiles } from "./workspace-files-context"

export function WorkspaceWorkflowProvider({ children }: { children: ReactNode }) {
  const agentCatalog = useRef<{ sourceKey: string; agents: AgentToolView[] } | null>(null)
  const [agentTarget, setAgentTarget] = useState<WorkspaceAgentTarget | null>(null)
  const [target, setTarget] = useState<(WorkspaceWorkflowTarget & { navigationId: number }) | null>(null)
  const { isMobile, setOpen, setOpenMobile } = useSidebar()
  const { setActiveTabId } = useWorkspaceFiles()
  const openWorkflow = useCallback((next: WorkspaceWorkflowTarget) => {
    setAgentTarget(null)
    setTarget((current) => ({ ...next, navigationId: (current?.navigationId ?? 0) + 1 }))
    setActiveTabId("tasks")
    if (isMobile) setOpenMobile(true)
    else setOpen(true)
  }, [isMobile, setOpen, setOpenMobile, setActiveTabId])
  const openAgent = useCallback((sourceKey: string, agents: AgentToolView[], selectedId: string) => {
    setTarget(null)
    setAgentTarget((current) => ({ sourceKey, agents: agentCatalog.current?.sourceKey === sourceKey ? agentCatalog.current.agents : agents, selectedId, navigationId: (current?.navigationId ?? 0) + 1 }))
    setActiveTabId("tasks")
    if (isMobile) setOpenMobile(true)
    else setOpen(true)
  }, [isMobile, setOpen, setOpenMobile, setActiveTabId])
  const syncAgents = useCallback((sourceKey: string, agents: AgentToolView[]) => {
    agentCatalog.current = { sourceKey, agents }
    setAgentTarget((current) => !current || current.sourceKey !== sourceKey ? null : { ...current, agents })
  }, [])
  const syncWorkflows = useCallback((sourceKey: string, workflows: readonly WorkflowCard[]) => {
    setTarget((current) => {
      if (!current) return current
      if (current.sourceKey !== sourceKey) return null
      const workflow = workflows.find((item) => item.workflowToolUseId === current.workflow.workflowToolUseId)
      return workflow && workflow !== current.workflow ? { ...current, workflow } : current
    })
  }, [])
  const value = useMemo(() => ({ target, agentTarget, openAgent, syncAgents, openWorkflow, syncWorkflows }), [target, agentTarget, openAgent, syncAgents, openWorkflow, syncWorkflows])
  return <WorkflowContext.Provider value={value}>{children}</WorkflowContext.Provider>
}

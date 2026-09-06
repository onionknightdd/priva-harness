import { useCallback, useMemo, useState, type ReactNode } from "react"
import { useSidebar } from "@/components/ui/sidebar"
import type { WorkflowCard } from "@/features/agent-message/workflow-data"
import { WorkflowContext, type WorkspaceWorkflowTarget } from "./use-workspace-workflow"
import { useWorkspaceFiles } from "./workspace-files-context"

export function WorkspaceWorkflowProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<(WorkspaceWorkflowTarget & { navigationId: number }) | null>(null)
  const { isMobile, setOpen, setOpenMobile } = useSidebar()
  const { setActiveTabId } = useWorkspaceFiles()
  const openWorkflow = useCallback((next: WorkspaceWorkflowTarget) => {
    setTarget((current) => ({ ...next, navigationId: (current?.navigationId ?? 0) + 1 }))
    setActiveTabId("tasks")
    if (isMobile) setOpenMobile(true)
    else setOpen(true)
  }, [isMobile, setOpen, setOpenMobile, setActiveTabId])
  const syncWorkflows = useCallback((sourceKey: string, workflows: readonly WorkflowCard[]) => {
    setTarget((current) => {
      if (!current) return current
      if (current.sourceKey !== sourceKey) return null
      const workflow = workflows.find((item) => item.workflowToolUseId === current.workflow.workflowToolUseId)
      return workflow && workflow !== current.workflow ? { ...current, workflow } : current
    })
  }, [])
  const value = useMemo(() => ({ target, openWorkflow, syncWorkflows }), [target, openWorkflow, syncWorkflows])
  return <WorkflowContext.Provider value={value}>{children}</WorkflowContext.Provider>
}

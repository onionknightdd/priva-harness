export type WorkflowStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "paused" | "skipped" | "unknown"

export interface WorkflowPhase {
  readonly index: number
  readonly title: string
  readonly detail?: string
}

export interface WorkflowAgent {
  readonly index: number
  readonly label: string
  readonly phaseIndex?: number
  readonly agentId?: string
  readonly state: WorkflowStatus
  readonly model?: string
  readonly startedAt?: number
  readonly durationMs?: number
  readonly tokens?: number
  readonly toolCalls?: number
  readonly attempt?: number
  readonly lastToolName?: string
  readonly lastToolSummary?: string
  readonly promptPreview?: string
  readonly resultPreview?: string
  readonly error?: string
}

export interface WorkflowCard {
  readonly workflowToolUseId: string
  readonly workflowRunId?: string
  readonly taskId?: string
  readonly name?: string
  readonly summary?: string
  readonly status: WorkflowStatus
  readonly phases: readonly WorkflowPhase[]
  readonly agents: readonly WorkflowAgent[]
  readonly durationMs?: number
  readonly totalTokens?: number
  readonly totalToolCalls?: number
  readonly detailsUnavailable?: boolean
}

export interface WorkflowExecutionEntry {
  readonly id: string
  readonly kind: "message" | "thinking" | "tool"
  readonly text: string
  readonly name?: string
  readonly output?: string
  readonly isError?: boolean
}

export interface WorkflowAgentDetail {
  readonly process: readonly WorkflowExecutionEntry[]
  readonly prompt: string | null
  readonly result: string | null
}

export function isWorkflowTool(name: string): boolean {
  return name.trim().toLowerCase() === "workflow"
}

export function isWorkflowStatus(value: unknown): value is WorkflowStatus {
  return typeof value === "string" && ["pending", "running", "completed", "failed", "cancelled", "paused", "skipped", "unknown"].includes(value)
}

export function workflowFromSnapshot(value: unknown): WorkflowCard | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const card = value as WorkflowCard
  if (typeof card.workflowToolUseId !== "string" || !isWorkflowStatus(card.status)) return undefined
  if (!Array.isArray(card.phases) || !Array.isArray(card.agents)) return undefined
  if (!card.phases.every((phase) => phase && Number.isInteger(phase.index) && typeof phase.title === "string")) return undefined
  if (!card.agents.every((agent) => agent && Number.isInteger(agent.index) && typeof agent.label === "string" && isWorkflowStatus(agent.state))) return undefined
  return card
}

export function workflowIsActive(status: WorkflowStatus): boolean {
  return status === "running" || status === "pending"
}

export function workflowPhaseStatus(agents: readonly WorkflowAgent[], workflowStatus: WorkflowStatus): WorkflowStatus {
  if (agents.some((agent) => agent.state === "running")) return "running"
  if (agents.some((agent) => agent.state === "failed")) return "failed"
  if (agents.some((agent) => agent.state === "cancelled")) return "cancelled"
  if (agents.some((agent) => agent.state === "paused")) return "paused"
  if (agents.length && agents.every((agent) => agent.state === "skipped")) return "skipped"
  if (agents.length && agents.every((agent) => agent.state === "completed" || agent.state === "skipped")) return "completed"
  if (workflowStatus === "cancelled" || workflowStatus === "failed" || workflowStatus === "unknown") return "unknown"
  return "pending"
}

export function workflowDuration(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms)) return undefined
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

export const workflowStatusColor: Record<WorkflowStatus, string> = {
  pending: "text-muted-foreground/60",
  running: "text-status-running",
  completed: "text-status-success",
  failed: "text-status-error",
  cancelled: "text-muted-foreground",
  paused: "text-status-warm",
  skipped: "text-muted-foreground",
  unknown: "text-muted-foreground",
}


export function settleWorkflowCards(workflows: readonly WorkflowCard[] | undefined, status: "cancelled" | "failed"): WorkflowCard[] | undefined {
  return workflows?.map((workflow) => ["running", "pending", "paused"].includes(workflow.status)
    ? { ...workflow, status, agents: workflow.agents.map((agent) =>
        ["running", "pending", "paused"].includes(agent.state)
          ? { ...agent, state: status === "cancelled" ? "cancelled" as const : "unknown" as const }
          : agent) }
    : workflow)
}

export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused' | 'skipped' | 'unknown'

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

export interface WorkflowState {
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

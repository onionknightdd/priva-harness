import type { ModelTokenUsage, RunFailureCode, TokenUsage } from '../event/agent-event.js'

// Usage and audit facts recorded by the runner. Every record produces one
// immutable audit_event row; run/tool records additionally project into the
// typed fact tables so aggregation never has to parse JSON.

export const RUN_SOURCES = ['web', 'subagent-test', 'channel', 'scheduled'] as const
export type RunSource = (typeof RUN_SOURCES)[number]

export const RUN_OUTCOMES = ['running', 'completed', 'failed', 'aborted'] as const
export type RunOutcome = (typeof RUN_OUTCOMES)[number]

interface RecordBase {
  readonly tsUtc: string
  readonly details: unknown
}

export interface AuditRecord extends RecordBase {
  readonly kind: 'audit'
  readonly action: string
  readonly sessionId?: string
  readonly runId?: string
  readonly target?: string
}

export interface RunStartedRecord extends RecordBase {
  readonly kind: 'run.started'
  readonly runId: string
  readonly sessionId?: string
  readonly provider: string
  readonly profileId?: string
  readonly model: string
  readonly source: RunSource
  // Working directory the run executed in; distinct values count as projects.
  readonly cwd: string
  readonly promptChars: number
  readonly attachmentCount: number
}

// Pi only knows the session id after the provider opens the session, so the
// run row is created without one and back-filled here.
export interface RunSessionRecord {
  readonly kind: 'run.session'
  readonly runId: string
  readonly sessionId: string
}

export interface RunFinishedRecord extends RecordBase {
  readonly kind: 'run.finished'
  readonly runId: string
  readonly sessionId?: string
  readonly outcome: Exclude<RunOutcome, 'running'>
  readonly failureCode?: RunFailureCode
  readonly durationMs: number
  readonly apiDurationMs?: number
  readonly numTurns?: number
  readonly usage?: TokenUsage
  readonly costUsd?: number
  readonly byModel?: Readonly<Record<string, ModelTokenUsage>>
}

export interface ToolRecord extends RecordBase {
  readonly kind: 'tool'
  readonly runId: string
  readonly sessionId?: string
  readonly toolUseId: string
  readonly toolName: string
  readonly ok: boolean
  readonly durationMs?: number
  readonly outputTokens?: number
  readonly agentId?: string
}

export type DataRecord =
  | AuditRecord
  | RunStartedRecord
  | RunSessionRecord
  | RunFinishedRecord
  | ToolRecord

export interface DataRetention {
  readonly auditRetentionDays: number
  readonly toolAuditRetentionDays: number
  readonly factRetentionDays: number
}

export function defaultDataRetention(): DataRetention {
  return {
    auditRetentionDays: 90,
    toolAuditRetentionDays: 90,
    factRetentionDays: 365,
  }
}

export interface DataStoreStatus {
  readonly auditEvents: number
  readonly runFacts: number
  readonly toolFacts: number
  readonly runningRuns: number
  readonly lastPruneUtc: string | null
}

export interface DataStoreLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

export function isRunSource(value: unknown): value is RunSource {
  return typeof value === 'string' && (RUN_SOURCES as readonly string[]).includes(value)
}

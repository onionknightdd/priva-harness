import type { ProviderRunSpec } from '../../core/contract/agent-provider.js'
import type { DataRecorder } from '../../core/contract/data-recorder.js'
import type { AgentEvent } from '../../core/event/agent-event.js'
import type { RunFinishedRecord, RunSource } from '../../core/resource/data-store.js'
import type { UserTurn } from '../../core/run/user-turn.js'

const PROMPT_PREVIEW_CHARS = 200

export interface RunLedgerStart {
  readonly runId: string
  readonly spec: ProviderRunSpec
  readonly source: RunSource
  readonly turn: UserTurn
  readonly sessionId?: string
}

// Per-run bookkeeping for the usage store: one run.started, at most one
// run.session back-fill and exactly one run.finished, whatever path the run
// takes to its end. Recording is fire-and-forget; nothing here can fail the
// run.
export class RunLedger {
  private readonly startedAt = Date.now()
  private sessionId: string | undefined
  private closed = false

  constructor(
    private readonly recorder: DataRecorder | undefined,
    private readonly start: RunLedgerStart,
  ) {
    this.sessionId = emptyToUndefined(start.sessionId)
    const attachments = start.turn.attachments ?? []
    this.recorder?.record({
      kind: 'run.started',
      tsUtc: new Date(this.startedAt).toISOString(),
      runId: start.runId,
      ...(this.sessionId === undefined ? {} : { sessionId: this.sessionId }),
      provider: start.spec.provider,
      ...(start.spec.profileId === undefined ? {} : { profileId: start.spec.profileId }),
      model: start.spec.model,
      source: start.source,
      promptChars: start.turn.text.length,
      attachmentCount: attachments.length,
      details: {
        promptPreview: start.turn.text.slice(0, PROMPT_PREVIEW_CHARS),
        attachments: attachments.map((file) => file.name),
        cwd: start.spec.cwd,
      },
    })
  }

  attachSession(sessionId: string): void {
    const id = emptyToUndefined(sessionId)
    if (id === undefined || id === this.sessionId) return
    this.sessionId = id
    this.recorder?.record({ kind: 'run.session', runId: this.start.runId, sessionId: id })
  }

  // Observes the forwarded stream; terminal events close the ledger.
  observe(event: AgentEvent): void {
    switch (event.type) {
      case 'run.completed':
        this.finish({ outcome: 'completed', ...accountingOf(event) }, event)
        return
      case 'run.failed':
        this.finish({ outcome: 'failed', failureCode: event.code ?? 'unknown', ...accountingOf(event) }, event)
        return
      case 'run.aborted':
        this.finish({ outcome: 'aborted' }, event)
        return
      case 'error':
        this.finish({ outcome: 'failed', failureCode: 'transport_error' }, event)
        return
      default:
    }
  }

  crashed(error: unknown): void {
    this.finish(
      { outcome: 'failed', failureCode: 'runtime_crash' },
      { message: error instanceof Error ? error.message : String(error) },
    )
  }

  // The stream ended without any terminal event: the caller went away
  // (abort) or the provider stopped without saying why.
  settle(aborted: boolean): void {
    if (this.closed) return
    if (aborted) this.finish({ outcome: 'aborted' }, { reason: 'stream closed after abort' })
    else this.finish({ outcome: 'failed', failureCode: 'unknown' }, { reason: 'stream ended without a result' })
  }

  private finish(
    fields: Omit<RunFinishedRecord, 'kind' | 'tsUtc' | 'runId' | 'durationMs' | 'details'>,
    details: unknown,
  ): void {
    if (this.closed) return
    this.closed = true
    const now = Date.now()
    this.recorder?.record({
      kind: 'run.finished',
      tsUtc: new Date(now).toISOString(),
      runId: this.start.runId,
      durationMs: Math.max(0, now - this.startedAt),
      ...fields,
      details,
    })
  }
}

type TerminalAccounting = Pick<RunFinishedRecord, 'apiDurationMs' | 'numTurns' | 'usage' | 'costUsd' | 'byModel'>

function accountingOf(event: Extract<AgentEvent, { type: 'run.completed' | 'run.failed' }>): TerminalAccounting {
  return {
    ...(event.apiDurationMs === undefined ? {} : { apiDurationMs: event.apiDurationMs }),
    ...(event.numTurns === undefined ? {} : { numTurns: event.numTurns }),
    ...(event.usage === undefined ? {} : { usage: event.usage }),
    ...(event.costUsd === undefined ? {} : { costUsd: event.costUsd }),
    ...(event.byModel === undefined ? {} : { byModel: event.byModel }),
  }
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value
}

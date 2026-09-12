import type { ProviderRunSpec, SessionTarget } from '../../core/contract/agent-provider.js'
import type { DataRecorder } from '../../core/contract/data-recorder.js'
import type { AgentEvent } from '../../core/event/agent-event.js'
import { asRecord, stringField } from '../../core/event/json-record.js'
import type { RunFinishedRecord, RunSource } from '../../core/resource/data-store.js'
import type { InteractionRequest } from '../../core/resource/interaction.js'
import type { UserTurn } from '../../core/run/user-turn.js'

const PROMPT_PREVIEW_CHARS = 200
const TOOL_OUTPUT_PREVIEW_CHARS = 200
const SLASH_SKILL = /^\/([a-z0-9][a-z0-9_-]*)(?:\s|$)/i

export interface RunLedgerStart {
  readonly runId: string
  readonly spec: ProviderRunSpec
  readonly source: RunSource
  readonly turn: UserTurn
  readonly sessionId?: string
  // How the run reaches its session; new and fork sessions are audited as
  // created / forked the moment their id is known.
  readonly sessionTarget: SessionTarget
  // Skill names known for this provider; a "/name" prompt is only counted
  // as a skill invocation when it matches one of them.
  readonly knownSkills?: ReadonlySet<string>
}

interface PendingTool {
  name: string
  input: unknown
  readonly seenAt: number
  runningAt: number | undefined
}

// Per-run bookkeeping for the usage store: one run.started, at most one
// run.session back-fill, exactly one run.finished, plus the tool, skill,
// permission, compaction, subagent and workflow audits observed on the way.
// Recording is fire-and-forget; nothing here can fail the run.
export class RunLedger {
  private readonly startedAt = Date.now()
  private sessionId: string | undefined
  private closed = false
  private readonly tools = new Map<string, PendingTool>()
  private readonly recordedTools = new Set<string>()
  private readonly interactions = new Map<string, { request: InteractionRequest; at: number }>()
  private readonly agents = new Map<string, { name: string | undefined; at: number }>()
  private readonly workflows = new Map<string, { name: string | undefined; at: number }>()

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
      cwd: start.spec.cwd,
      promptChars: start.turn.text.length,
      attachmentCount: attachments.length,
      details: {
        promptPreview: start.turn.text.slice(0, PROMPT_PREVIEW_CHARS),
        attachments: attachments.map((file) => file.name),
        cwd: start.spec.cwd,
      },
    })
    this.recordSlashSkill(start.turn.text)
    if (this.sessionId !== undefined) this.auditSessionOrigin(this.sessionId)
  }

  attachSession(sessionId: string): void {
    const id = emptyToUndefined(sessionId)
    if (id === undefined || id === this.sessionId) return
    const first = this.sessionId === undefined
    this.sessionId = id
    this.recorder?.record({ kind: 'run.session', runId: this.start.runId, sessionId: id })
    if (first) this.auditSessionOrigin(id)
  }

  private auditSessionOrigin(id: string): void {
    const target = this.start.sessionTarget
    if (target.kind === 'new') {
      this.audit('session.created', undefined, { provider: this.start.spec.provider, cwd: this.start.spec.cwd })
    } else if (target.kind === 'fork') {
      this.audit('session.forked', id, { sourceSessionId: target.source.id, provider: this.start.spec.provider })
    }
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
      case 'tool.started':
        this.tools.set(event.id, { name: event.name, input: event.input, seenAt: Date.now(), runningAt: undefined })
        return
      case 'tool.updated': {
        const pending = this.tools.get(event.id)
        if (pending === undefined) {
          this.tools.set(event.id, { name: event.name, input: event.input, seenAt: Date.now(), runningAt: undefined })
        } else {
          pending.name = event.name
          pending.input = event.input
        }
        return
      }
      case 'tool.running': {
        const pending = this.tools.get(event.id)
        if (pending !== undefined && pending.runningAt === undefined) pending.runningAt = Date.now()
        return
      }
      case 'tool.completed':
        this.recordTool(event)
        return
      case 'permission.requested':
        this.interactions.set(event.request.requestId, { request: event.request, at: Date.now() })
        return
      case 'permission.resolved':
        this.recordInteraction(event.resolution.request, event.resolution.decision, event.resolution.reason, event.resolution.answers)
        return
      case 'session.compacted':
        this.audit('session.compacted', undefined, {
          ...(event.summary === undefined ? {} : { summaryChars: event.summary.length }),
        })
        return
      case 'agent.started':
        this.agents.set(event.agentId, { name: event.name, at: Date.now() })
        return
      case 'agent.completed': {
        const started = this.agents.get(event.agentId)
        this.agents.delete(event.agentId)
        this.audit('agent.completed', started?.name, {
          agentId: event.agentId,
          ...(event.ok === undefined ? {} : { ok: event.ok }),
          ...(event.status === undefined ? {} : { status: event.status }),
          ...(started === undefined ? {} : { durationMs: Date.now() - started.at }),
        })
        return
      }
      case 'workflow.started':
        this.workflows.set(event.workflowToolUseId, { name: event.name, at: Date.now() })
        return
      case 'workflow.completed': {
        const started = this.workflows.get(event.workflowToolUseId)
        this.workflows.delete(event.workflowToolUseId)
        this.audit('workflow.completed', started?.name, {
          workflowToolUseId: event.workflowToolUseId,
          status: event.status,
          ...(started === undefined ? {} : { durationMs: Date.now() - started.at }),
        })
        return
      }
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

  private recordTool(event: Extract<AgentEvent, { type: 'tool.completed' }>): void {
    // Claude reports a Skill tool's result twice (expanded prompt, then the
    // regular tool_result); one fact per tool_use_id.
    if (this.recordedTools.has(event.id)) return
    this.recordedTools.add(event.id)
    const pending = this.tools.get(event.id)
    this.tools.delete(event.id)
    const now = Date.now()
    const durationMs = event.durationMs
      ?? (pending === undefined ? undefined : now - (pending.runningAt ?? pending.seenAt))
    this.recorder?.record({
      kind: 'tool',
      tsUtc: new Date(now).toISOString(),
      runId: this.start.runId,
      ...(this.sessionId === undefined ? {} : { sessionId: this.sessionId }),
      toolUseId: event.id,
      toolName: event.name,
      ok: event.ok,
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(event.tokens === undefined ? {} : { outputTokens: event.tokens }),
      ...(event.agentId === undefined ? {} : { agentId: event.agentId }),
      details: {
        input: pending?.input ?? null,
        output: event.output.slice(0, TOOL_OUTPUT_PREVIEW_CHARS),
        outputChars: event.output.length,
        ...(event.status === undefined ? {} : { status: event.status }),
      },
    })
    if (event.name.toLowerCase() === 'skill') {
      const skill = stringField(asRecord(pending?.input) ?? {}, 'skill')
      if (skill !== undefined && skill !== '') {
        this.audit('skill.invoked', skill, { via: 'tool', toolUseId: event.id, input: pending?.input ?? null })
      }
    }
  }

  private recordSlashSkill(text: string): void {
    const name = SLASH_SKILL.exec(text)?.[1]?.toLowerCase()
    if (name === undefined || this.start.knownSkills?.has(name) !== true) return
    this.audit('skill.invoked', name, { via: 'prompt', promptPreview: text.slice(0, PROMPT_PREVIEW_CHARS) })
  }

  private recordInteraction(
    request: InteractionRequest,
    decision: 'allow' | 'deny',
    reason: string,
    answers: unknown,
  ): void {
    const requested = this.interactions.get(request.requestId)
    this.interactions.delete(request.requestId)
    const latency = requested === undefined ? {} : { latencyMs: Date.now() - requested.at }
    if (request.kind === 'question') {
      this.audit('question.answered', request.tool, {
        requestId: request.requestId, decision, reason, questions: request.questions.length,
        ...(answers === undefined ? {} : { answers }), ...latency,
      })
      return
    }
    this.audit('permission.resolved', request.tool, {
      requestId: request.requestId, decision, reason,
      ...(request.toolUseId === undefined ? {} : { toolUseId: request.toolUseId }),
      ...(request.reason === undefined ? {} : { requestReason: request.reason }),
      ...latency,
    })
  }

  private audit(action: string, target: string | undefined, details: unknown): void {
    this.recorder?.record({
      kind: 'audit',
      tsUtc: new Date().toISOString(),
      action,
      runId: this.start.runId,
      ...(this.sessionId === undefined ? {} : { sessionId: this.sessionId }),
      ...(target === undefined ? {} : { target }),
      details,
    })
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
      ...(this.sessionId === undefined ? {} : { sessionId: this.sessionId }),
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

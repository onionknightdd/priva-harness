import { isDeepStrictEqual } from 'node:util'

import type { TerminalQuestion } from '../../core/contract/terminal-service.js'
import type { AgentEvent } from '../../core/event/agent-event.js'
import type { InteractionRequest, InteractionResolution } from '../../core/resource/interaction.js'
import { asRecord } from '../../core/event/json-record.js'
import { terminalElicitationForm } from './terminal-elicitation.js'

type InteractionEvent = Extract<AgentEvent, { type: 'permission.requested' | 'permission.resolved' }>
interface PendingInteraction {
  readonly request: InteractionRequest
  cancelled?: InteractionResolution
  resolved: boolean
}

/** A hook disconnect closes a mirror, not necessarily the native dialog. */
export class TerminalInteractions {
  private readonly requests = new Map<string, PendingInteraction>()
  private readonly tools = new Map<string, Extract<AgentEvent, { type: 'tool.started' }>>()
  private readonly results = new Map<string, AgentEvent>()

  constructor(private readonly emit: (event: InteractionEvent) => void,
    private readonly retireMirror?: (event: Extract<InteractionEvent, { type: 'permission.resolved' }>) => void) {}

  toolId(question: TerminalQuestion): string | undefined {
    if (question.toolUseId) return question.toolUseId
    // PermissionRequest does not always include tool_use_id. PreToolUse runs
    // first; use its exact input and agent, and never guess an ambiguous match.
    const claimed = new Set([...this.requests.values()].map(({ request }) => request.toolUseId))
    const matches = [...this.tools.values()].filter((tool) => tool.name === (question.tool ?? 'AskUserQuestion')
      && tool.agentId === question.agentId && !claimed.has(tool.id) && isDeepStrictEqual(tool.input, question.input))
    return matches.length === 1 ? matches[0]?.id : undefined
  }

  mirror(event: InteractionEvent): void {
    if (event.type === 'permission.requested') {
      if (this.requests.has(event.request.requestId)) return
      this.requests.set(event.request.requestId, { request: event.request, resolved: false })
      this.emit(event)
      const result = event.request.toolUseId ? this.results.get(event.request.toolUseId) : undefined
      if (result) this.native(result, 'hook')
      return
    }
    const pending = this.requests.get(event.resolution.request.requestId)
    if (!pending || pending.resolved) return
    if (event.resolution.reason === 'cancelled') {
      pending.cancelled = event.resolution
      // The closed hook can no longer accept Web UI responses. Retire its
      // card immediately, while keeping the audit pending for native evidence.
      this.retireMirror?.(event)
    } else this.resolve(pending, event.resolution)
  }

  native(event: AgentEvent, source: 'hook' | 'transcript'): InteractionResolution | undefined {
    if (source === 'hook' && event.type === 'ext' && event.vendor === 'claude' && event.name === 'elicitation.result') return this.elicitation(event.data)
    if (event.type === 'tool.started' && source === 'hook') {
      this.tools.set(event.id, event)
      return
    }
    const id = event.type === 'permission.resolved' ? event.resolution.request.toolUseId
      : event.type === 'tool.completed' && source === 'hook' ? event.id : undefined
    if (!id) return
    const pending = [...this.requests.values()].find(({ request, resolved }) => !resolved && request.toolUseId === id)
    if (!pending && !this.tools.has(id)) return
    if (event.type === 'permission.resolved' || !this.results.has(id)) this.results.set(id, event)
    if (!pending) return
    if (event.type === 'permission.resolved') {
      const resolution = { ...event.resolution, request: pending.request }
      this.resolve(pending, resolution)
      return resolution
    } else if (event.type === 'tool.completed' && pending.request.kind === 'tool') {
      // PostToolUseFailure also proves execution was approved. An execution
      // error must not be audited as a user denial.
      this.resolve(pending, { request: pending.request, decision: 'allow', reason: 'answered' })
    }
  }

  finish(): void {
    for (const pending of this.requests.values()) {
      if (!pending.resolved) this.resolve(pending, pending.cancelled ?? { request: pending.request, decision: 'deny', reason: 'cancelled' })
    }
  }

  private elicitation(raw: unknown): InteractionResolution | undefined {
    const result = asRecord(raw)
    if (!result || !['accept', 'decline', 'cancel'].includes(String(result['action']))) return
    const matches = [...this.requests.values()].filter(({ request, resolved }) => !resolved && request.kind === 'question'
      && request.tool === `mcp__${String(result['serverName'])}__elicitation`
      && asRecord(request.input)?.['elicitationId'] === result['elicitationId'])
    const pending = matches[0]
    if (matches.length !== 1 || !pending) return
    const accepted = result['action'] === 'accept'
    const schema = asRecord(asRecord(pending.request.input)?.['schema'])
    const form = schema ? terminalElicitationForm(schema) : undefined
    const content = asRecord(result['content'])
    if (accepted && (!form || !content)) return
    const resolution: InteractionResolution = { request: pending.request, decision: accepted ? 'allow' : 'deny',
      reason: accepted ? 'answered' : result['action'] === 'decline' ? 'skipped' : 'cancelled',
      ...(accepted && form && content ? { answers: form.answers(content) } : {}) }
    this.resolve(pending, resolution)
    return resolution
  }

  private resolve(pending: PendingInteraction, resolution: InteractionResolution): void {
    pending.resolved = true
    this.emit({ type: 'permission.resolved', resolution })
  }
}

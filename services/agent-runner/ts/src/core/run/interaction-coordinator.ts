import { randomUUID } from 'node:crypto'
import type { AgentEvent } from '../event/agent-event.js'
import type { InteractionRequest, InteractionResolution, InteractionResponse } from '../resource/interaction.js'

type RequestInput = InteractionRequest extends infer R ? R extends InteractionRequest ? Omit<R, 'requestId' | 'expiresAt'> : never : never
interface Pending { request: InteractionRequest; finish: (result: InteractionResolution) => void }

/** The suspended provider call owns the request; sockets only observe and answer it. */
export class InteractionCoordinator {
  private readonly pending = new Map<string, Pending>()
  private readonly settled = new Map<string, InteractionResolution>()

  constructor(private readonly emit: (event: AgentEvent) => void, private readonly timeoutMs = 600_000) {}

  request(input: RequestInput, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<InteractionResolution> {
    const timeout = Math.min(options.timeoutMs ?? this.timeoutMs, this.timeoutMs)
    const request = { ...input, requestId: randomUUID(), expiresAt: Date.now() + timeout } as InteractionRequest
    if (options.signal?.aborted) return Promise.resolve({ request, decision: 'deny', reason: 'cancelled' })
    return new Promise((resolve) => {
      const cancel = () => finish({ request, decision: 'deny', reason: 'cancelled' })
      const timer = setTimeout(() => finish({ request, decision: 'deny', reason: 'timeout' }), timeout)
      timer.unref()
      const finish = (result: InteractionResolution) => {
        if (!this.pending.delete(request.requestId)) return
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', cancel)
        this.settled.set(request.requestId, result)
        if (this.settled.size > 256) {
          const oldest = this.settled.keys().next().value
          if (oldest) this.settled.delete(oldest)
        }
        this.emit({ type: 'permission.resolved', resolution: result })
        resolve(result)
      }
      this.pending.set(request.requestId, { request, finish })
      options.signal?.addEventListener('abort', cancel, { once: true })
      this.emit({ type: 'permission.requested', request })
    })
  }

  respond(response: InteractionResponse): InteractionResolution {
    const settled = this.settled.get(response.requestId)
    if (settled) { this.emit({ type: 'permission.resolved', resolution: settled }); return settled }
    const pending = this.pending.get(response.requestId)
    if (!pending) throw new Error('This interaction is no longer pending')
    const { request } = pending
    if (response.decision === 'allow' && request.kind === 'question') {
      const answers = response.answers ?? {}
      if (Object.keys(answers).length !== request.questions.length) throw new Error('Answer every question before submitting')
      for (const question of request.questions) {
        const answer = answers[question.id]
        if (!answer || (!answer.selected.length && !answer.text.trim())) throw new Error('Answer every question before submitting')
        if (new Set(answer.selected).size !== answer.selected.length || answer.selected.some((label) => !question.options.some((option) => option.label === label))) throw new Error('Answer contains an unknown or duplicate option')
        if (question.allowCustom === false && answer.text.trim()) throw new Error('Choose one of the available options')
        if (!question.multiSelect && answer.selected.length + Number(Boolean(answer.text.trim())) > 1) throw new Error('Choose one answer for a single-choice question')
      }
    } else if (response.decision === 'allow' && response.answers !== undefined) throw new Error('Tool approval cannot change the tool input')
    const resolution: InteractionResolution = {
      request, decision: response.decision, reason: response.decision === 'allow' ? 'answered' : 'skipped',
      ...(response.decision === 'allow' && response.answers ? { answers: response.answers } : {}),
    }
    pending.finish(resolution)
    return resolution
  }

  cancelAll(): void {
    for (const { request, finish } of [...this.pending.values()]) finish({ request, decision: 'deny', reason: 'cancelled' })
  }
}

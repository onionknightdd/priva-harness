import { defineTool, ExtensionEditorComponent, type ExtensionUIContext, type ExtensionUIDialogOptions } from '@earendil-works/pi-coding-agent'
import { z } from 'zod'
import type { AgentEvent } from '../../core/event/agent-event.js'
import { InteractionCoordinator } from '../../core/run/interaction-coordinator.js'
import { answersByQuestion, normalizeQuestions, questionsSchema, type InteractionRequest, type InteractionResponse } from '../../core/resource/interaction.js'

/** Pi's RPC surface delegates native extension dialogs to the same WebUI inbox. */
export class PiInteractions {
  private readonly listeners = new Set<(event: AgentEvent) => void>()
  private nativeUi: ExtensionUIContext | undefined
  private readonly originalUis = new WeakMap<ExtensionUIContext, ExtensionUIContext>()
  private readonly terminalUis = new WeakMap<ExtensionUIContext, ExtensionUIContext>()
  private readonly rpcUis = new WeakMap<ExtensionUIContext, ExtensionUIContext>()
  private readonly nativeDialogs = new Map<string, AbortController>()
  private nativeQueue: Promise<void> = Promise.resolve()
  private readonly coordinator = new InteractionCoordinator((event) => {
    for (const listener of this.listeners) listener(event)
    if (event.type === 'permission.requested' && this.nativeUi) {
      const request = event.request
      const nativeUi = this.nativeUi
      const abort = new AbortController()
      this.nativeDialogs.set(request.requestId, abort)
      this.nativeQueue = this.nativeQueue.then(async () => {
        if (abort.signal.aborted) return
        try {
          const response = await answerInTerminal(nativeUi, request, abort.signal)
          if (this.nativeDialogs.has(request.requestId)) this.coordinator.respond(response)
        } catch (error) {
          if (this.nativeDialogs.has(request.requestId)) {
            for (const listener of this.listeners) listener({ type: 'error', message: `Pi terminal interaction failed: ${String(error)}` })
          }
        }
      })
    }
    if (event.type === 'permission.resolved') {
      const id = event.resolution.request.requestId
      this.nativeDialogs.get(id)?.abort()
      this.nativeDialogs.delete(id)
    }
  })
  readonly tool = defineTool({
    name: 'ask_user_question',
    label: 'Ask user',
    description: 'Ask the user one or more questions and wait for their answers. Supports single choice, multiple choices and free text. Use this to clarify requirements or obtain a decision before continuing. A skipped request must not be interpreted as agreement.',
    parameters: z.toJSONSchema(z.object({ questions: questionsSchema })),
    exposure: 'model-only',
    execute: async (toolUseId, params, signal) => {
      const parsed = z.object({ questions: questionsSchema }).parse(params)
      const result = await this.coordinator.request({
        kind: 'question', tool: 'ask_user_question', toolUseId, input: parsed,
        questions: normalizeQuestions(parsed.questions),
      }, signal ? { signal } : {})
      if (result.decision === 'deny') throw new Error(`User interaction ${result.reason}. Continue without an answer; this is not agreement.`)
      const answers = answersByQuestion(result)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ answers }) }],
        details: { questions: parsed.questions, answers, decision: result.decision },
      }
    },
  })

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  respond(response: InteractionResponse): void { this.coordinator.respond(response) }
  cancel(): void { this.coordinator.cancelAll() }

  ui(base: ExtensionUIContext, terminal = false): ExtensionUIContext {
    base = this.originalUis.get(base) ?? base
    if (terminal) this.nativeUi = base
    const cache = terminal ? this.terminalUis : this.rpcUis
    const cached = cache.get(base)
    if (cached) return cached
    const ask = async (title: string, options: string[], opts?: ExtensionUIDialogOptions, prefill?: string) => {
      const result = await this.coordinator.request({
        kind: 'question', tool: 'Pi extension',
        questions: normalizeQuestions([{ question: title, options: options.map((label) => ({ label })) }]).map((question) => ({ ...question, allowCustom: options.length === 0, ...(prefill === undefined ? {} : { initialText: prefill, multiline: true }) })),
      }, this.dialogOptions(opts))
      if (result.decision === 'deny') return undefined
      const answer = result.answers?.['q0']
      return options.length ? answer?.selected[0] : answer?.text
    }
    const wrapped: ExtensionUIContext = {
      ...base,
      select: (title, options, opts) => ask(title, options, opts),
      input: (title, _placeholder, opts) => ask(title, [], opts),
      editor: (title, prefill) => ask(title, [], undefined, prefill ?? ''),
      confirm: async (title, reason, opts) => {
        const result = await this.coordinator.request({ kind: 'tool', tool: 'Pi extension', title, reason }, this.dialogOptions(opts))
        return result.decision === 'allow'
      },
      custom: terminal ? (...args) => {
        for (const listener of this.listeners) listener({ type: 'terminal.focus', reason: 'Continue this Pi dialog in Terminal' })
        return base.custom(...args)
      } : () => Promise.reject(new Error('This Pi extension requires a terminal UI. Use ui.select, ui.input, ui.confirm or ask_user_question in WebUI.')),
    }
    this.originalUis.set(wrapped, base)
    cache.set(base, wrapped)
    return wrapped
  }

  private dialogOptions(opts?: ExtensionUIDialogOptions): { signal?: AbortSignal; timeoutMs?: number } {
    return { ...(opts?.signal ? { signal: opts.signal } : {}), ...(opts?.timeout === undefined ? {} : { timeoutMs: opts.timeout }) }
  }
}

async function answerInTerminal(ui: ExtensionUIContext, request: InteractionRequest, signal: AbortSignal): Promise<InteractionResponse> {
  if (request.kind === 'tool') {
    const allow = await ui.confirm(request.title ?? request.tool, request.reason ?? 'Allow this action?', { signal })
    return { requestId: request.requestId, decision: allow ? 'allow' : 'deny' }
  }
  const answers: Record<string, { selected: string[]; text: string }> = {}
  for (const question of request.questions) {
    if (signal.aborted) return { requestId: request.requestId, decision: 'deny' }
    const selected: string[] = []
    let text = ''
    if (question.options.length) {
      const custom = 'Write an answer…'
      const done = 'Submit selected answers'
      for (;;) {
        const labels = question.options.map((option) => `${selected.includes(option.label) ? '✓ ' : ''}${option.label}`)
        const choice = await ui.select(question.question, [...labels, ...(question.allowCustom === false ? [] : [custom]), ...(question.multiSelect ? [done] : [])], { signal })
        if (choice === undefined) return { requestId: request.requestId, decision: 'deny' }
        if (choice === done) { if (selected.length) break; continue }
        if (choice === custom) {
          const value = await ui.input(question.question, undefined, { signal })
          if (value === undefined) return { requestId: request.requestId, decision: 'deny' }
          if (!value.trim()) continue
          text = value
          break
        }
        const option = question.options[labels.indexOf(choice)]
        if (!option) continue
        const index = selected.indexOf(option.label)
        if (index >= 0) selected.splice(index, 1)
        else selected.push(option.label)
        if (!question.multiSelect) break
      }
    } else {
      do {
        const value = question.multiline
          ? await terminalEditor(ui, question.question, question.initialText, signal)
          : await ui.input(question.question, undefined, { signal })
        if (value === undefined) return { requestId: request.requestId, decision: 'deny' }
        text = value
      } while (!text.trim())
    }
    answers[question.id] = { selected, text }
  }
  return { requestId: request.requestId, decision: 'allow', answers }
}

/** Native editor() has no cancellation signal; the public component/custom API does. */
function terminalEditor(ui: ExtensionUIContext, title: string, prefill: string | undefined, signal: AbortSignal): Promise<string | undefined> {
  return ui.custom<string | undefined>((tui, _theme, keybindings, done) => {
    let settled = false
    const finish = (value: string | undefined) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', cancel)
      done(value)
    }
    const cancel = () => finish(undefined)
    const component = new ExtensionEditorComponent(tui, keybindings, title, prefill, finish, cancel)
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    return Object.assign(component, { dispose: () => { signal.removeEventListener('abort', cancel) } })
  })
}

import { defineTool, type ExtensionUIContext, type ExtensionUIDialogOptions } from '@earendil-works/pi-coding-agent'
import { z } from 'zod'
import type { AgentEvent } from '../../core/event/agent-event.js'
import { InteractionCoordinator } from '../../core/run/interaction-coordinator.js'
import { answersByQuestion, normalizeQuestions, questionsSchema, type InteractionResponse } from '../../core/resource/interaction.js'

/** Pi's RPC surface delegates native extension dialogs to the same WebUI inbox. */
export class PiInteractions {
  private readonly listeners = new Set<(event: AgentEvent) => void>()
  private readonly coordinator = new InteractionCoordinator((event) => {
    for (const listener of this.listeners) listener(event)
  })
  readonly tool = defineTool({
    name: 'ask_user_question',
    label: 'Ask user',
    description: 'Ask the user one or more questions and wait for their answers. Supports single choice, multiple choices and free text. Use this to clarify requirements or obtain a decision before continuing. A skipped request must not be interpreted as agreement.',
    parameters: z.toJSONSchema(z.object({ questions: questionsSchema })),
    execute: async (toolUseId, params, signal) => {
      const parsed = z.object({ questions: questionsSchema }).parse(params)
      const result = await this.coordinator.request({
        kind: 'question', tool: 'ask_user_question', toolUseId, input: parsed,
        questions: normalizeQuestions(parsed.questions),
      }, signal ? { signal } : {})
      // Pi derives the native tool-result isError flag from a thrown error;
      // returning an extra isError property would be silently ignored.
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

  ui(base: ExtensionUIContext): ExtensionUIContext {
    const ask = async (title: string, options: string[], opts?: ExtensionUIDialogOptions, prefill?: string) => {
      const result = await this.coordinator.request({
        kind: 'question', tool: 'Pi extension',
        questions: normalizeQuestions([{ question: title, options: options.map((label) => ({ label })) }]).map((question) => ({ ...question, allowCustom: options.length === 0, ...(prefill === undefined ? {} : { initialText: prefill, multiline: true }) })),
      }, this.dialogOptions(opts))
      if (result.decision === 'deny') return undefined
      const answer = result.answers?.['q0']
      return options.length ? answer?.selected[0] : answer?.text
    }
    return {
      ...base,
      select: (title, options, opts) => ask(title, options, opts),
      input: (title, _placeholder, opts) => ask(title, [], opts),
      editor: (title, prefill) => ask(title, [], undefined, prefill ?? ''),
      confirm: async (title, reason, opts) => {
        const result = await this.coordinator.request({ kind: 'tool', tool: 'Pi extension', title, reason }, this.dialogOptions(opts))
        return result.decision === 'allow'
      },
      custom: () => Promise.reject(new Error('This Pi extension requires a terminal UI. Use ui.select, ui.input, ui.confirm or ask_user_question in WebUI.')),
    }
  }

  private dialogOptions(opts?: ExtensionUIDialogOptions): { signal?: AbortSignal; timeoutMs?: number } {
    return { ...(opts?.signal ? { signal: opts.signal } : {}), ...(opts?.timeout === undefined ? {} : { timeoutMs: opts.timeout }) }
  }
}

import { z } from 'zod'

const nonBlankText = z.string().min(1).refine((value) => value.trim().length > 0, 'Text must not be blank')

export const questionSchema = z.object({
  question: nonBlankText,
  header: z.string().optional(),
  options: z.array(z.object({ label: nonBlankText, description: z.string().optional() })).default([]),
  multiSelect: z.boolean().default(false),
})

export const questionsSchema = z.array(questionSchema).min(1).max(12)
export type InteractionQuestion = z.infer<typeof questionSchema> & { readonly id: string; readonly allowCustom?: boolean; readonly initialText?: string; readonly multiline?: boolean }
export interface QuestionAnswer { readonly selected: readonly string[]; readonly text: string }

interface RequestBase {
  readonly requestId: string
  readonly tool: string
  readonly toolUseId?: string
  readonly input?: unknown
  readonly title?: string
  readonly reason?: string
  readonly expiresAt: number
}

export type InteractionRequest = RequestBase & (
  | { readonly kind: 'tool' }
  | { readonly kind: 'question'; readonly questions: readonly InteractionQuestion[] }
)

export const interactionResponseSchema = z.discriminatedUnion('decision', [
  z.object({ requestId: z.string().min(1), decision: z.literal('allow'), answers: z.record(z.string(), z.object({ selected: z.array(z.string()), text: z.string() })).optional() }),
  z.object({ requestId: z.string().min(1), decision: z.literal('deny') }),
])
export type InteractionResponse = z.infer<typeof interactionResponseSchema>
export interface InteractionResolution {
  readonly request: InteractionRequest
  readonly decision: 'allow' | 'deny'
  readonly reason: 'answered' | 'skipped' | 'timeout' | 'cancelled'
  readonly answers?: Readonly<Record<string, QuestionAnswer>>
}

export function normalizeQuestions(raw: unknown): InteractionQuestion[] {
  const questions = questionsSchema.parse(raw)
  const texts = new Set<string>()
  return questions.map((question, index) => {
    if (texts.has(question.question)) throw new Error('Question text must be unique')
    texts.add(question.question)
    if (new Set(question.options.map((option) => option.label)).size !== question.options.length) throw new Error('Question option labels must be unique')
    return { ...question, id: `q${index}` }
  })
}

export function answerText(answer: QuestionAnswer): string {
  return [...answer.selected, ...(answer.text.trim() ? [answer.text.trim()] : [])].join(', ')
}

export function answersByQuestion(resolution: InteractionResolution): Record<string, string> {
  if (resolution.request.kind !== 'question' || resolution.decision !== 'allow') return {}
  return Object.fromEntries(resolution.request.questions.map((question) => {
    const answer = resolution.answers?.[question.id]
    if (!answer) throw new Error('Resolved question is missing its answer')
    return [question.question, answerText(answer)]
  }))
}

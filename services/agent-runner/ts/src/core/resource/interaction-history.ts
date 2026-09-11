import { asRecord } from '../event/json-record.js'
import { questionsSchema, type InteractionResolution, type QuestionAnswer } from './interaction.js'

/** Native tool metadata keeps answers by question text, without the live request ID. */
export function questionResolutionFromToolResult(
  toolUseId: string,
  tool: string,
  raw: unknown,
  denied: boolean,
): InteractionResolution | undefined {
  if (!['askuserquestion', 'ask_user_question'].includes(tool.toLowerCase())) return undefined
  const record = asRecord(raw)
  const parsed = questionsSchema.safeParse(record?.['questions'])
  if (!parsed.success) return undefined
  const questions = parsed.data.map((question, index) => ({ ...question, id: `q${index}` }))
  const nativeAnswers = asRecord(record?.['answers'])
  const answers: Record<string, QuestionAnswer> = {}
  if (!denied) {
    for (const question of questions) {
      const text = nativeAnswers?.[question.question]
      if (typeof text !== 'string') return undefined
      // Do not split native text: option labels and custom answers can contain commas.
      answers[question.id] = { selected: [], text }
    }
  }
  return {
    request: { kind: 'question', requestId: `history:${toolUseId}`, toolUseId, tool, questions, expiresAt: 0 },
    decision: denied ? 'deny' : 'allow',
    reason: denied ? 'skipped' : 'answered',
    ...(denied ? {} : { answers }),
  }
}

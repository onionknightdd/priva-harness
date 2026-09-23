import { z } from 'zod'
import { asRecord, stringField } from '../../core/event/json-record.js'
import type { InteractionQuestion, QuestionAnswer } from '../../core/resource/interaction.js'

/** Reuse the existing question UI for MCP's primitive form fields. */
export function terminalElicitationForm(schema: Record<string, unknown>) {
  const properties = asRecord(schema['properties'])
  if (schema['type'] !== 'object' || !properties || Object.keys(properties).length === 0 || Object.keys(properties).length > 12) return undefined
  const required = new Set(Array.isArray(schema['required']) ? schema['required'] : [])
  const fields = Object.entries(properties).map(([key, value]) => ({ key, field: asRecord(value) ?? {} }))
  if (fields.some(({ field }) => !['string', 'number', 'integer', 'boolean'].includes(String(field['type'])))) return undefined
  const validator = z.fromJSONSchema(schema)
  const questions: InteractionQuestion[] = fields.map(({ key, field }, index) => {
    const choices = field['type'] === 'boolean' ? ['true', 'false'] : Array.isArray(field['enum']) ? field['enum'].map(String) : []
    let omit = 'Omit this field'
    while (choices.includes(omit)) omit += ' (optional)'
    const description = stringField(field, 'description')
    const initial = field['default']
    return { id: `q${index}`, question: `${stringField(field, 'title') ?? key}${description ? ` — ${description}` : ''}`,
      multiSelect: false, allowCustom: choices.length === 0,
      options: [...choices.map((label) => ({ label })), ...(!required.has(key) ? [{ label: omit }] : [])],
      ...(choices.length || (typeof initial !== 'string' && typeof initial !== 'number' && typeof initial !== 'boolean') ? {} : { initialText: String(initial) }) }
  })
  const content = (response: { decision: 'allow' | 'deny'; answers?: Readonly<Record<string, QuestionAnswer>> | undefined }): Record<string, unknown> => {
    if (response.decision !== 'allow') return {}
    const values = Object.fromEntries(fields.flatMap(({ key, field }, index) => {
      const answer = response.answers?.[`q${index}`]
      if (!answer) throw new Error(`Missing answer for ${key}`)
      const raw = answer.selected[0] ?? answer.text
      if (!required.has(key) && answer.selected[0] === questions[index]?.options.at(-1)?.label) return []
      if (['number', 'integer'].includes(String(field['type'])) && !raw.trim()) throw new Error(`Enter a number for ${key}`)
      const value = field['type'] === 'boolean' ? raw === 'true' : ['number', 'integer'].includes(String(field['type'])) ? Number(raw) : raw
      return [[key, value]]
    }))
    const parsed = validator.safeParse(values)
    if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '))
    return values
  }
  const answers = (values: Record<string, unknown>): Record<string, QuestionAnswer> => {
    validator.parse(values)
    return Object.fromEntries(fields.map(({ key }, index) => {
      const question = questions[index]
      if (!question) throw new Error(`Missing question for ${key}`)
      const value = values[key]
      if (value !== undefined && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') throw new Error(`Invalid answer for ${key}`)
      const label = value === undefined ? question.options.at(-1)?.label ?? '' : String(value)
      return [question.id, question.options.some((option) => option.label === label)
        ? { selected: [label], text: '' } : { selected: [], text: label }]
    }))
  }
  return { questions, content, answers }
}

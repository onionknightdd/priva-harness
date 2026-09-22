import { describe, expect, it } from 'vitest'
import { terminalElicitationForm } from '../../../../src/harness/terminal/terminal-elicitation.js'
import { InteractionCoordinator } from '../../../../src/core/run/interaction-coordinator.js'
import type { AgentEvent } from '../../../../src/core/event/agent-event.js'

describe('native MCP elicitation', () => {
  it('validates typed answers before settling a form, so a rejected answer can be corrected', async () => {
    const form = terminalElicitationForm({ type: 'object', required: ['count', 'enabled'], properties: {
      count: { type: 'integer', minimum: 1 }, enabled: { type: 'boolean' }, label: { type: 'string' },
    } })
    if (!form) throw new Error('Form was not created')
    const events: AgentEvent[] = []
    const coordinator = new InteractionCoordinator((event) => events.push(event))
    const pending = coordinator.request({ kind: 'question', tool: 'mcp', questions: form.questions }, { validate: (response) => { form.content(response) } })
    const frame = events[0]
    if (frame?.type !== 'permission.requested') throw new Error('Form was not requested')
    const response = { requestId: frame.request.requestId, decision: 'allow' as const, answers: {
      q0: { selected: [], text: '0' }, q1: { selected: ['false'], text: '' }, q2: { selected: ['Omit this field'], text: '' },
    } }
    expect(() => coordinator.respond(response)).toThrow('count')
    expect(events).toHaveLength(1)
    response.answers.q0.text = '2'
    coordinator.respond(response)
    expect(form.content(await pending)).toEqual({ count: 2, enabled: false })
  })

  it('does not confuse a literal option with omission, or prefill forbidden custom text', () => {
    const form = terminalElicitationForm({ type: 'object', properties: {
      mode: { type: 'string', enum: ['Omit this field', 'ready'], default: 'ready' },
    } })
    expect(form?.questions[0]?.initialText).toBeUndefined()
    expect(form?.content({ decision: 'allow', answers: { q0: { selected: ['Omit this field'], text: '' } } })).toEqual({ mode: 'Omit this field' })
    expect(form?.content({ decision: 'allow', answers: { q0: { selected: ['Omit this field (optional)'], text: '' } } })).toEqual({})
  })

  it('leaves complex forms to the native dialog', () => {
    expect(terminalElicitationForm({ type: 'object', properties: { object: { type: 'object' } } })).toBeUndefined()
  })
})

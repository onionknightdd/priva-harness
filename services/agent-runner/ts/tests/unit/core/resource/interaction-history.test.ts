import { describe, expect, it } from 'vitest'
import { questionResolutionFromToolResult } from '../../../../src/core/resource/interaction-history.js'

const questions = [
  { question: 'Which region?', options: [{ label: 'Asia, Pacific' }], multiSelect: true },
  { question: 'Anything else?', options: [], multiSelect: false },
]

describe('questionResolutionFromToolResult', () => {
  it('restores native answers by question text without losing commas, quotes, or whitespace', () => {
    const resolution = questionResolutionFromToolResult('ask-1', 'AskUserQuestion', {
      questions,
      answers: { 'Which region?': 'Asia, Pacific', 'Anything else?': '  Keep "quotes"\nand newlines\n' },
    }, false)
    expect(resolution).toMatchObject({
      request: { requestId: 'history:ask-1', toolUseId: 'ask-1', kind: 'question', questions: [{ id: 'q0' }, { id: 'q1' }] },
      decision: 'allow', reason: 'answered',
      answers: { q0: { selected: [], text: 'Asia, Pacific' }, q1: { selected: [], text: '  Keep "quotes"\nand newlines\n' } },
    })
  })

  it('preserves explicit skipped results without fabricating answers', () => {
    const result = questionResolutionFromToolResult('ask-1', 'ask_user_question', { questions }, true)
    expect(result).toMatchObject({ decision: 'deny', reason: 'skipped' })
    expect(result?.answers).toBeUndefined()
  })

  it('does not turn missing or malformed native answers into an answered question', () => {
    expect(questionResolutionFromToolResult('ask-1', 'AskUserQuestion', { questions, answers: {} }, false)).toBeUndefined()
    expect(questionResolutionFromToolResult('ask-1', 'AskUserQuestion', { questions: 'not questions' }, false)).toBeUndefined()
    expect(questionResolutionFromToolResult('ask-1', 'Bash', { questions }, true)).toBeUndefined()
  })
})

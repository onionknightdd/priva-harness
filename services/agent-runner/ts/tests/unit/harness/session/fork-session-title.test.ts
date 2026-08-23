import { describe, expect, it } from 'vitest'

import { nextForkTitle, sessionStem } from '../../../../src/harness/session/fork-session-title.js'

describe('nextForkTitle', () => {
  it('starts at (1) and increments siblings of the current stem', () => {
    expect(nextForkTitle('设计 API', [])).toBe('设计 API (1)')
    expect(nextForkTitle('设计 API', ['设计 API', '设计 API (1)', 'other (9)'])).toBe(
      '设计 API (2)',
    )
  })

  it('nests numbering when the stem is already a fork title', () => {
    expect(nextForkTitle('设计 API (1)', ['设计 API', '设计 API (1)', '设计 API (2)'])).toBe(
      '设计 API (1) (1)',
    )
    expect(nextForkTitle('设计 API (1)', ['设计 API (1) (1)'])).toBe('设计 API (1) (2)')
  })
})

describe('sessionStem', () => {
  it('prefers custom title, then summary, then first prompt', () => {
    expect(sessionStem({
      customTitle: ' Named ',
      summary: 'sum',
      firstPrompt: 'prompt',
      sessionId: 'id',
    })).toBe('Named')
    expect(sessionStem({
      customTitle: null,
      summary: '',
      firstPrompt: 'prompt',
      sessionId: 'id',
    })).toBe('prompt')
  })
})

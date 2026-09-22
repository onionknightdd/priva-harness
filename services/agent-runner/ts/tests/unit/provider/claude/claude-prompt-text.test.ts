import { describe, expect, it } from 'vitest'

import { claudePromptText } from '../../../../src/provider/claude/claude-prompt-text.js'

const paste = (body: string, id = '6985') => `\n\n<pasted_content id="${id}">\n${body}\n</pasted_content id="${id}">\n`

describe('claudePromptText', () => {
  it('removes only complete native paste envelopes, retaining Unicode and body formatting', () => {
    const body = '后台启动一个子agent , 每秒echo 1, 执行30s\n  第二行 👋\n\n<example>literal XML</example>'
    expect(claudePromptText(paste(body))).toBe(body)
    expect(claudePromptText(paste(''))).toBe('')
    expect(claudePromptText(paste('\n  keep whitespace\n'))).toBe('\n  keep whitespace\n')
  })

  it('joins multiple pasted spans to the surrounding typed text in order', () => {
    expect(claudePromptText(`Compare ${paste('first', 'ab12')} and ${paste('second', 'cdef')} please`))
      .toBe('Compare first and second please')
  })

  it.each([
    '<example>literal XML</example>',
    '<pasted_content>unmarked text</pasted_content>',
    '<pasted_content id="12345">\nwrong id\n</pasted_content id="12345">',
    '<pasted_content id="1234">\nwrong closing id\n</pasted_content id="5678">',
    '<pasted_content id="1234">\nunclosed',
    '<pasted_content id="1234">inline content</pasted_content id="1234">',
  ])('preserves literal XML and malformed envelopes: %s', (text) => {
    expect(claudePromptText(text)).toBe(text)
  })

  it('does not recursively strip a native-looking example inside a pasted block', () => {
    const example = paste('example', 'abcd')
    expect(claudePromptText(paste(example))).toBe(example)
  })
})

import { describe, expect, it, vi } from 'vitest'

import type { TerminalInput } from '../../../../src/core/contract/terminal-service.js'
import { claudeComposer, submitClaudeTerminalInput } from '../../../../src/provider/claude/claude-terminal-input.js'

const screen = (draft = '') => `Claude Code\n\n❯ old transcript prompt\nreply\n────────────────────\n❯ ${draft}\n────────────────────\n bypass permissions on`

describe('Claude terminal input', () => {
  it('recognizes the framed live composer, excluding scrollback, shell mode and history search', () => {
    expect(claudeComposer(screen())).toBe('')
    expect(claudeComposer(screen('你好'))).toBe('你好')
    expect(claudeComposer('❯ echoed prompt\nreply')).toBeUndefined()
    expect(claudeComposer(screen().replace('❯ \n─', '! \n─'))).toBeUndefined()
    expect(claudeComposer(`${screen()}\nctrl+r to search`)).toBeUndefined()
  })

  it('waits through cold boot and paste commit before submitting multiline text', async () => {
    const capture = vi.fn().mockResolvedValueOnce('Starting Claude…').mockResolvedValueOnce(screen('cancelled old draft'))
      .mockResolvedValueOnce(screen()).mockResolvedValue(screen('新消息'))
    const input = { capture, isAlive: vi.fn().mockResolvedValue(true), paste: vi.fn().mockResolvedValue(undefined), sendKeys: vi.fn().mockResolvedValue(undefined) } satisfies TerminalInput
    await submitClaudeTerminalInput(input, '新消息\n第二行', new AbortController().signal)
    expect(input.paste).toHaveBeenCalledWith('新消息\n第二行')
    expect(input.sendKeys.mock.calls).toEqual([[['C-s']], [['Enter']]])
    expect(capture.mock.calls).toHaveLength(4)
  })

  it('never pastes into a dead or cancelled startup', async () => {
    const input = { capture: vi.fn(), isAlive: vi.fn().mockResolvedValue(false), paste: vi.fn(), sendKeys: vi.fn() } satisfies TerminalInput
    await expect(submitClaudeTerminalInput(input, 'hello', new AbortController().signal)).rejects.toThrow('exited')
    input.isAlive.mockResolvedValue(true)
    const controller = new AbortController()
    controller.abort(new Error('Stopped before startup'))
    await expect(submitClaudeTerminalInput(input, 'hello', controller.signal)).rejects.toThrow('Stopped before startup')
    expect(input.paste).not.toHaveBeenCalled()
    expect(input.sendKeys).not.toHaveBeenCalled()
  })
})

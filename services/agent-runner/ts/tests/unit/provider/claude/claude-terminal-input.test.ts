import { describe, expect, it, vi } from 'vitest'

import type { TerminalInput } from '../../../../src/core/contract/terminal-service.js'
import { claudeComposer } from '../../../../src/provider/claude/claude-terminal-composer.js'
import { submitClaudeTerminalInput } from '../../../../src/provider/claude/claude-terminal-input.js'

const screen = (draft = '') => `Claude Code\n\n❯ old transcript prompt\nreply\n────────────────────\n❯ ${draft}\n────────────────────\n bypass permissions on`

describe('Claude terminal input', () => {
  it('recognizes the framed live composer, excluding scrollback, shell mode and history search', () => {
    expect(claudeComposer(screen())).toEqual({ text: '' })
    expect(claudeComposer(screen('你好'))).toEqual({ text: '你好' })
    expect(claudeComposer('❯ echoed prompt\nreply')).toBeUndefined()
    expect(claudeComposer(screen().replace('❯ \n─', '! \n─'))).toBeUndefined()
    expect(claudeComposer(`${screen()}\nctrl+r to search`)).toBeUndefined()
  })

  it('recognizes faint suggestions through colours, intensity resets, and multiline content', () => {
    expect(claudeComposer(screen('\u001b[2m检查子 agent 的输出\u001b[0m'))).toEqual({ text: '', suggestion: '检查子 agent 的输出' })
    expect(claudeComposer(screen('\u001b[2;38;2;0;22;2m下一条\n建议 👋\u001b[22m'))).toEqual({ text: '', suggestion: '下一条\n建议 👋' })
    expect(claudeComposer(screen('\u001b[38;5;2m真实草稿\u001b[0m'))).toEqual({ text: '真实草稿' })
    expect(claudeComposer(screen('\u001b[38;2;2;22;0m真实草稿\u001b[0m'))).toEqual({ text: '真实草稿' })
    expect(claudeComposer(screen('\u001b[2;38:2::2:22:0m建议\u001b[0m'))).toEqual({ text: '', suggestion: '建议' })
    expect(claudeComposer(screen('\u001b[2m\u001b[22m已接受的建议'))).toEqual({ text: '已接受的建议' })
    expect(claudeComposer(screen('真实草稿\u001b[2m 建议后缀\u001b[0m'))).toEqual({ text: '真实草稿' })
    expect(claudeComposer(screen('\u001b[2m建议\u001b[0m').replace(/─+\n bypass/u, 'dialog\n bypass'))).toBeUndefined()
  })

  it('ignores a ghost suggestion and waits for real pasted text before Enter', async () => {
    const capture = vi.fn().mockResolvedValueOnce(screen('\u001b[2m检查子 agent 的输出\u001b[0m'))
      .mockResolvedValueOnce(screen('\u001b[2m检查子 agent 的输出\u001b[0m')).mockResolvedValue(screen('新消息'))
    const input = { capture, isAlive: vi.fn().mockResolvedValue(true), paste: vi.fn().mockResolvedValue(undefined), sendKeys: vi.fn().mockResolvedValue(undefined) } satisfies TerminalInput
    await submitClaudeTerminalInput(input, '新消息', new AbortController().signal)
    expect(input.paste).toHaveBeenCalledWith('新消息')
    expect(input.sendKeys.mock.calls).toEqual([[['Enter']]])
    expect(capture).toHaveBeenCalledTimes(3)
  })

  it('stashes a real multiline draft even when an empty prompt then shows a suggestion', async () => {
    const capture = vi.fn().mockResolvedValueOnce(screen('保留第一行\n第二行'))
      .mockResolvedValueOnce(screen('\u001b[2m检查子 agent 的输出\u001b[0m')).mockResolvedValue(screen('新消息'))
    const input = { capture, isAlive: vi.fn().mockResolvedValue(true), paste: vi.fn().mockResolvedValue(undefined), sendKeys: vi.fn().mockResolvedValue(undefined) } satisfies TerminalInput
    await submitClaudeTerminalInput(input, '新消息', new AbortController().signal)
    expect(input.paste).toHaveBeenCalledWith('新消息')
    expect(input.sendKeys.mock.calls).toEqual([[['C-s']], [['Enter']]])
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

  it('submits when Claude collapses a multiline attachment paste into a pasted-text chip', async () => {
    const manifest = '看这个\n\n```AgentAttachments\n- name: note.txt\n  path: /tmp/note.txt\n```'
    const capture = vi.fn()
      .mockResolvedValueOnce(screen())
      .mockResolvedValue(screen('[Pasted text #1 +4 lines]'))
    const input = { capture, isAlive: vi.fn().mockResolvedValue(true), paste: vi.fn().mockResolvedValue(undefined), sendKeys: vi.fn().mockResolvedValue(undefined) } satisfies TerminalInput
    await submitClaudeTerminalInput(input, manifest, new AbortController().signal)
    expect(input.paste).toHaveBeenCalledWith(manifest)
    expect(input.sendKeys.mock.calls).toEqual([[['Enter']]])
  })

  it('pastes each image path and waits for the image chip before the message text', async () => {
    const capture = vi.fn()
      .mockResolvedValueOnce(screen())
      .mockResolvedValueOnce(screen('/tmp/board.png'))
      .mockResolvedValueOnce(screen('[Image #1]'))
      .mockResolvedValue(screen('[Image #1] 看这张图'))
    const input = { capture, isAlive: vi.fn().mockResolvedValue(true), paste: vi.fn().mockResolvedValue(undefined), sendKeys: vi.fn().mockResolvedValue(undefined) } satisfies TerminalInput
    await submitClaudeTerminalInput(input, '看这张图', new AbortController().signal, ['/tmp/board.png'])
    expect(input.paste.mock.calls).toEqual([['/tmp/board.png'], ['看这张图']])
    expect(input.sendKeys.mock.calls).toEqual([[['Enter']]])
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

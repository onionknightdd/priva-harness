import { describe, expect, it } from 'vitest'

import {
  decodeOctalEscapes,
  formatTmuxCommand,
  hexKeyTokens,
  LineSplitter,
  parseControlLine,
  quoteTmuxArgument,
} from '../../../../src/infrastructure/terminal/tmux-control-protocol.js'

describe('tmux control protocol', () => {
  it('parses reply brackets with their sequence number and origin flag', () => {
    expect(parseControlLine('%begin 1789959887 283 1')).toEqual({ kind: 'begin', seq: 283, fromClient: true })
    expect(parseControlLine('%end 1789959887 283 1')).toEqual({ kind: 'end', seq: 283, fromClient: true })
    expect(parseControlLine('%error 1789959887 284 1')).toEqual({ kind: 'error', seq: 284, fromClient: true })
    // The block tmux emits on attach was not requested by the client.
    expect(parseControlLine('%begin 1789959887 277 0')).toEqual({ kind: 'begin', seq: 277, fromClient: false })
  })

  it('decodes pane output including octal escapes and escaped backslashes', () => {
    const message = parseControlLine('%output %0 hi\\015\\012\\033[Kpath\\\\dir \\303\\251')
    expect(message.kind).toBe('output')
    if (message.kind !== 'output') return
    expect(message.paneId).toBe('%0')
    expect(Buffer.from(message.data).toString('utf8')).toBe('hi\r\n\u001b[Kpath\\dir é')
  })

  it('re-encodes UTF-8 characters tmux passes through unescaped', () => {
    // tmux only octal-escapes control bytes; `❯`, `⏵` and emoji arrive as text.
    const decoded = decodeOctalEscapes('❯ abc \\033[2m⏵⏵ · ←\\033[0m 🚀')
    expect(Buffer.from(decoded).toString('utf8')).toBe('❯ abc \u001b[2m⏵⏵ · ←\u001b[0m 🚀')
  })

  it('keeps a lone backslash that is not a valid escape', () => {
    expect(Buffer.from(decodeOctalEscapes('a\\9b')).toString('utf8')).toBe('a\\9b')
    expect(Buffer.from(decodeOctalEscapes('tail\\')).toString('utf8')).toBe('tail\\')
  })

  it('classifies exit, notifications and reply bodies', () => {
    expect(parseControlLine('%exit')).toEqual({ kind: 'exit', reason: '' })
    expect(parseControlLine('%exit server exited')).toEqual({ kind: 'exit', reason: 'server exited' })
    expect(parseControlLine('%layout-change @0 a67d,100x20,0,0,0')).toEqual({
      kind: 'notification', name: 'layout-change', body: '@0 a67d,100x20,0,0,0',
    })
    expect(parseControlLine('%session-changed')).toEqual({ kind: 'notification', name: 'session-changed', body: '' })
    expect(parseControlLine('bash-5.2$ ')).toEqual({ kind: 'body', text: 'bash-5.2$ ' })
  })

  it('treats %-prefixed command output inside a reply as body, not protocol', () => {
    expect(parseControlLine('%0', true)).toEqual({ kind: 'body', text: '%0' })
    expect(parseControlLine('%0 80x10', true)).toEqual({ kind: 'body', text: '%0 80x10' })
    expect(parseControlLine('%output %0 abc', true)).toMatchObject({ kind: 'output', paneId: '%0' })
    expect(parseControlLine('%end 1 2 1', true)).toEqual({ kind: 'end', seq: 2, fromClient: true })
  })

  it('encodes bytes as hex tokens for send-keys -H', () => {
    expect(hexKeyTokens(Uint8Array.from([0x1b, 0x5b, 0x41, 0x0a]))).toEqual(['1b', '5b', '41', '0a'])
  })

  it('quotes arguments the way tmux parses command lines', () => {
    expect(quoteTmuxArgument('%0')).toBe('%0')
    expect(quoteTmuxArgument('#{pane_id}')).toBe("'#{pane_id}'")
    expect(quoteTmuxArgument("it's")).toBe("'it'\\''s'")
    expect(quoteTmuxArgument('')).toBe("''")
    expect(formatTmuxCommand(['display-message', '-p', '#{cursor_x} #{cursor_y}']))
      .toBe("display-message -p '#{cursor_x} #{cursor_y}'")
  })

  it('splits streamed chunks into complete lines and flushes the remainder', () => {
    const splitter = new LineSplitter()
    expect(splitter.push('%begin 1 2 1\nbo')).toEqual(['%begin 1 2 1'])
    expect(splitter.push('dy\n%end 1 2 1\n')).toEqual(['body', '%end 1 2 1'])
    expect(splitter.push('%exit')).toEqual([])
    expect(splitter.flush()).toEqual(['%exit'])
    expect(splitter.flush()).toEqual([])
  })
})

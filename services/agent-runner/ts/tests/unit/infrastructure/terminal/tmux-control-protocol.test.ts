import { describe, expect, it } from 'vitest'

import {
  decodeOctalEscapes as decodeBytes,
  formatTmuxCommand,
  hexKeyTokens,
  LineSplitter,
  parseControlLine as parseBytes,
  quoteTmuxArgument,
  type ControlReply,
} from '../../../../src/infrastructure/terminal/tmux-control-protocol.js'
import { paneEnvironment } from '../../../../src/infrastructure/terminal/tmux-terminal-service.js'

const parseControlLine = (line: string, reply?: ControlReply) => parseBytes(Buffer.from(line), reply)
const decodeOctalEscapes = (line: string) => decodeBytes(Buffer.from(line))

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

  it('preserves UTF-8 bytes tmux passes through unescaped', () => {
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
    const reply = { seq: 2, fromClient: true }
    for (const line of ['%0', '%0 80x10', '%output %0 abc', '%exit', '%begin 1 9 1', '%end 1 9 1']) {
      expect(parseControlLine(line, reply)).toEqual({ kind: 'body', text: line })
    }
    expect(parseControlLine('%end 1 2 1', reply)).toEqual({ kind: 'end', seq: 2, fromClient: true })
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
    const push = (chunk: string) => splitter.push(Buffer.from(chunk)).map((line) => line.toString('utf8'))
    expect(push('%begin 1 2 1\nbo')).toEqual(['%begin 1 2 1'])
    expect(push('dy\n%end 1 2 1\n')).toEqual(['body', '%end 1 2 1'])
    expect(push('%exit')).toEqual([])
    expect(splitter.flush().map((line) => line.toString('utf8'))).toEqual(['%exit'])
    expect(splitter.flush()).toEqual([])
  })

  it('preserves multibyte characters split across protocol messages and stdout chunks', () => {
    const expected = Buffer.from('中文 🚀 ─')
    const wire = Buffer.concat(Array.from(expected, (byte) =>
      Buffer.concat([Buffer.from('%output %0 '), Buffer.of(byte), Buffer.from('\n')])))
    for (let size = 1; size <= wire.length; size += 1) {
      const splitter = new LineSplitter()
      const output: Uint8Array[] = []
      for (let offset = 0; offset < wire.length; offset += size) {
        for (const line of splitter.push(wire.subarray(offset, offset + size))) {
          const message = parseBytes(line)
          if (message.kind === 'output') output.push(message.data)
        }
      }
      expect(Buffer.concat(output)).toEqual(expected)
    }
    expect(Buffer.from(decodeBytes(Buffer.from('\\344\\270\\255')))).toEqual(Buffer.from('中'))
  })
})

describe('paneEnvironment', () => {
  it('drops the host terminal descriptors and advertises a colour-capable UTF-8 terminal', () => {
    const env = paneEnvironment({
      PATH: '/usr/bin', HOME: '/home/u', NO_COLOR: '1', FORCE_COLOR: '0', CI: 'true',
      TERM: 'dumb', TERM_PROGRAM: 'vscode', TMUX: '/tmp/x,1,0', TMUX_PANE: '%3', LANG: 'C', LC_ALL: 'POSIX',
    })
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/u', TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'C.UTF-8' })
  })

  it('keeps an existing UTF-8 locale untouched', () => {
    const env = paneEnvironment({ LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', EDITOR: 'vim' })
    expect(env).toMatchObject({ LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', EDITOR: 'vim', TERM: 'xterm-256color' })
  })
})

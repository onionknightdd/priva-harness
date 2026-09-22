import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Terminal } from '@xterm/headless'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { TerminalLaunchSpec } from '../../../../src/core/contract/terminal-service.js'
import { TmuxTerminalService } from '../../../../src/infrastructure/terminal/tmux-terminal-service.js'
import { claudeComposer } from '../../../../src/provider/claude/claude-terminal-composer.js'

function tmuxAvailable(): boolean {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// A shell that echoes its input is enough to prove the plumbing; the real
// program under this terminal is the harness TUI.
function shellLaunch(cwd: string, overrides: Partial<TerminalLaunchSpec> = {}): TerminalLaunchSpec {
  return {
    command: 'bash',
    args: ['--norc', '--noprofile'],
    cwd,
    env: { PS1: 'READY> ', PRIVA_TEST_MARK: 'mark-1', NO_COLOR: '1', TERM: 'dumb' },
    cols: 80,
    rows: 12,
    ...overrides,
  }
}

const text = (chunks: Uint8Array[]) => Buffer.concat(chunks).toString('utf8')
const byteWriterArgs = ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../../../fixtures/terminal/byte-writer.ts', import.meta.url))]
const outputInput = (bytes: Uint8Array) => Buffer.from(`${JSON.stringify(Array.from(bytes))}\n`)
const render = (terminal: Terminal, bytes: Uint8Array | string) => new Promise<void>((resolve) => { terminal.write(bytes, resolve) })
const screenLines = (terminal: Terminal) => Array.from({ length: terminal.rows }, (_, row) =>
  terminal.buffer.active.getLine(terminal.buffer.active.baseY + row)?.translateToString(true).trimEnd() ?? '')

describe.skipIf(!tmuxAvailable())('TmuxTerminalService', () => {
  let root: string
  let cwd: string
  let service: TmuxTerminalService
  let now = Date.now()
  beforeEach(async () => {
    now = Date.now()
    root = await mkdtemp(join(tmpdir(), 'priva-tmux-'))
    cwd = join(root, 'work')
    await rm(cwd, { recursive: true, force: true })
    await mkdir(cwd)
    service = new TmuxTerminalService({ rootDir: join(root, 'terminals'), sweepIntervalMs: 0, idleTimeoutMs: 60_000, now: () => now })
  })
  afterEach(async () => {
    await service.dispose()
    for (const dir of await readdir(join(root, 'terminals')).catch(() => [] as string[])) {
      try { execFileSync('tmux', ['-S', join(root, 'terminals', dir, 'tmux.sock'), 'kill-server'], { stdio: 'ignore' }) } catch { /* already gone */ }
    }
    await rm(root, { recursive: true, force: true })
  })

  it('launches once, adopts on the second ensure, and streams input and output through an attachment', async () => {
    expect(await service.isAlive('s1')).toBe(false)
    expect(await service.ensure('s1', shellLaunch(cwd))).toEqual({ key: 's1', adopted: false })
    expect(await service.ensure('s1', shellLaunch(cwd))).toEqual({ key: 's1', adopted: true })
    expect(await service.isAlive('s1')).toBe(true)

    const attachment = await service.attach('s1', 80, 12)
    expect(attachment.cols).toBe(80)
    expect(attachment.rows).toBe(12)
    const chunks: Uint8Array[] = []
    attachment.onOutput((chunk) => chunks.push(chunk))
    await expect.poll(() => text([attachment.screen]).includes('READY>'), { timeout: 5000 }).toBe(true)

    await attachment.write(Buffer.from('echo $PRIVA_TEST_MARK; pwd; echo "T=$TERM C=$COLORTERM N=${NO_COLOR-unset}"\r'))
    await expect.poll(() => text(chunks).includes('mark-1'), { timeout: 5000 }).toBe(true)
    expect(text(chunks)).toContain(cwd)
    // The pane sees a colour-capable terminal even when the runner (or the
    // launch env copied from it) carried NO_COLOR / TERM=dumb.
    await expect.poll(() => text(chunks).includes('T=screen-256color C=truecolor N=unset'), { timeout: 5000 }).toBe(true)

    await attachment.resize(100, 20)
    await expect.poll(async () => (await service.capture('s1')).split('\n').length, { timeout: 5000 }).toBeGreaterThanOrEqual(20)

    await attachment.detach()
    expect(await service.isAlive('s1')).toBe(true)
  })

  it('gives a late viewer the rendered screen and pastes text as one bracketed block', async () => {
    await service.ensure('s2', shellLaunch(cwd))
    const first = await service.attach('s2', 80, 12)
    await expect.poll(() => text([first.screen]).includes('READY>'), { timeout: 5000 }).toBe(true)
    await first.write(Buffer.from('echo before-second-viewer\r'))
    await expect.poll(async () => (await service.capture('s2')).includes('before-second-viewer'), { timeout: 5000 }).toBe(true)

    const second = await service.attach('s2', 80, 12)
    const screen = text([second.screen])
    expect(screen).toContain('before-second-viewer')
    // The snapshot restores the cursor as well as the rendered text.
    expect(/\[\d+;\d+H/u.test(screen)).toBe(true)
    expect(screen.charCodeAt(screen.search(/\[\d+;\d+H/u) - 1)).toBe(0x1b)

    await service.sendKeys('s2', ['C-u'])
    await service.paste('s2', 'echo pasted-line\\')
    await service.sendKeys('s2', ['Enter'])
    await expect.poll(async () => (await service.capture('s2')).includes('pasted-line'), { timeout: 5000 }).toBe(true)
    await first.detach()
    await second.detach()
  })

  it('preserves suggestion styling and joins soft wraps without merging logical draft lines', async () => {
    const suggestion = '检查子 agent 的输出 👋 and the rest of this long suggestion'
    const initial = `READY\r\n${'─'.repeat(40)}\r\n❯ \u001b[2m${suggestion}\u001b[0m\r\n${'─'.repeat(40)}`
    await service.ensure('suggestion', shellLaunch(cwd, {
      command: process.execPath, args: [...byteWriterArgs, Buffer.from(initial).toString('base64')], cols: 40,
    }))
    await expect.poll(() => service.capture('suggestion')).toContain('READY')
    const styled = await service.capture('suggestion', { styled: true })
    expect(claudeComposer(styled)).toEqual({ text: '', suggestion })
    expect(await service.capture('suggestion')).not.toContain('\u001b[')
    const viewer = await service.attach('suggestion', 40, 12)
    await viewer.write(outputInput(Buffer.from(`\u001b[2J\u001b[H${'─'.repeat(40)}\r\n❯ draft one\r\nsecond line\r\n${'─'.repeat(40)}`)))
    await expect.poll(async () => claudeComposer(await service.capture('suggestion', { styled: true })))
      .toEqual({ text: 'draft one\nsecond line' })
  })

  it('reports exit to viewers when the program ends and closes cleanly', async () => {
    await service.ensure('s3', shellLaunch(cwd))
    const attachment = await service.attach('s3', 80, 12)
    const exits: string[] = []
    attachment.onExit((reason) => exits.push(reason))
    await attachment.write(Buffer.from('exit\r'))
    await expect.poll(() => exits.length, { timeout: 5000 }).toBe(1)
    await expect.poll(() => service.isAlive('s3'), { timeout: 5000 }).toBe(false)
    await service.close('s3')
    expect(await service.isAlive('s3')).toBe(false)
  })

  it('sweeps idle terminals that have no viewer and leaves watched or recent ones alone', async () => {
    await service.ensure('idle', shellLaunch(cwd))
    await service.ensure('watched', shellLaunch(cwd))
    const viewer = await service.attach('watched', 80, 12)
    // Fresh terminals have just produced output, so nothing is idle yet.
    expect(await service.sweepIdle()).toEqual([])
    now += 120_000
    const closed = await service.sweepIdle()
    expect(closed).toHaveLength(1)
    expect(await service.isAlive('idle')).toBe(false)
    expect(await service.isAlive('watched')).toBe(true)
    await viewer.detach()
  })

  it('surfaces a missing tmux binary as backend-unavailable', async () => {
    const broken = new TmuxTerminalService({ rootDir: join(root, 'none'), tmuxBinary: join(root, 'no-such-tmux'), sweepIntervalMs: 0 })
    await expect(broken.isAlive('x')).rejects.toMatchObject({ kind: 'backend-unavailable' })
    await expect(broken.attach('x', 80, 12)).rejects.toMatchObject({ kind: 'backend-unavailable' })
  })

  it('preserves Chinese and emoji bytes split across separate pane output messages', async () => {
    await service.ensure('utf8', shellLaunch(cwd, { command: process.execPath, args: byteWriterArgs }))
    await expect.poll(async () => (await service.capture('utf8')).includes('READY')).toBe(true)
    const attachment = await service.attach('utf8', 80, 12)
    const chunks: Uint8Array[] = []
    attachment.onOutput((chunk) => chunks.push(chunk))
    const expected = Buffer.from('中文 🚀')
    for (const byte of expected) {
      const count = chunks.length
      await attachment.write(outputInput(Uint8Array.of(byte)))
      await expect.poll(() => chunks.length).toBeGreaterThan(count)
    }
    expect(Buffer.concat(chunks)).toEqual(expected)
    expect(await service.capture('utf8')).toContain('中文 🚀')
  })

  it('restores a late viewer\'s alternate screen, mouse modes, scrolling region and saved normal screen', async () => {
    const initial = 'NORMAL\r\nPROMPT> '
      + '\u001b[?1049h\u001b[2J\u001b[HHEADER\r\nBODY A\r\nBODY B\r\nBODY C\r\nBODY D\r\nFOOTER'
      + '\u001b[2;5r\u001b[?1000h\u001b[?1006h\u001b[?2004h\u001b[?25l\u001b[5;1H'
    await service.ensure('scroll', shellLaunch(cwd, {
      command: process.execPath, args: [...byteWriterArgs, Buffer.from(initial).toString('base64')], cols: 40, rows: 6,
    }))
    await expect.poll(async () => (await service.capture('scroll')).includes('FOOTER')).toBe(true)
    const attachment = await service.attach('scroll', 40, 6)
    const terminal = new Terminal({ cols: 40, rows: 6, allowProposedApi: true })
    try {
      attachment.onOutput((chunk) => terminal.write(chunk))
      await render(terminal, attachment.screen)
      expect(terminal.buffer.active.type).toBe('alternate')
      expect(terminal.modes.mouseTrackingMode).toBe('vt200')
      expect(terminal.modes.bracketedPasteMode).toBe(true)
      expect(screenLines(terminal)).toEqual(['HEADER', 'BODY A', 'BODY B', 'BODY C', 'BODY D', 'FOOTER'])

      await attachment.write(outputInput(Buffer.from('\u001b[5;1H\n\u001b[2KNEW')))
      await expect.poll(() => screenLines(terminal)).toEqual(['HEADER', 'BODY B', 'BODY C', 'BODY D', 'NEW', 'FOOTER'])
      expect((await service.capture('scroll')).trimEnd().split('\n')).toEqual(screenLines(terminal))

      await attachment.write(outputInput(Buffer.from('\u001b[?1049l')))
      await expect.poll(() => terminal.buffer.active.type).toBe('normal')
      expect(screenLines(terminal).slice(0, 2)).toEqual(['NORMAL', 'PROMPT>'])
      expect(terminal.buffer.active.cursorX).toBe(8)
      expect(terminal.buffer.active.cursorY).toBe(1)
    } finally {
      terminal.dispose()
    }
  })

  it('resumes an escape sequence that was incomplete when the snapshot was captured', async () => {
    await service.ensure('pending', shellLaunch(cwd, {
      command: process.execPath, args: [...byteWriterArgs, Buffer.from('READY\u001b[3;').toString('base64')],
    }))
    await expect.poll(async () => (await service.capture('pending')).includes('READY')).toBe(true)
    const attachment = await service.attach('pending', 80, 12)
    const terminal = new Terminal({ cols: 80, rows: 12, allowProposedApi: true })
    try {
      await render(terminal, attachment.screen)
      attachment.onOutput((chunk) => terminal.write(chunk))
      await attachment.write(outputInput(Buffer.from('5HOK')))
      await expect.poll(() => screenLines(terminal)[2]).toBe('    OK')
      expect(screenLines(terminal)[0]).toBe('READY')
    } finally {
      terminal.dispose()
    }
  })

  it('retains output produced after the snapshot but before the viewer subscribes', async () => {
    await service.ensure('buffered', shellLaunch(cwd, { command: process.execPath, args: byteWriterArgs }))
    await expect.poll(async () => (await service.capture('buffered')).includes('READY')).toBe(true)
    const first = await service.attach('buffered', 80, 12)
    const second = await service.attach('buffered', 80, 12)
    await first.write(outputInput(Buffer.from(' AFTER-SNAPSHOT')))
    await expect.poll(async () => (await service.capture('buffered')).includes('AFTER-SNAPSHOT')).toBe(true)
    const terminal = new Terminal({ cols: 80, rows: 12, allowProposedApi: true })
    try {
      await render(terminal, second.screen)
      second.onOutput((chunk) => terminal.write(chunk))
      await expect.poll(() => screenLines(terminal)[0]).toBe('READY AFTER-SNAPSHOT')
    } finally {
      terminal.dispose()
    }
  })

  it('captures an adopted terminal at the new viewer\'s dimensions', async () => {
    const initial = `${'x'.repeat(60)}\r\nREADY`
    await service.ensure('geometry', shellLaunch(cwd, {
      command: process.execPath, args: [...byteWriterArgs, Buffer.from(initial).toString('base64')],
    }))
    await expect.poll(async () => (await service.capture('geometry')).includes('READY')).toBe(true)
    const attachment = await service.attach('geometry', 40, 6)
    expect({ cols: attachment.cols, rows: attachment.rows }).toEqual({ cols: 40, rows: 6 })
    const terminal = new Terminal({ cols: 40, rows: 6, allowProposedApi: true })
    try {
      await render(terminal, attachment.screen)
      expect(screenLines(terminal)).toEqual((await service.capture('geometry')).split('\n').slice(0, -1))
    } finally {
      terminal.dispose()
    }
  })

  it('preserves a UTF-8 character that straddles the snapshot boundary', async () => {
    await service.ensure('pending-utf8', shellLaunch(cwd, { command: process.execPath, args: byteWriterArgs }))
    await expect.poll(async () => (await service.capture('pending-utf8')).includes('READY')).toBe(true)
    const first = await service.attach('pending-utf8', 80, 12)
    const chunks: Uint8Array[] = []
    first.onOutput((chunk) => chunks.push(chunk))
    const character = Buffer.from('中')
    await first.write(outputInput(character.subarray(0, 1)))
    await expect.poll(() => chunks.length).toBeGreaterThan(0)
    const second = await service.attach('pending-utf8', 80, 12)
    const terminal = new Terminal({ cols: 80, rows: 12, allowProposedApi: true })
    try {
      await render(terminal, second.screen)
      second.onOutput((chunk) => terminal.write(chunk))
      await first.write(outputInput(character.subarray(1)))
      await expect.poll(() => screenLines(terminal)[0]).toBe('READY中')
    } finally {
      terminal.dispose()
    }
  })

  it.each([
    ['origin', '\u001b[2;5r\u001b[?6h\u001b[2;4H'],
    ['autowrap', 'W'.repeat(40)],
    ['wrap disabled', `\u001b[?7l${'W'.repeat(40)}`],
    ['insert', 'abc\r\u001b[4h'],
  ])('continues drawing at the same cells after restoring %s mode', async (_name, setup) => {
    const initial = `READY\r\n${setup}`
    await service.ensure('modes', shellLaunch(cwd, {
      command: process.execPath, args: [...byteWriterArgs, Buffer.from(initial).toString('base64')], cols: 40, rows: 6,
    }))
    await expect.poll(async () => (await service.capture('modes')).includes('READY')).toBe(true)
    const attachment = await service.attach('modes', 40, 6)
    const terminal = new Terminal({ cols: 40, rows: 6, allowProposedApi: true })
    try {
      await render(terminal, attachment.screen)
      attachment.onOutput((chunk) => terminal.write(chunk))
      await attachment.write(outputInput(Buffer.from('X')))
      await expect.poll(async () => (await service.capture('modes')).includes('X')).toBe(true)
      const expected = (await service.capture('modes')).split('\n').slice(0, -1)
      await expect.poll(() => screenLines(terminal)).toEqual(expected)
    } finally {
      terminal.dispose()
    }
  })
})

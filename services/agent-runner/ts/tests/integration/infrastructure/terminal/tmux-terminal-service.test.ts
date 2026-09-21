import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { TerminalLaunchSpec } from '../../../../src/core/contract/terminal-service.js'
import { TmuxTerminalService } from '../../../../src/infrastructure/terminal/tmux-terminal-service.js'

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
    env: { PS1: 'READY> ', PRIVA_TEST_MARK: 'mark-1' },
    cols: 80,
    rows: 12,
    ...overrides,
  }
}

const text = (chunks: Uint8Array[]) => Buffer.concat(chunks).toString('utf8')

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

    const attachment = await service.attach('s1')
    expect(attachment.cols).toBe(80)
    expect(attachment.rows).toBe(12)
    const chunks: Uint8Array[] = []
    attachment.onOutput((chunk) => chunks.push(chunk))
    await expect.poll(() => text([attachment.screen]).includes('READY>'), { timeout: 5000 }).toBe(true)

    await attachment.write(Buffer.from('echo $PRIVA_TEST_MARK; pwd\r'))
    await expect.poll(() => text(chunks).includes('mark-1'), { timeout: 5000 }).toBe(true)
    expect(text(chunks)).toContain(cwd)

    await attachment.resize(100, 20)
    await expect.poll(async () => (await service.capture('s1')).split('\n').length, { timeout: 5000 }).toBeGreaterThanOrEqual(20)

    await attachment.detach()
    expect(await service.isAlive('s1')).toBe(true)
  })

  it('gives a late viewer the rendered screen and pastes text as one bracketed block', async () => {
    await service.ensure('s2', shellLaunch(cwd))
    const first = await service.attach('s2')
    await expect.poll(() => text([first.screen]).includes('READY>'), { timeout: 5000 }).toBe(true)
    await first.write(Buffer.from('echo before-second-viewer\r'))
    await expect.poll(async () => (await service.capture('s2')).includes('before-second-viewer'), { timeout: 5000 }).toBe(true)

    const second = await service.attach('s2')
    const screen = text([second.screen])
    expect(screen).toContain('before-second-viewer')
    // Ends with a cursor-position sequence: ESC [ row ; col H
    expect(/\[\d+;\d+H$/u.test(screen)).toBe(true)
    expect(screen.charCodeAt(screen.search(/\[\d+;\d+H$/u) - 1)).toBe(0x1b)

    await service.sendKeys('s2', ['C-u'])
    await service.paste('s2', 'echo pasted-line\\')
    await service.sendKeys('s2', ['Enter'])
    await expect.poll(async () => (await service.capture('s2')).includes('pasted-line'), { timeout: 5000 }).toBe(true)
    await first.detach()
    await second.detach()
  })

  it('reports exit to viewers when the program ends and closes cleanly', async () => {
    await service.ensure('s3', shellLaunch(cwd))
    const attachment = await service.attach('s3')
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
    const viewer = await service.attach('watched')
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
    await expect(broken.attach('x')).rejects.toMatchObject({ kind: 'backend-unavailable' })
  })
})

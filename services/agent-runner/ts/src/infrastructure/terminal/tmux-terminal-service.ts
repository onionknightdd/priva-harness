import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import {
  TerminalError,
  type TerminalAttachment,
  type TerminalInfo,
  type TerminalLaunchSpec,
  type TerminalService,
} from '../../core/contract/terminal-service.js'
import { TmuxControlClient } from './tmux-control-client.js'
import { hexKeyTokens } from './tmux-control-protocol.js'

const execFileAsync = promisify(execFile)

// One tmux server per terminal so `kill-server` is a clean teardown and a
// crashed program never takes a sibling terminal with it.
const SESSION_NAME = 'main'
const SOCKET_FILE = 'tmux.sock'
const PASTE_BUFFER = 'priva-paste'
// send-keys -H spends three characters per byte; stay well under tmux's
// per-command line limit.
const MAX_INPUT_BYTES_PER_COMMAND = 2048
const SNAPSHOT_HISTORY_LINES = 2000
// screen-256color ships in ncurses-base everywhere tmux runs; programs only
// need the "256color" suffix to enable colour.
const PANE_TERM = 'screen-256color'
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000
const DEFAULT_SWEEP_INTERVAL_MS = 60 * 1000

const SERVER_OPTIONS: readonly (readonly string[])[] = [
  ['status', 'off'],
  // Viewers drive the size explicitly (`resize-window`) so the latest
  // browser tab wins instead of tmux clamping to the smallest client.
  ['window-size', 'manual'],
  ['history-limit', '20000'],
  ['escape-time', '0'],
  ['focus-events', 'on'],
  ['exit-empty', 'on'],
  ['destroy-unattached', 'off'],
  ['mouse', 'off'],
  ['set-clipboard', 'off'],
]

// Variables the runner process may carry that describe *its* (often
// non-interactive) environment, not the browser terminal the program will
// actually render into. They would switch colour and TUI features off.
const HOST_TERMINAL_VARIABLES = ['NO_COLOR', 'FORCE_COLOR', 'CI', 'TERM', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'TMUX', 'TMUX_PANE']

/**
 * Environment for the tmux server (and so for every pane it spawns): the
 * runner's environment with host-terminal descriptors removed, a truecolor
 * capability advertised and a UTF-8 locale guaranteed so tmux passes
 * multibyte output through.
 */
export function paneEnvironment(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined || HOST_TERMINAL_VARIABLES.includes(name)) continue
    env[name] = value
  }
  env['TERM'] = 'xterm-256color'
  env['COLORTERM'] = 'truecolor'
  const locale = env['LC_ALL'] ?? env['LC_CTYPE'] ?? env['LANG'] ?? ''
  if (!/utf-?8/iu.test(locale)) {
    delete env['LC_ALL']
    delete env['LC_CTYPE']
    env['LANG'] = 'C.UTF-8'
  }
  return env
}

export interface TmuxTerminalServiceOptions {
  /** Directory that holds one sub-directory (socket + scratch files) per terminal. */
  readonly rootDir: string
  readonly tmuxBinary?: string
  /** Idle terminals with no attached viewer are closed after this long. */
  readonly idleTimeoutMs?: number
  readonly sweepIntervalMs?: number
  readonly now?: () => number
  readonly logger?: { warn(message: string): void }
}

export class TmuxTerminalService implements TerminalService {
  private readonly tmux: string
  private readonly env: Record<string, string>
  private readonly idleTimeoutMs: number
  private readonly now: () => number
  private readonly sweepTimer: NodeJS.Timeout | undefined
  private readonly attachments = new Map<string, Set<TmuxControlClient>>()

  constructor(private readonly options: TmuxTerminalServiceOptions) {
    this.tmux = options.tmuxBinary ?? 'tmux'
    this.env = paneEnvironment()
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this.now = options.now ?? Date.now
    const interval = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS
    if (interval > 0) {
      this.sweepTimer = setInterval(() => { void this.sweepIdle() }, interval)
      this.sweepTimer.unref()
    }
  }

  socketPath(key: string): string {
    return join(this.terminalDir(key), SOCKET_FILE)
  }

  async scratchDir(key: string): Promise<string> {
    const dir = this.terminalDir(key)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    return dir
  }

  async ensure(key: string, launch: TerminalLaunchSpec): Promise<TerminalInfo> {
    if (await this.isAlive(key)) return { key, adopted: true }
    await this.scratchDir(key)
    await rm(this.socketPath(key), { force: true })
    // The server inherits the sanitised environment, so only the launch's
    // own additions travel as session variables; host-terminal descriptors
    // the provider copied from the runner process are dropped again here.
    const envArgs = Object.entries(launch.env)
      .filter(([name, value]) => !HOST_TERMINAL_VARIABLES.includes(name) && this.env[name] !== value)
      .flatMap(([name, value]) => ['-e', `${name}=${value}`])
    // `default-terminal` must be in place before the first pane is created,
    // hence the explicit start-server ahead of new-session.
    const args = [
      'start-server', ';',
      'set-option', '-g', 'default-terminal', PANE_TERM, ';',
      'new-session', '-d', '-s', SESSION_NAME,
      '-x', String(launch.cols), '-y', String(launch.rows),
      '-c', launch.cwd,
      ...envArgs,
      '--', launch.command, ...launch.args,
    ]
    for (const [name = '', value = ''] of SERVER_OPTIONS) args.push(';', 'set-option', '-g', name, value)
    try {
      await this.run(key, args)
    } catch (error) {
      // Another caller won the race between has-session and new-session.
      if (/duplicate session/iu.test(describe(error))) return { key, adopted: true }
      throw new TerminalError('launch-failed', `Could not start terminal: ${describe(error)}`, { cause: error })
    }
    return { key, adopted: false }
  }

  async isAlive(key: string): Promise<boolean> {
    try {
      await this.run(key, ['has-session', '-t', SESSION_NAME])
      return true
    } catch (error) {
      if (error instanceof TerminalError && error.kind === 'backend-unavailable') throw error
      return false
    }
  }

  async attach(key: string): Promise<TerminalAttachment> {
    if (!await this.isAlive(key)) throw new TerminalError('not-found', 'Terminal is not running')
    const client = await TmuxControlClient.open({
      tmuxBinary: this.tmux,
      socketPath: this.socketPath(key),
      sessionName: SESSION_NAME,
      env: this.env,
    })
    const viewers = this.attachments.get(key) ?? new Set()
    viewers.add(client)
    this.attachments.set(key, viewers)
    const paneId = (await client.command(['list-panes', '-t', SESSION_NAME, '-F', '#{pane_id}']))[0]?.trim()
    if (paneId === undefined || paneId === '') {
      await client.close()
      throw new TerminalError('io-failure', 'Terminal has no pane')
    }
    // Output that races the snapshot is held back: the snapshot already
    // includes everything tmux rendered before it, and replaying it twice
    // would corrupt the viewer's screen.
    const outputListeners = new Set<(chunk: Uint8Array) => void>()
    const exitListeners = new Set<(reason: string) => void>()
    let snapshotDone = false
    const buffered: Uint8Array[] = []
    client.onOutput((pane, data) => {
      if (pane !== paneId) return
      if (!snapshotDone) { buffered.push(data); return }
      for (const listener of outputListeners) listener(data)
    })
    client.onExit((reason) => {
      viewers.delete(client)
      for (const listener of exitListeners) listener(reason)
    })
    const snapshot = await this.snapshot(client, paneId)
    snapshotDone = true
    buffered.length = 0
    return {
      screen: snapshot.screen,
      cols: snapshot.cols,
      rows: snapshot.rows,
      onOutput: (listener) => { outputListeners.add(listener); return () => { outputListeners.delete(listener) } },
      onExit: (listener) => { exitListeners.add(listener); return () => { exitListeners.delete(listener) } },
      write: async (input) => {
        for (let offset = 0; offset < input.length; offset += MAX_INPUT_BYTES_PER_COMMAND) {
          const slice = input.subarray(offset, offset + MAX_INPUT_BYTES_PER_COMMAND)
          await client.command(['send-keys', '-t', paneId, '-H', ...hexKeyTokens(slice)])
        }
      },
      resize: async (cols, rows) => {
        const width = clampDimension(cols, 20, 500)
        const height = clampDimension(rows, 5, 300)
        await client.command(['refresh-client', '-C', `${width}x${height}`])
        await client.command(['resize-window', '-t', SESSION_NAME, '-x', String(width), '-y', String(height)])
      },
      detach: async () => {
        viewers.delete(client)
        await client.close()
      },
    }
  }

  async paste(key: string, text: string): Promise<void> {
    const dir = this.terminalDir(key)
    const file = join(dir, `paste-${process.pid}-${this.now()}.txt`)
    // A trailing newline inside the paste keeps a final backslash from being
    // read as a line continuation when Enter follows.
    await writeFile(file, text.endsWith('\n') ? text : `${text}\n`, { mode: 0o600 })
    try {
      await this.run(key, ['load-buffer', '-b', PASTE_BUFFER, file])
      await this.run(key, ['paste-buffer', '-p', '-d', '-b', PASTE_BUFFER, '-t', SESSION_NAME])
    } finally {
      await rm(file, { force: true })
    }
  }

  async sendKeys(key: string, keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return
    await this.run(key, ['send-keys', '-t', SESSION_NAME, ...keys])
  }

  async capture(key: string): Promise<string> {
    const { stdout } = await this.run(key, ['capture-pane', '-p', '-t', SESSION_NAME])
    return stdout
  }

  async close(key: string): Promise<void> {
    for (const client of this.attachments.get(key) ?? []) await client.close()
    this.attachments.delete(key)
    if (await this.isAlive(key)) {
      try {
        await this.run(key, ['kill-server'])
      } catch (error) {
        if (!(error instanceof TerminalError && error.kind === 'not-found')) throw error
      }
    }
    await rm(this.terminalDir(key), { recursive: true, force: true })
  }

  async dispose(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    for (const clients of this.attachments.values()) {
      for (const client of clients) await client.close()
    }
    this.attachments.clear()
  }

  /** Close terminals nobody is watching whose program has been quiet too long. */
  async sweepIdle(): Promise<string[]> {
    let dirs: string[]
    try {
      dirs = await readdir(this.options.rootDir)
    } catch {
      return []
    }
    const closed: string[] = []
    for (const dir of dirs) {
      const key = `dir:${dir}`
      try {
        if (!await this.isAliveAt(join(this.options.rootDir, dir, SOCKET_FILE))) {
          await rm(join(this.options.rootDir, dir), { recursive: true, force: true })
          continue
        }
        const { stdout } = await this.runAt(join(this.options.rootDir, dir, SOCKET_FILE), [
          'display-message', '-p', '-t', SESSION_NAME, '#{window_activity} #{session_attached}',
        ])
        const [activity, attached] = stdout.trim().split(' ')
        const idleMs = this.now() - Number(activity) * 1000
        if (attached !== '0' || !Number.isFinite(idleMs) || idleMs < this.idleTimeoutMs) continue
        await this.runAt(join(this.options.rootDir, dir, SOCKET_FILE), ['kill-server'])
        await rm(join(this.options.rootDir, dir), { recursive: true, force: true })
        closed.push(dir)
      } catch (error) {
        this.options.logger?.warn(`terminal sweep skipped ${key}: ${describe(error)}`)
      }
    }
    return closed
  }

  private async snapshot(
    client: TmuxControlClient,
    paneId: string,
  ): Promise<{ screen: Uint8Array; cols: number; rows: number }> {
    const [geometry] = await client.command([
      'display-message', '-p', '-t', paneId, '#{pane_width} #{pane_height} #{cursor_x} #{cursor_y}',
    ])
    const [cols, rows, cursorX, cursorY] = (geometry ?? '').trim().split(' ').map(Number)
    const lines = await client.command([
      'capture-pane', '-p', '-e', '-t', paneId, '-S', `-${SNAPSHOT_HISTORY_LINES}`,
    ])
    // Rows are joined without a trailing newline so the last visible row
    // stays on screen; the cursor is then placed explicitly.
    const text = `\u001b[0m${lines.join('\r\n')}\u001b[${(cursorY ?? 0) + 1};${(cursorX ?? 0) + 1}H`
    return { screen: Buffer.from(text, 'utf8'), cols: cols ?? 80, rows: rows ?? 24 }
  }

  private terminalDir(key: string): string {
    return join(this.options.rootDir, createHash('sha256').update(key).digest('hex').slice(0, 24))
  }

  private run(key: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
    return this.runAt(this.socketPath(key), args)
  }

  private async isAliveAt(socketPath: string): Promise<boolean> {
    try {
      await this.runAt(socketPath, ['has-session', '-t', SESSION_NAME])
      return true
    } catch (error) {
      if (error instanceof TerminalError && error.kind === 'backend-unavailable') throw error
      return false
    }
  }

  private async runAt(socketPath: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
    try {
      // The server inherits this environment on `new-session`, so every pane
      // sees the sanitised terminal variables rather than the runner's own.
      return await execFileAsync(this.tmux, ['-S', socketPath, ...args], {
        cwd: tmpdir(),
        maxBuffer: 16 * 1024 * 1024,
        env: this.env,
      })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        throw new TerminalError('backend-unavailable', `tmux is not installed (looked for ${this.tmux})`, { cause: error })
      }
      const stderr = (error as { stderr?: string }).stderr ?? ''
      if (/no server running|can't find session|no current session|error connecting/iu.test(stderr)) {
        throw new TerminalError('not-found', stderr.trim(), { cause: error })
      }
      throw new TerminalError('io-failure', `tmux ${args[0] ?? ''} failed: ${stderr.trim() || describe(error)}`, { cause: error })
    }
  }
}

function clampDimension(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

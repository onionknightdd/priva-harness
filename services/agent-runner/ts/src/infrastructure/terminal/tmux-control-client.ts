import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'

import { TerminalError } from '../../core/contract/terminal-service.js'
import {
  formatTmuxCommand,
  LineSplitter,
  parseControlLine,
} from './tmux-control-protocol.js'

export interface TmuxControlClientOptions {
  readonly tmuxBinary: string
  readonly socketPath: string
  readonly sessionName: string
}

interface PendingReply {
  readonly command: string
  readonly lines: string[]
  resolve(lines: string[]): void
  reject(error: Error): void
}

/**
 * One `tmux -C attach` process. Commands are written to stdin and answered in
 * order, so replies are matched FIFO; pane output and lifecycle notifications
 * are fanned out to listeners. A control client needs no pseudo-terminal,
 * which keeps the runner free of native PTY bindings.
 */
export class TmuxControlClient {
  private readonly child: ChildProcessByStdio<Writable, Readable, Readable>
  private readonly splitter = new LineSplitter()
  private readonly queue: PendingReply[] = []
  private active: PendingReply | undefined
  private readonly outputListeners = new Set<(paneId: string, data: Uint8Array) => void>()
  private readonly exitListeners = new Set<(reason: string) => void>()
  private exited = false
  private stderr = ''

  private constructor(options: TmuxControlClientOptions) {
    this.child = spawn(
      options.tmuxBinary,
      ['-S', options.socketPath, '-C', 'attach-session', '-t', options.sessionName],
      { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, TERM: 'xterm-256color' } },
    )
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => { this.consume(chunk) })
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-4096) })
    this.child.once('close', () => { this.finish(this.stderr.trim() || 'tmux control client closed') })
    this.child.once('error', (error) => { this.finish(error.message) })
  }

  static async open(options: TmuxControlClientOptions): Promise<TmuxControlClient> {
    const client = new TmuxControlClient(options)
    // The first command doubles as the attach handshake: it fails fast when
    // the socket or session is gone instead of leaving a silent client.
    await client.command(['display-message', '-p', '#{session_name}'])
    return client
  }

  onOutput(listener: (paneId: string, data: Uint8Array) => void): () => void {
    this.outputListeners.add(listener)
    return () => { this.outputListeners.delete(listener) }
  }

  onExit(listener: (reason: string) => void): () => void {
    this.exitListeners.add(listener)
    return () => { this.exitListeners.delete(listener) }
  }

  command(parts: readonly string[]): Promise<string[]> {
    if (this.exited) {
      return Promise.reject(new TerminalError('io-failure', 'tmux control client is closed'))
    }
    const command = formatTmuxCommand(parts)
    return new Promise<string[]>((resolve, reject) => {
      this.queue.push({ command, lines: [], resolve, reject })
      this.child.stdin.write(`${command}\n`, (error) => {
        if (error) reject(new TerminalError('io-failure', `tmux command failed to send: ${error.message}`))
      })
    })
  }

  async close(): Promise<void> {
    if (this.exited) return
    const closed = new Promise<void>((resolve) => { this.exitListeners.add(() => { resolve() }) })
    this.child.stdin.end('detach-client\n')
    const timer = setTimeout(() => { this.child.kill('SIGTERM') }, 1000)
    await closed
    clearTimeout(timer)
  }

  private consume(chunk: string): void {
    for (const line of this.splitter.push(chunk)) this.handle(line)
  }

  private handle(line: string): void {
    const message = parseControlLine(line, this.active !== undefined)
    switch (message.kind) {
      case 'begin':
        if (message.fromClient) this.active = this.queue.shift()
        return
      case 'end':
        if (message.fromClient && this.active) {
          this.active.resolve(this.active.lines)
          this.active = undefined
        }
        return
      case 'error':
        if (message.fromClient && this.active) {
          this.active.reject(new TerminalError(
            'io-failure',
            `tmux command failed (${this.active.command}): ${this.active.lines.join(' ').trim()}`,
          ))
          this.active = undefined
        }
        return
      case 'body':
        this.active?.lines.push(message.text)
        return
      case 'output':
        for (const listener of this.outputListeners) listener(message.paneId, message.data)
        return
      case 'exit':
        this.finish(message.reason === '' ? 'tmux session ended' : message.reason)
        return
      case 'notification':
        return
    }
  }

  private finish(reason: string): void {
    if (this.exited) return
    this.exited = true
    for (const line of this.splitter.flush()) this.handle(line)
    const failure = new TerminalError('io-failure', `tmux control client exited: ${reason}`)
    this.active?.reject(failure)
    this.active = undefined
    for (const pending of this.queue.splice(0)) pending.reject(failure)
    for (const listener of this.exitListeners) listener(reason)
    this.exitListeners.clear()
    this.outputListeners.clear()
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGTERM')
  }
}

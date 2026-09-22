import type { ProviderSessionStore } from '../../core/contract/provider-session-store.js'
import { foldThread } from '../../core/resource/fold-thread.js'
import { SessionError } from '../../core/resource/session.js'
import type { SessionStream } from '../session/session-stream.js'

/** One native transcript observer shared by all viewers of a terminal. */
export class TerminalHistoryMirror {
  private stopped = false
  private dirty = false
  private pending: Promise<void> | undefined
  private unwatch: (() => void) | undefined
  private lastHistory: string | undefined

  constructor(private readonly store: ProviderSessionStore, private readonly stream: SessionStream) {}

  async start(cwd: string): Promise<void> {
    this.unwatch = await this.store.watch?.(this.stream.session, cwd, (error) => {
      if (error) this.stream.publish({ type: 'error', code: 'terminal.history', message: `Could not observe terminal messages: ${error.message}` })
      else void this.refresh()
    })
    await this.refresh()
  }

  refresh(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    this.dirty = true
    if (this.pending !== undefined) return this.pending
    this.pending = Promise.resolve().then(() => this.readChanges()).finally(() => {
      this.pending = undefined
      if (this.dirty && !this.stopped) void this.refresh()
    })
    return this.pending
  }

  async stop(): Promise<void> {
    this.unwatch?.()
    this.stopped = true
    await this.pending
  }

  private async readChanges(): Promise<void> {
    while (this.dirty) {
      this.dirty = false
      try {
        const items = await this.store.replay(this.stream.session)
        if (this.stopped) return
        const history = foldThread(items)
        const fingerprint = JSON.stringify(history)
        // An unchanged disk read must not discard a just-accepted prompt
        // before Claude has appended its native user record.
        if (fingerprint !== this.lastHistory) {
          if (this.stream.replaceHistory(history)) this.lastHistory = fingerprint
        }
      } catch (error) {
        // Claude creates a new transcript only after the first user message.
        if (error instanceof SessionError && error.kind === 'session-not-found') continue
        this.stream.publish({ type: 'error', code: 'terminal.history',
          message: `Could not sync terminal messages: ${error instanceof Error ? error.message : String(error)}` })
      }
    }
  }
}

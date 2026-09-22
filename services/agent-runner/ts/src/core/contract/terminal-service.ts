/**
 * Provider-neutral port for the persistent terminals that host a harness
 * TUI (for example the Claude Code REPL). A terminal outlives any single
 * viewer: browser tabs attach and detach while the program keeps running,
 * and the runner can re-adopt a terminal that survived its own restart.
 *
 * Keys are opaque strings chosen by the harness (one per session). The
 * implementation owns process supervision, output fan-out and cleanup.
 */

import type { AgentEvent } from '../event/agent-event.js'
import type { EffortLevel } from './agent-provider.js'
import type { ContextUsage } from '../resource/context-usage.js'

export interface TerminalStatus {
  readonly updatedAt?: number
  readonly instanceId: string
  readonly sessionId: string
  readonly model: string
  readonly cwd: string
  readonly effort?: EffortLevel
  readonly profileId?: string
  readonly context: ContextUsage
  readonly costUsd?: number
  readonly apiDurationMs?: number
}

export interface TerminalActivity {
  readonly sessionId: string
  readonly instanceId: string
  readonly event: AgentEvent
  readonly cwd?: string
}

export interface TerminalTelemetry {
  readonly offset: number
  readonly events: readonly TerminalActivity[]
  readonly status?: TerminalStatus
}

export interface TerminalLaunchSpec {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
  readonly cols: number
  readonly rows: number
}

/** What a provider gets when asked to describe how its TUI should be launched. */
export type TerminalColorScheme = 'light' | 'dark'

export interface TerminalLaunchContext {
  readonly scratchDir: string
  readonly cols: number
  readonly rows: number
  /** Colour scheme of the viewer that launches the program, when known. */
  readonly colorScheme?: TerminalColorScheme
  /** Local runner endpoint receiving lifecycle events from the hosted program. */
  readonly eventsUrl?: string
}

export interface TerminalSessionState {
  readonly sessionId: string
  /** Identifies one launch; old hooks cannot finish a replacement process. */
  readonly instanceId: string
  readonly phase: 'idle' | 'running' | 'exited'
  readonly event: 'ready' | 'prompt' | 'stop' | 'failure' | 'exit'
  readonly cwd: string
  readonly prompt?: string
  readonly message?: string
  readonly updatedAt: number
  readonly source?: string
  readonly reason?: string
}

export interface TerminalTextDelta {
  readonly sessionId: string
  readonly turnId: string
  readonly messageId: string
  readonly index: number
  readonly text: string
  readonly final: boolean
}

export interface TerminalTextBatch {
  readonly offset: number
  readonly deltas: readonly TerminalTextDelta[]
}

export interface TerminalQuestion {
  readonly tool?: string
  readonly sessionId: string
  readonly instanceId: string
  readonly cwd: string
  readonly toolUseId?: string
  readonly input: Record<string, unknown>
}

export interface TerminalElicitation {
  readonly sessionId: string
  readonly instanceId: string
  readonly cwd: string
  readonly serverName: string
  readonly message: string
  readonly schema?: Record<string, unknown>
  readonly mode?: 'form' | 'url'
}

/** The provider owns its input-box readiness and paste/submit semantics. */
export interface TerminalInput {
  isAlive(): Promise<boolean>
  capture(): Promise<string>
  paste(text: string): Promise<void>
  sendKeys(keys: readonly string[]): Promise<void>
}

export interface TerminalInfo {
  readonly key: string
  /** True when the terminal was already running and was reused as-is. */
  readonly adopted: boolean
}

export interface TerminalAttachment {
  /**
   * Screen and terminal modes at attach time, including pending parser bytes.
   * Write this at cols/rows before subscribing to onOutput; output after the
   * snapshot is buffered until that subscription is installed.
   */
  readonly screen: Uint8Array
  readonly cols: number
  readonly rows: number
  onOutput(listener: (chunk: Uint8Array) => void): () => void
  onExit(listener: (reason: string) => void): () => void
  write(input: Uint8Array): Promise<void>
  resize(cols: number, rows: number): Promise<void>
  detach(): Promise<void>
}

export interface TerminalService {
  /**
   * Private directory that lives as long as the terminal, for launch files
   * the program must read from disk (for example settings that carry
   * credentials, which must stay out of the process argv).
   */
  scratchDir(key: string): Promise<string>
  /** Start the program when no live terminal exists for `key`; otherwise reuse it. */
  ensure(key: string, launch: TerminalLaunchSpec): Promise<TerminalInfo>
  /** Change the native session key without moving socket or hook files. */
  rebind(from: string, to: string): Promise<void>
  keyForTerminal(terminalId: string): Promise<string | undefined>
  /** Restart an idle program in its existing pane, retaining viewers. */
  restart(key: string, launch: TerminalLaunchSpec): Promise<void>
  isAlive(key: string): Promise<boolean>
  /** Resize to the viewer's dimensions before capturing its initial state. */
  attach(key: string, cols: number, rows: number): Promise<TerminalAttachment>
  /**
   * Deliver text as one bracketed paste into the program's input, without
   * pressing Enter. Used to hand a chat message to the hosted TUI as if the
   * user had pasted it; callers submit with `sendKeys(key, ['Enter'])`.
   */
  paste(key: string, text: string): Promise<void>
  /** Send named keys (tmux key names such as `Escape`, `Enter`, `C-c`). */
  sendKeys(key: string, keys: readonly string[]): Promise<void>
  /** Plain-text capture of the visible pane, one line per row. */
  capture(key: string): Promise<string>
  close(key: string): Promise<void>
  dispose(): Promise<void>
}

export type TerminalErrorKind =
  | 'not-found'
  | 'launch-failed'
  | 'backend-unavailable'
  | 'unsupported'
  | 'io-failure'

export class TerminalError extends Error {
  readonly kind: TerminalErrorKind

  constructor(kind: TerminalErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TerminalError'
    this.kind = kind
  }
}

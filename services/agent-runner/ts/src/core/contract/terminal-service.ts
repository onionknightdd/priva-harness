/**
 * Provider-neutral port for the persistent terminals that host a harness
 * TUI (for example the Claude Code REPL). A terminal outlives any single
 * viewer: browser tabs attach and detach while the program keeps running,
 * and the runner can re-adopt a terminal that survived its own restart.
 *
 * Keys are opaque strings chosen by the harness (one per session). The
 * implementation owns process supervision, output fan-out and cleanup.
 */

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
}

export interface TerminalInfo {
  readonly key: string
  /** True when the terminal was already running and was reused as-is. */
  readonly adopted: boolean
}

export interface TerminalAttachment {
  /**
   * Rendered screen at attach time (raw terminal bytes including colours
   * and a final cursor-position sequence) so a new viewer starts from the
   * current picture instead of a blank screen.
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
  isAlive(key: string): Promise<boolean>
  attach(key: string): Promise<TerminalAttachment>
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

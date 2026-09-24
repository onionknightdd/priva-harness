import { randomUUID } from 'node:crypto'

import type {
  AgentProvider,
  ProviderId,
  ProviderRunSpec,
  SessionRef,
  SessionTarget,
} from '../../core/contract/agent-provider.js'
import {
  TerminalError,
  type TerminalAttachment,
  type TerminalColorScheme,
  type TerminalCaptureOptions,
  type TerminalComposer,
  type TerminalService,
  type TerminalSessionState,
  type TerminalTextBatch,
  type TerminalTelemetry,
} from '../../core/contract/terminal-service.js'

export interface SessionTerminalsOptions {
  readonly providers: Readonly<Record<ProviderId, AgentProvider>>
  readonly terminals: TerminalService
}

export interface TerminalSize {
  readonly cols: number
  readonly rows: number
  readonly colorScheme?: TerminalColorScheme
  readonly eventsUrl?: string
}

export interface OpenedSessionTerminal {
  readonly session: SessionRef
  /** True when a terminal for this session was already running and was reused. */
  readonly adopted: boolean
}

/**
 * Session-scoped façade over the terminal port: one terminal per
 * `{provider, id}`, launched with the provider's own TUI description. The
 * session id is fixed before launch so the terminal can be found again by
 * reference alone, including after a runner restart.
 */
export class SessionTerminals {
  private readonly opening = new Map<string, Promise<OpenedSessionTerminal>>()

  constructor(private readonly options: SessionTerminalsOptions) {}

  static key(ref: SessionRef): string {
    return `${ref.provider}:${ref.id}`
  }

  async sessionForTerminal(terminalId: string): Promise<SessionRef | undefined> {
    const key = await this.options.terminals.keyForTerminal(terminalId)
    if (!key) return undefined
    const separator = key.indexOf(':')
    const provider = key.slice(0, separator)
    if (provider !== 'claude' && provider !== 'pi') throw new TerminalError('io-failure', 'Invalid terminal provider binding')
    return { provider, id: key.slice(separator + 1) }
  }

  rebind(from: SessionRef, to: SessionRef): Promise<void> {
    return this.options.terminals.rebind(SessionTerminals.key(from), SessionTerminals.key(to))
  }

  async open(target: SessionTarget, spec: ProviderRunSpec, size: TerminalSize): Promise<OpenedSessionTerminal> {
    const resolved = resolveTarget(target, spec.provider)
    const key = SessionTerminals.key(resolved.session)
    const pending = this.opening.get(key)
    if (pending !== undefined) return { ...await pending, adopted: true }

    // A reconnect can arrive before the first viewer finishes preflight.
    // Share that launch, including failures, instead of racing on its files/socket.
    const opening = this.openResolved(resolved.target, resolved.session, spec, size)
    this.opening.set(key, opening)
    try {
      return await opening
    } finally {
      this.opening.delete(key)
    }
  }

  private async openResolved(
    target: SessionTarget,
    session: SessionRef,
    spec: ProviderRunSpec,
    size: TerminalSize,
  ): Promise<OpenedSessionTerminal> {
    const provider = this.options.providers[spec.provider]
    if (provider.terminalLaunch === undefined) {
      throw new TerminalError('unsupported', `The ${spec.provider} harness has no terminal driver`)
    }
    const key = SessionTerminals.key(session)
    // A running terminal keeps the configuration it was launched with; the
    // provider is only asked to describe a launch when one is needed.
    if (await this.options.terminals.isAlive(key)) return { session, adopted: true }
    const scratchDir = await this.options.terminals.scratchDir(key)
    const launch = await provider.terminalLaunch(target, spec, { scratchDir, ...size })
    const info = await this.options.terminals.ensure(key, launch)
    return { session, adopted: info.adopted }
  }

  attach(ref: SessionRef, cols: number, rows: number): Promise<TerminalAttachment> {
    return this.options.terminals.attach(SessionTerminals.key(ref), cols, rows)
  }

  isAlive(ref: SessionRef): Promise<boolean> {
    return this.options.terminals.isAlive(SessionTerminals.key(ref))
  }

  async text(ref: SessionRef, offset: number): Promise<TerminalTextBatch> {
    return await this.options.providers[ref.provider].readTerminalText?.(await this.options.terminals.scratchDir(SessionTerminals.key(ref)), offset)
      ?? { offset, deltas: [] }
  }

  async state(ref: SessionRef): Promise<TerminalSessionState | undefined> {
    return this.options.providers[ref.provider].readTerminalState?.(await this.options.terminals.scratchDir(SessionTerminals.key(ref)))
  }

  promptText(ref: SessionRef, prompt: string): string {
    return this.options.providers[ref.provider].terminalPromptText?.(prompt) ?? prompt
  }

  async telemetry(ref: SessionRef, offset: number): Promise<TerminalTelemetry> {
    return await this.options.providers[ref.provider].readTerminalTelemetry?.(await this.options.terminals.scratchDir(SessionTerminals.key(ref)), offset) ?? { offset, events: [] }
  }

  async spec(ref: SessionRef): Promise<ProviderRunSpec | undefined> {
    return this.options.providers[ref.provider].readTerminalSpec?.(await this.options.terminals.scratchDir(SessionTerminals.key(ref)))
  }

  async recordState(ref: SessionRef, state: TerminalSessionState): Promise<void> {
    await this.options.providers[ref.provider].recordTerminalState?.(await this.options.terminals.scratchDir(SessionTerminals.key(ref)), state)
  }

  paste(ref: SessionRef, text: string): Promise<void> {
    return this.options.terminals.paste(SessionTerminals.key(ref), text)
  }

  async submit(ref: SessionRef, text: string, signal: AbortSignal, imagePaths?: readonly string[]): Promise<void> {
    const provider = this.options.providers[ref.provider]
    if (!provider.submitTerminalInput) throw new TerminalError('unsupported', `The ${ref.provider} terminal does not support chat input`)
    await provider.submitTerminalInput({
      isAlive: () => this.isAlive(ref), capture: () => this.capture(ref, { styled: true }),
      paste: (value) => this.paste(ref, value), sendKeys: (keys) => this.sendKeys(ref, keys),
    }, text, signal, imagePaths)
  }

  async completeCommand(ref: SessionRef, text: string, signal: AbortSignal): Promise<boolean> {
    return await this.options.providers[ref.provider].completeTerminalCommand?.({ isAlive: () => this.isAlive(ref), capture: () => this.capture(ref, { styled: true }),
      paste: (value) => this.paste(ref, value), sendKeys: (keys) => this.sendKeys(ref, keys) }, text, signal) ?? false
  }

  async configure(ref: SessionRef, spec: ProviderRunSpec, size: TerminalSize, signal: AbortSignal, forceRestart = false, canRestart = true): Promise<boolean> {
    const provider = this.options.providers[ref.provider]
    if (!provider.configureTerminal) return false
    const key = SessionTerminals.key(ref)
    const scratchDir = await this.options.terminals.scratchDir(key)
    const outcome = forceRestart ? 'restart' : await provider.configureTerminal({ isAlive: () => this.isAlive(ref), capture: () => this.capture(ref, { styled: true }),
      paste: (text) => this.paste(ref, text), sendKeys: (keys) => this.sendKeys(ref, keys) }, scratchDir, spec, signal)
    if (outcome !== 'restart') return false
    if (!canRestart) throw new TerminalError('unsupported', 'Finish or stop background tasks before changing the model profile or reloading resources')
    if (!provider.terminalLaunch) throw new TerminalError('unsupported', 'The terminal cannot be restarted')
    const launchTerminal = provider.terminalLaunch.bind(provider)
    const restarting = (async () => {
      const launch = await launchTerminal({ kind: 'resume', session: ref }, spec, { ...size, scratchDir })
      signal.throwIfAborted()
      await this.options.terminals.restart(key, launch)
      return { session: ref, adopted: true }
    })()
    this.opening.set(key, restarting)
    try { await restarting } finally { this.opening.delete(key) }
    return true
  }

  sendKeys(ref: SessionRef, keys: readonly string[]): Promise<void> {
    return this.options.terminals.sendKeys(SessionTerminals.key(ref), keys)
  }

  capture(ref: SessionRef, options?: TerminalCaptureOptions): Promise<string> {
    return this.options.terminals.capture(SessionTerminals.key(ref), options)
  }

  async composer(ref: SessionRef): Promise<TerminalComposer | undefined> {
    const provider = this.options.providers[ref.provider]
    return provider.parseTerminalComposer?.(await this.capture(ref, { styled: true }))
  }

  close(ref: SessionRef): Promise<void> {
    return this.options.terminals.close(SessionTerminals.key(ref))
  }

  dispose(): Promise<void> {
    return this.options.terminals.dispose()
  }
}

function resolveTarget(
  target: SessionTarget,
  provider: ProviderId,
): { target: SessionTarget; session: SessionRef } {
  switch (target.kind) {
    case 'new': {
      const id = target.sessionId ?? randomUUID()
      return { target: { kind: 'new', provider, sessionId: id }, session: { provider, id } }
    }
    case 'resume':
      if (target.session.provider !== provider) {
        throw new TerminalError('unsupported', `Cannot open a ${target.session.provider} session in the ${provider} terminal`)
      }
      return { target, session: target.session }
    case 'fork': {
      if (target.source.provider !== provider) throw new TerminalError('unsupported', 'Cannot fork a session from another provider')
      const id = target.sessionId ?? randomUUID()
      return { target: { ...target, sessionId: id }, session: { provider, id } }
    }
  }
}

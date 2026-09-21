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
  type TerminalService,
} from '../../core/contract/terminal-service.js'

export interface SessionTerminalsOptions {
  readonly providers: Readonly<Record<ProviderId, AgentProvider>>
  readonly terminals: TerminalService
}

export interface TerminalSize {
  readonly cols: number
  readonly rows: number
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
  constructor(private readonly options: SessionTerminalsOptions) {}

  static key(ref: SessionRef): string {
    return `${ref.provider}:${ref.id}`
  }

  async open(target: SessionTarget, spec: ProviderRunSpec, size: TerminalSize): Promise<OpenedSessionTerminal> {
    const provider = this.options.providers[spec.provider]
    if (provider.terminalLaunch === undefined) {
      throw new TerminalError('unsupported', `The ${spec.provider} harness has no terminal driver`)
    }
    const resolved = resolveTarget(target, spec.provider)
    const key = SessionTerminals.key(resolved.session)
    // A running terminal keeps the configuration it was launched with; the
    // provider is only asked to describe a launch when one is needed.
    if (await this.options.terminals.isAlive(key)) return { session: resolved.session, adopted: true }
    const scratchDir = await this.options.terminals.scratchDir(key)
    const launch = await provider.terminalLaunch(resolved.target, spec, { scratchDir, ...size })
    const info = await this.options.terminals.ensure(key, launch)
    return { session: resolved.session, adopted: info.adopted }
  }

  attach(ref: SessionRef): Promise<TerminalAttachment> {
    return this.options.terminals.attach(SessionTerminals.key(ref))
  }

  isAlive(ref: SessionRef): Promise<boolean> {
    return this.options.terminals.isAlive(SessionTerminals.key(ref))
  }

  paste(ref: SessionRef, text: string): Promise<void> {
    return this.options.terminals.paste(SessionTerminals.key(ref), text)
  }

  sendKeys(ref: SessionRef, keys: readonly string[]): Promise<void> {
    return this.options.terminals.sendKeys(SessionTerminals.key(ref), keys)
  }

  capture(ref: SessionRef): Promise<string> {
    return this.options.terminals.capture(SessionTerminals.key(ref))
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
    case 'fork':
      throw new TerminalError('unsupported', 'Forking into a terminal session is not supported yet')
  }
}

import { vi } from 'vitest'
import type { AgentProvider, ProviderRunSpec, SessionRef } from '../../src/core/contract/agent-provider.js'
import type { TerminalActivity, TerminalService, TerminalSessionState } from '../../src/core/contract/terminal-service.js'
import type { AgentEvent } from '../../src/core/event/agent-event.js'
import { InteractionCoordinator } from '../../src/core/run/interaction-coordinator.js'
import { userTurnFromText } from '../../src/core/run/user-turn.js'
import { SessionTerminals } from '../../src/harness/terminal/session-terminals.js'
import { FakeAgentProvider } from './fake-agent-provider.js'

interface NativeSession {
  readonly ref: SessionRef
  readonly instanceId: string
  readonly events: TerminalActivity[]
  readonly interactions: InteractionCoordinator
  readonly decisions: string[]
  spec: ProviderRunSpec
  state: TerminalSessionState
  runId?: string
  abort?: AbortController
}

/** Exercises the native command/state/telemetry ports without an SDK runtime. */
export function fakeStructuredTerminal(events: readonly AgentEvent[], claude: AgentProvider) {
  const sessions = new Map<string, NativeSession>()
  const alive = new Set<string>()
  const provider = new FakeAgentProvider('pi', events)
  let waitForPermissions = false
  const emit = (session: NativeSession, event: AgentEvent) => {
    session.events.push({ sessionId: session.ref.id, instanceId: session.instanceId, ...(session.runId ? { runId: session.runId } : {}), event })
  }
  const required = (scratch: string) => {
    const session = sessions.get(scratch)
    if (!session) throw new Error(`Unknown terminal: ${scratch}`)
    return session
  }
  const terminalProvider = Object.assign(provider, {
    structuredTerminal: true,
    terminalLaunch: vi.fn<NonNullable<AgentProvider['terminalLaunch']>>((target, spec, context) => {
      if (target.kind === 'fork') throw new Error('Pi does not support fork')
      const ref: SessionRef = { provider: 'pi', id: target.kind === 'resume' ? target.session.id : target.sessionId ?? 'native-session' }
      provider.targets.push(target)
      provider.specs.push(spec)
      const instanceId = `instance-${sessions.size}`
      const session: NativeSession = {
        ref, instanceId, spec, events: [], decisions: [],
        state: { sessionId: ref.id, instanceId, cwd: spec.cwd, phase: 'idle', event: 'ready', updatedAt: Date.now() },
        interactions: new InteractionCoordinator((event) => emit(session, event)),
      }
      sessions.set(context.scratchDir, session)
      return Promise.resolve({ command: 'fake-pi', args: [], cwd: spec.cwd, env: {}, cols: context.cols, rows: context.rows })
    }),
    configureTerminal: vi.fn<NonNullable<AgentProvider['configureTerminal']>>((_input, scratch, spec, signal) => {
      signal.throwIfAborted()
      required(scratch).spec = spec
      return Promise.resolve('applied')
    }),
    readTerminalState: (scratch: string) => Promise.resolve(sessions.get(scratch)?.state),
    readTerminalSpec: (scratch: string) => Promise.resolve(sessions.get(scratch)?.spec),
    readTerminalTelemetry: (scratch: string, offset: number) => {
      const session = sessions.get(scratch)
      return Promise.resolve({ offset: session?.events.length ?? 0, events: offset < 0 ? [] : session?.events.slice(offset) ?? [] })
    },
    submitTerminalTurn: vi.fn<NonNullable<AgentProvider['submitTerminalTurn']>>((scratch, text, signal, imagePaths, runId) => {
      signal.throwIfAborted()
      const session = required(scratch)
      session.runId = runId ?? 'native-run'
      const abort = new AbortController()
      session.abort = abort
      session.state = { ...session.state, phase: 'running', event: 'prompt', prompt: text, updatedAt: Date.now() }
      provider.turns.push({ ...userTurnFromText(text), ...(imagePaths ? { imagePaths } : {}) })
      emit(session, { type: 'run.started', model: session.spec.model })
      const complete = async () => {
        if (waitForPermissions) {
          const results = await Promise.all(['Bash', 'Write'].map((tool) => session.interactions.request({ kind: 'tool', tool }, { signal: abort.signal })))
          session.decisions.push(...results.map((result) => result.decision))
        }
        if (provider.gate) await provider.gate
        if (session.abort?.signal.aborted) return
        for (const event of events) emit(session, 'sessionId' in event ? { ...event, sessionId: session.ref.id } : event)
        session.state = { ...session.state, phase: 'idle', event: 'stop', updatedAt: Date.now() }
      }
      void complete()
      return Promise.resolve()
    }),
    abortTerminal: (scratch: string) => {
      const session = required(scratch)
      session.abort?.abort()
      session.interactions.cancelAll()
      emit(session, { type: 'run.aborted', sessionId: session.ref.id })
      session.state = { ...session.state, phase: 'idle', event: 'stop', updatedAt: Date.now() }
      return Promise.resolve()
    },
    respondTerminalInteraction: ((scratch, response) => {
      required(scratch).interactions.respond(response)
      return Promise.resolve()
    }) satisfies NonNullable<AgentProvider['respondTerminalInteraction']>,
  })
  const service: TerminalService = {
    scratchDir: (key) => Promise.resolve(key),
    ensure: (key) => { const adopted = alive.has(key); alive.add(key); return Promise.resolve({ key, adopted }) },
    isAlive: (key) => Promise.resolve(alive.has(key)),
    restart: (key) => { alive.add(key); return Promise.resolve() },
    close: (key) => { alive.delete(key); return Promise.resolve() },
    dispose: () => { for (const session of sessions.values()) session.abort?.abort(); alive.clear(); return Promise.resolve() },
    rebind: vi.fn(), keyForTerminal: vi.fn(), attach: vi.fn(), paste: vi.fn(), sendKeys: vi.fn(), capture: vi.fn(() => Promise.resolve('')),
  }
  return { provider: terminalProvider, service, sessions, terminals: new SessionTerminals({ providers: { claude, pi: terminalProvider }, terminals: service }),
    requirePermissions: () => { waitForPermissions = true } }
}

import { describe, expect, it } from 'vitest'

import type { TerminalAttachment, TerminalService } from '../../../../src/core/contract/terminal-service.js'
import { SessionTerminals } from '../../../../src/harness/terminal/session-terminals.js'
import { FakeAgentProvider } from '../../../support/fake-agent-provider.js'
import { testRunSpec } from '../../../support/run-spec.js'

class RecordingTerminalService implements TerminalService {
  readonly alive = new Set<string>()
  readonly ensured: string[] = []
  scratchDir(): Promise<string> { return Promise.resolve('/scratch') }
  async ensure(key: string) {
    // Yield so overlapping callers really overlap.
    await new Promise((resolve) => setTimeout(resolve, 5))
    const adopted = this.alive.has(key)
    this.alive.add(key)
    this.ensured.push(key)
    return { key, adopted }
  }
  isAlive(key: string): Promise<boolean> { return Promise.resolve(this.alive.has(key)) }
  attach(): Promise<TerminalAttachment> { return Promise.reject(new Error('not needed')) }
  paste(): Promise<void> { return Promise.resolve() }
  sendKeys(): Promise<void> { return Promise.resolve() }
  capture(): Promise<string> { return Promise.resolve('') }
  close(key: string): Promise<void> { this.alive.delete(key); return Promise.resolve() }
  dispose(): Promise<void> { return Promise.resolve() }
}

function setup() {
  const provider = new FakeAgentProvider('claude', [])
  let launches = 0
  provider.terminalLaunch = (_target, spec, context) => {
    launches += 1
    return Promise.resolve({ command: 'claude', args: [], cwd: spec.cwd, env: {}, cols: context.cols, rows: context.rows })
  }
  const service = new RecordingTerminalService()
  const terminals = new SessionTerminals({ providers: { claude: provider, pi: new FakeAgentProvider('pi', []) }, terminals: service })
  return { terminals, service, launches: () => launches }
}

describe('SessionTerminals', () => {
  it('shares one launch between concurrent opens of the same session', async () => {
    const { terminals, service, launches } = setup()
    const target = { kind: 'resume' as const, session: { provider: 'claude' as const, id: 'same' } }
    const [first, second, third] = await Promise.all([
      terminals.open(target, testRunSpec(), { cols: 80, rows: 24 }),
      terminals.open(target, testRunSpec(), { cols: 80, rows: 24 }),
      terminals.open(target, testRunSpec(), { cols: 80, rows: 24 }),
    ])
    expect(launches()).toBe(1)
    expect(service.ensured).toEqual(['claude:same'])
    expect(first).toEqual({ session: { provider: 'claude', id: 'same' }, adopted: false })
    expect(second.adopted).toBe(true)
    expect(third.adopted).toBe(true)
    // A later open sees the running terminal and asks for no new launch.
    expect(await terminals.open(target, testRunSpec(), { cols: 80, rows: 24 })).toMatchObject({ adopted: true })
    expect(launches()).toBe(1)
  })

  it('names a new session before launch and rejects harnesses without a terminal driver', async () => {
    const { terminals } = setup()
    const opened = await terminals.open({ kind: 'new', provider: 'claude' }, testRunSpec(), { cols: 80, rows: 24 })
    expect(opened.session.id).toMatch(/^[0-9a-f-]{36}$/u)
    await expect(terminals.open({ kind: 'new', provider: 'pi' }, testRunSpec({ provider: 'pi' }), { cols: 80, rows: 24 }))
      .rejects.toMatchObject({ kind: 'unsupported' })
  })
})

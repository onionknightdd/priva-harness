import { describe, expect, it, vi } from 'vitest'

import type { TerminalService } from '../../../../src/core/contract/terminal-service.js'
import { SessionTerminals } from '../../../../src/harness/terminal/session-terminals.js'
import { FakeAgentProvider } from '../../../support/fake-agent-provider.js'
import { testRunSpec } from '../../../support/run-spec.js'

function setup() {
  const provider = new FakeAgentProvider('claude', [])
  const launch = vi.fn<NonNullable<typeof provider.terminalLaunch>>().mockResolvedValue({
    command: 'claude', args: [], cwd: '/work/repo', env: {}, cols: 100, rows: 30,
  })
  provider.terminalLaunch = launch
  const service = {
    rebind: vi.fn<TerminalService['rebind']>(), keyForTerminal: vi.fn<TerminalService['keyForTerminal']>(), restart: vi.fn<TerminalService['restart']>(),
    scratchDir: vi.fn<TerminalService['scratchDir']>().mockResolvedValue('/scratch'),
    ensure: vi.fn<TerminalService['ensure']>().mockImplementation((key) => Promise.resolve({ key, adopted: false })),
    isAlive: vi.fn<TerminalService['isAlive']>().mockResolvedValue(false),
    attach: vi.fn<TerminalService['attach']>(),
    paste: vi.fn<TerminalService['paste']>(),
    sendKeys: vi.fn<TerminalService['sendKeys']>(),
    capture: vi.fn<TerminalService['capture']>(),
    close: vi.fn<TerminalService['close']>(),
    dispose: vi.fn<TerminalService['dispose']>(),
  } satisfies TerminalService
  const terminals = new SessionTerminals({
    providers: { claude: provider, pi: new FakeAgentProvider('pi', []) }, terminals: service,
  })
  const session = { provider: 'claude', id: 'same-session' } as const
  const open = () => terminals.open({ kind: 'resume', session }, testRunSpec(), { cols: 100, rows: 30 })
  return { terminals, session, launch, service, open }
}

describe('SessionTerminals.open', () => {
  it('runs preflight and launch once when several viewers open the same session together', async () => {
    const { open, launch, service, session } = setup()
    const results = await Promise.all([open(), open(), open()])
    expect(launch).toHaveBeenCalledTimes(1)
    expect(service.ensure).toHaveBeenCalledTimes(1)
    expect(results).toEqual([
      { session, adopted: false }, { session, adopted: true }, { session, adopted: true },
    ])
  })

  it('reports a shared launch failure and releases it so reconnect can try again', async () => {
    const { open, launch, service } = setup()
    const failure = new Error('launch failed')
    service.ensure.mockRejectedValueOnce(failure)
    const results = await Promise.allSettled([open(), open()])
    expect(results).toEqual([
      { status: 'rejected', reason: failure }, { status: 'rejected', reason: failure },
    ])
    expect(launch).toHaveBeenCalledTimes(1)
    await expect(open()).resolves.toMatchObject({ adopted: false })
    expect(launch).toHaveBeenCalledTimes(2)
  })

  it('checks whether a completed launch is still alive when a later viewer reconnects', async () => {
    const { open, launch, service } = setup()
    await open()
    service.isAlive.mockResolvedValueOnce(true)
    await expect(open()).resolves.toMatchObject({ adopted: true })
    expect(launch).toHaveBeenCalledTimes(1)
    await expect(open()).resolves.toMatchObject({ adopted: false })
    expect(launch).toHaveBeenCalledTimes(2)
  })
})

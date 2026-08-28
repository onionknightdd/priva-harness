import { describe, expect, it } from 'vitest'

import type { ProviderRunSpec, SessionTarget } from '../../../../src/core/contract/agent-provider.js'
import { PiProvider, type PiSessionFactory } from '../../../../src/provider/pi/pi-provider.js'
import type { PiAgentSession } from '../../../../src/provider/pi/pi-runtime.js'
import type { PiSessionEvent } from '../../../../src/provider/pi/pi-event-mapper.js'
import { FakeSessionStore } from '../../../support/fake-session-store.js'
import { testRunSpec } from '../../../support/run-spec.js'

describe('PiProvider', () => {
  it('opens new and resume targets through the session factory', async () => {
    const factory = new RecordingPiSessionFactory()
    const provider = new PiProvider(factory, new FakeSessionStore(), '/tmp/pi-agent')
    const spec = testRunSpec({ provider: 'pi', cwd: '/work/repo' })

    await provider.openSession({ kind: 'new', provider: 'pi' }, spec)
    await provider.openSession(
      { kind: 'resume', session: { provider: 'pi', id: 'pi-1' } },
      spec,
    )

    expect(factory.targets).toEqual([
      { kind: 'new', provider: 'pi' },
      { kind: 'resume', session: { provider: 'pi', id: 'pi-1' } },
    ])
    expect(factory.specs).toEqual([spec, spec])
  })

  it('rejects fork and resume of a non-pi session', async () => {
    const provider = new PiProvider(new RecordingPiSessionFactory(), new FakeSessionStore(), '/tmp/pi-agent')
    const spec = testRunSpec({ provider: 'pi' })

    await expect(provider.openSession(
      { kind: 'fork', source: { provider: 'pi', id: 'pi-1' } },
      spec,
    )).rejects.toThrow('Pi does not support fork')
    await expect(provider.openSession(
      { kind: 'resume', session: { provider: 'claude', id: 'sess-1' } },
      spec,
    )).rejects.toThrow('Pi provider cannot resume a non-pi session')
  })
})

class RecordingPiSessionFactory implements PiSessionFactory {
  readonly targets: SessionTarget[] = []
  readonly specs: ProviderRunSpec[] = []

  open(spec: ProviderRunSpec, target: SessionTarget): Promise<PiAgentSession> {
    this.specs.push(spec)
    this.targets.push(target)
    return Promise.resolve(new FakePiAgentSession())
  }
}

class FakePiAgentSession implements PiAgentSession {
  readonly sessionId = 'pi-1'
  readonly modelId = 'm'
  readonly isStreaming = false

  subscribe(listener: (event: PiSessionEvent) => void): () => void {
    void listener
    return () => undefined
  }

  prompt(): Promise<void> {
    return Promise.resolve()
  }

  followUp(): Promise<void> {
    return Promise.resolve()
  }

  steer(): Promise<void> {
    return Promise.resolve()
  }

  abort(): Promise<void> {
    return Promise.resolve()
  }

  dispose(): void {
    return undefined
  }
}

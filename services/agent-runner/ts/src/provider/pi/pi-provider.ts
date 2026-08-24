import type {
  AgentProvider,
  AgentRuntime,
  ProviderRunSpec,
  SessionTarget,
} from '../../core/contract/agent-provider.js'
import type { ProviderSessionStore } from '../../core/contract/provider-session-store.js'
import { PiRuntime, type PiAgentSession } from './pi-runtime.js'

export interface PiSessionFactory {
  open(spec: ProviderRunSpec): Promise<PiAgentSession>
}

export class PiProvider implements AgentProvider {
  readonly id = 'pi' as const
  readonly sessions: ProviderSessionStore

  constructor(
    private readonly sessionFactory: PiSessionFactory,
    store: ProviderSessionStore,
  ) {
    this.sessions = store
  }

  async openSession(target: SessionTarget, spec: ProviderRunSpec): Promise<AgentRuntime> {
    if (target.kind !== 'new') {
      throw new Error('Pi provider only supports new sessions in this slice')
    }
    return new PiRuntime(await this.sessionFactory.open(spec))
  }
}

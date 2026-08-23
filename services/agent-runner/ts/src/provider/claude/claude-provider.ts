import type {
  AgentProvider,
  AgentRuntime,
  ProviderRunSpec,
  SessionTarget,
} from '../../core/contract/agent-provider.js'
import type { ProviderSessionStore } from '../../core/contract/provider-session-store.js'
import { ClaudeRuntime } from './claude-runtime.js'
import { ClaudeSessionStore } from './session/claude-session-store.js'

export interface ClaudeProviderOptions {
  readonly globalConfigDir: string
  readonly sessions?: ProviderSessionStore
}

export class ClaudeProvider implements AgentProvider {
  readonly id = 'claude' as const
  readonly sessions: ProviderSessionStore

  constructor(private readonly options: ClaudeProviderOptions) {
    this.sessions = options.sessions ?? new ClaudeSessionStore({
      globalConfigDir: options.globalConfigDir,
    })
  }

  openSession(target: SessionTarget, spec: ProviderRunSpec): Promise<AgentRuntime> {
    if (target.kind === 'resume' && target.session.provider !== 'claude') {
      return Promise.reject(new Error('Claude provider cannot resume a non-claude session'))
    }
    if (target.kind === 'fork' && target.source.provider !== 'claude') {
      return Promise.reject(new Error('Claude provider cannot fork a non-claude session'))
    }
    return Promise.resolve(
      new ClaudeRuntime(spec, target, this.options.globalConfigDir),
    )
  }
}

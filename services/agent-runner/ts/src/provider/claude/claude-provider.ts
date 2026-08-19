import type {
  AgentProvider,
  AgentRuntime,
  ProviderRunSpec,
  SessionTarget,
} from '../../core/contract/agent-provider.js'
import { ClaudeRuntime } from './claude-runtime.js'

export interface ClaudeProviderOptions {
  readonly globalConfigDir: string
}

export class ClaudeProvider implements AgentProvider {
  readonly id = 'claude' as const

  constructor(private readonly options: ClaudeProviderOptions) {}

  openSession(target: SessionTarget, spec: ProviderRunSpec): Promise<AgentRuntime> {
    if (target.kind !== 'new') {
      return Promise.reject(new Error('Claude provider only supports new sessions in this slice'))
    }
    return Promise.resolve(new ClaudeRuntime(spec, this.options.globalConfigDir))
  }
}

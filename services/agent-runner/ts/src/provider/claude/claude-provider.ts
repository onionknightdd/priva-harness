import type {
  AgentProvider,
  AgentRuntime,
  ProviderRunSpec,
  SessionTarget,
} from '../../core/contract/agent-provider.js'
import { ClaudeRuntime } from './claude-runtime.js'

export class ClaudeProvider implements AgentProvider {
  readonly id = 'claude' as const

  openSession(target: SessionTarget, spec: ProviderRunSpec): Promise<AgentRuntime> {
    if (target.kind !== 'new') {
      return Promise.reject(new Error('Claude provider only supports new sessions in this slice'))
    }
    return Promise.resolve(new ClaudeRuntime(spec))
  }
}

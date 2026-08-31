import type {
  AgentProvider,
  AgentRuntime,
  ProviderRunSpec,
  SessionRef,
  SessionTarget,
  SlashCommandListRequest,
} from '../../core/contract/agent-provider.js'
import type { ProviderSessionStore } from '../../core/contract/provider-session-store.js'
import type { ContextUsage } from '../../core/resource/context-usage.js'
import type { SlashCommand } from '../../core/resource/slash-command.js'
import type { ToolDefinition } from '../../core/tool/define-tool.js'
import { measureClaudeContextUsage } from './claude-context-usage.js'
import { ClaudeRuntime } from './claude-runtime.js'
import { ClaudeSessionStore } from './session/claude-session-store.js'
import {
  listClaudeSlashCommands,
  type ClaudeSlashQueryStart,
} from './slash-commands.js'

export interface ClaudeProviderOptions {
  readonly globalConfigDir: string
  readonly sessions?: ProviderSessionStore
  readonly tools?: readonly ToolDefinition[]
  readonly startQuery?: ClaudeSlashQueryStart
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
      new ClaudeRuntime(
        spec,
        target,
        this.options.globalConfigDir,
        undefined,
        this.options.tools ?? [],
      ),
    )
  }

  listSlashCommands(request: SlashCommandListRequest): Promise<readonly SlashCommand[]> {
    if (request.spec === undefined) {
      return Promise.reject(new Error('Claude slash command listing requires a model profile'))
    }
    return listClaudeSlashCommands({
      spec: { ...request.spec, cwd: request.cwd, provider: 'claude' },
      globalConfigDir: this.options.globalConfigDir,
      tools: this.options.tools ?? [],
      ...(this.options.startQuery === undefined ? {} : { startQuery: this.options.startQuery }),
    })
  }

  measureContextUsage(session: SessionRef, spec: ProviderRunSpec): Promise<ContextUsage> {
    if (session.provider !== 'claude') {
      return Promise.reject(new Error('Claude provider cannot measure a non-claude session'))
    }
    return measureClaudeContextUsage({
      spec,
      sessionId: session.id,
      globalConfigDir: this.options.globalConfigDir,
      tools: this.options.tools ?? [],
    })
  }
}

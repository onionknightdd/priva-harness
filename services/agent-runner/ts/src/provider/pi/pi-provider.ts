import { isDeepStrictEqual } from 'node:util'
import type {
  AgentProvider,
  AgentRuntime,
  ProviderRunSpec,
  SessionTarget,
  SlashCommandListRequest,
} from '../../core/contract/agent-provider.js'
import type { ProviderSessionStore } from '../../core/contract/provider-session-store.js'
import type { InteractionResponse } from '../../core/resource/interaction.js'
import { DEFAULT_CONTEXT_WINDOW } from '../../core/resource/model-context.js'
import type { TerminalInput, TerminalLaunchContext, TerminalLaunchSpec, TerminalSessionState, TerminalStatus } from '../../core/contract/terminal-service.js'
import { piTerminalLaunch } from './pi-terminal-launch.js'
import { readPiTerminalJson, readPiTerminalTelemetry, requestPiTerminal } from './pi-terminal-protocol.js'
import type { SlashCommand } from '../../core/resource/slash-command.js'
import { PiRuntime, type PiAgentSession } from './pi-runtime.js'
import { listPiSlashCommands } from './slash-commands.js'

export interface PiSessionFactory {
  open(spec: ProviderRunSpec, target: SessionTarget): Promise<PiAgentSession>
}

export class PiProvider implements AgentProvider {
  readonly id = 'pi' as const
  readonly structuredTerminal = true
  readonly sessions: ProviderSessionStore

  constructor(
    private readonly sessionFactory: PiSessionFactory,
    store: ProviderSessionStore,
    private readonly agentDir: string,
  ) {
    this.sessions = store
  }

  async openSession(target: SessionTarget, spec: ProviderRunSpec): Promise<AgentRuntime> {
    if (target.kind === 'resume' && target.session.provider !== 'pi') {
      throw new Error('Pi provider cannot resume a non-pi session')
    }
    if (target.kind === 'fork') {
      throw new Error('Pi does not support fork')
    }
    return new PiRuntime(
      await this.sessionFactory.open(spec, target),
      spec.queueBehavior ?? 'follow-up',
    )
  }

  terminalLaunch(target: SessionTarget, spec: ProviderRunSpec, context: TerminalLaunchContext): Promise<TerminalLaunchSpec> {
    if (target.kind === 'fork') throw new Error('Pi does not support fork')
    if (target.kind === 'resume' && target.session.provider !== 'pi') throw new Error('Pi provider cannot resume a non-pi session')
    return piTerminalLaunch(this.agentDir, target, spec, context)
  }

  readTerminalState(scratchDir: string): Promise<TerminalSessionState | undefined> {
    return readPiTerminalJson(scratchDir, 'state')
  }

  readTerminalStatus(scratchDir: string): Promise<TerminalStatus | undefined> {
    return readPiTerminalJson(scratchDir, 'status')
  }

  readTerminalSpec(scratchDir: string): Promise<ProviderRunSpec | undefined> {
    return readPiTerminalJson(scratchDir, 'spec')
  }

  readTerminalTelemetry(scratchDir: string, offset: number) {
    return readPiTerminalTelemetry(scratchDir, offset)
  }

  submitTerminalTurn(scratchDir: string, text: string, signal: AbortSignal, imagePaths?: readonly string[], runId?: string): Promise<void> {
    return requestPiTerminal(scratchDir, { type: 'prompt', text,
      ...(imagePaths === undefined ? {} : { imagePaths: [...imagePaths] }),
      ...(runId === undefined ? {} : { runId }),
    }, signal)
  }

  abortTerminal(scratchDir: string): Promise<void> {
    return requestPiTerminal(scratchDir, { type: 'abort' })
  }

  respondTerminalInteraction(scratchDir: string, response: InteractionResponse): Promise<void> {
    return requestPiTerminal(scratchDir, { type: 'respond', response })
  }

  stopTerminalTask(scratchDir: string, taskId: string): Promise<void> {
    return requestPiTerminal(scratchDir, { type: 'stop-task', taskId })
  }

  async configureTerminal(input: TerminalInput, scratchDir: string, spec: ProviderRunSpec, signal: AbortSignal): Promise<'applied' | 'restart'> {
    signal.throwIfAborted()
    const previous = await this.readTerminalSpec(scratchDir)
    if (!previous || !await input.isAlive() || !isDeepStrictEqual(terminalRuntimeConfig(previous), terminalRuntimeConfig(spec))) return 'restart'
    const status = await this.readTerminalStatus(scratchDir)
    const contextWindow = spec.contextWindow ?? DEFAULT_CONTEXT_WINDOW
    // A restarted host can restore a native thinking level different from its
    // launch spec. Compare the effective selection before acknowledging a change.
    if (status?.model !== spec.model || status.context.limit !== contextWindow
      || (spec.effort !== undefined && status.effort !== spec.effort)) {
      await requestPiTerminal(scratchDir, { type: 'configure', model: spec.model,
        contextWindow,
        ...(spec.effort === undefined ? {} : { effort: spec.effort }),
      }, signal)
    }
    return 'applied'
  }

  listSlashCommands(request: SlashCommandListRequest): Promise<readonly SlashCommand[]> {
    return listPiSlashCommands({
      cwd: request.cwd,
      agentDir: this.agentDir,
    })
  }
}

function terminalRuntimeConfig(spec: ProviderRunSpec) {
  return { cwd: spec.cwd, provider: spec.provider, profileId: spec.profileId, baseUrl: spec.baseUrl, authToken: spec.authToken,
    imageTools: spec.imageTools, classifier: spec.classifier, systemInstructions: spec.systemInstructions,
    visualizeMode: spec.visualizeMode,
    queueBehavior: spec.queueBehavior, runMode: spec.runMode, promptSuggestions: spec.promptSuggestions }
}

import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createAgentSession,
  ModelRuntime,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'

import type { ProviderRunSpec, SessionTarget } from '../../core/contract/agent-provider.js'
import type { ToolDefinition } from '../../core/tool/define-tool.js'
import { imageToolsFromSpec } from '../../core/tool/image-tool-shared.js'
import { piSessionNeedsModelSwitch, resolvePiSessionOptions } from './pi-models-config.js'
import { piSessionBucketDir } from './pi-paths.js'
import { createPiSessionManager } from './pi-session-open.js'
import type { PiSessionFactory } from './pi-provider.js'
import type { PiAgentSession } from './pi-runtime.js'
import type { PiSessionEvent } from './pi-event-mapper.js'
import { compilePiCustomTools } from './tools/compile-custom-tools.js'
import { PiWorkflows } from './pi-workflows.js'
import { createPiResourceLoader } from './pi-resource-loader.js'

export class CodingAgentSessionFactory implements PiSessionFactory {
  constructor(
    private readonly agentDir: string,
    private readonly tools: readonly ToolDefinition[] = [],
  ) {}

  async open(spec: ProviderRunSpec, target: SessionTarget): Promise<PiAgentSession> {
    const options = resolvePiSessionOptions(spec)
    const runDir = join(tmpdir(), 'pi-model-runtime', randomUUID())
    await mkdir(runDir, { recursive: true, mode: 0o700 })
    const authPath = join(runDir, 'auth.json')
    const modelsPath = join(runDir, 'models.json')
    await writeFile(authPath, '{}\n', { mode: 0o600 })
    await writeFile(
      modelsPath,
      `${JSON.stringify(options.modelsConfig, null, 2)}\n`,
      { mode: 0o600 },
    )

    const sessionDir = piSessionBucketDir(this.agentDir, spec.cwd)
    await mkdir(sessionDir, { recursive: true, mode: 0o700 })

    const progressSink: { emit?: (chunk: string) => void } = {}
    let workflows: PiWorkflows | undefined
    let opened: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined

    try {
      const modelRuntime = await ModelRuntime.create({ authPath, modelsPath })
      const model = modelRuntime.getModel(options.providerId, options.modelId)
      if (model === undefined) {
        throw new Error(`Unknown model ${spec.model}`)
      }

      const sessionManager = await createPiSessionManager(this.agentDir, spec, target)
      const settingsManager = SettingsManager.create(spec.cwd, this.agentDir)
      workflows = new PiWorkflows({ cwd: spec.cwd, agentDir: this.agentDir,
        sessionId: sessionManager.getSessionId(), modelRuntime,
        providerId: options.providerId, modelId: options.modelId })
      const { session } = await createAgentSession({
        cwd: spec.cwd,
        agentDir: this.agentDir,
        model,
        modelRuntime,
        sessionManager,
        settingsManager,
        resourceLoader: await createPiResourceLoader(spec.cwd, this.agentDir, settingsManager),
        thinkingLevel: 'off',
        customTools: [workflows.tool, ...compilePiCustomTools(this.tools, {
          cwd: spec.cwd, session: { provider: 'pi', id: sessionManager.getSessionId() },
          signal: new AbortController().signal, profile: imageToolsFromSpec(spec),
          emitProgress: (chunk) => progressSink.emit?.(chunk),
        })],
      })

      opened = session
      await session.bindExtensions({ mode: 'rpc' })

      if (
        target.kind === 'resume'
        && piSessionNeedsModelSwitch(session.model, options.providerId, options.modelId)
      ) {
        await session.setModel(model)
      }

      return new SdkPiAgentSession(
        session,
        options.modelId,
        runDir,
        progressSink,
        modelRuntime,
        options.providerId,
        workflows,
      )
    } catch (error) {
      workflows?.dispose()
      try {
        if (opened !== undefined) {
          try { await opened.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' }) } finally { opened.dispose() }
        }
      } finally {
        await rm(runDir, { recursive: true, force: true })
      }
      throw error
    }
  }
}

class SdkPiAgentSession implements PiAgentSession {
  private currentModelId: string
  private closing: Promise<void> | undefined

  constructor(
    private readonly session: Awaited<ReturnType<typeof createAgentSession>>['session'],
    modelId: string,
    private readonly runDir: string,
    private readonly progressSink: { emit?: (chunk: string) => void } = {},
    private readonly modelRuntime: ModelRuntime,
    private readonly providerId: string,
    private readonly workflows: PiWorkflows,
  ) {
    this.currentModelId = modelId
  }

  get modelId(): string {
    return this.currentModelId
  }

  async setRunModel(modelId: string): Promise<void> {
    if (modelId === this.currentModelId) return
    const model = this.modelRuntime.getModel(this.providerId, modelId)
    if (model === undefined) {
      throw new Error(`Unknown model ${modelId}`)
    }
    await this.session.setModel(model)
    this.workflows.setModel(modelId)
    this.currentModelId = modelId
  }

  bindProgressEmit(emit: ((chunk: string) => void) | undefined): void {
    if (emit === undefined) {
      delete this.progressSink.emit
      return
    }
    this.progressSink.emit = emit
  }

  get sessionId(): string {
    return this.session.sessionId
  }

  get isStreaming(): boolean {
    return this.session.isStreaming
  }

  subscribe(listener: (event: PiSessionEvent) => void): () => void {
    const stopWorkflow = this.workflows.subscribe(listener)
    const stopSession = this.session.subscribe(listener)
    return () => { stopWorkflow(); stopSession() }
  }

  prompt(text: string): Promise<void> {
    return this.session.prompt(text)
  }

  followUp(text: string): Promise<void> {
    return this.session.followUp(text)
  }

  steer(text: string): Promise<void> {
    return this.session.steer(text)
  }

  compact(customInstructions?: string): Promise<void> {
    return this.session.compact(customInstructions).then(() => undefined)
  }

  waitForWorkflows(): Promise<void> { return this.workflows.waitForIdle() }

  abort(): Promise<void> {
    this.workflows.abort()
    return this.session.abort()
  }

  getContextUsage(): { tokens: number | null; contextWindow: number } | undefined {
    return this.session.getContextUsage()
  }

  dispose(): Promise<void> {
    this.closing ??= this.close()
    return this.closing
  }

  private async close(): Promise<void> {
    this.workflows.dispose()
    try {
      await this.session.abort()
      await this.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
    } finally {
      this.session.dispose()
      await rm(this.runDir, { recursive: true, force: true })
    }
  }
}

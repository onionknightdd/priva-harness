import { PiInteractions } from './pi-interactions.js'
import type { InteractionResponse } from '../../core/resource/interaction.js'
import { createEventBus, type EventBus } from '@earendil-works/pi-coding-agent'
import { asRecord, stringField } from '../../core/event/json-record.js'
import { taskStatus } from '../../core/resource/background-task.js'
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

    const interactions = new PiInteractions()
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
      const eventBus = createEventBus()
      const { session } = await createAgentSession({
        cwd: spec.cwd,
        agentDir: this.agentDir,
        model,
        modelRuntime,
        sessionManager,
        settingsManager,
        resourceLoader: await createPiResourceLoader(spec.cwd, this.agentDir, settingsManager, eventBus),
        thinkingLevel: 'off',
        customTools: [workflows.tool, interactions.tool, ...compilePiCustomTools(this.tools, {
          cwd: spec.cwd, session: { provider: 'pi', id: sessionManager.getSessionId() },
          signal: new AbortController().signal, profile: imageToolsFromSpec(spec),
          emitProgress: (chunk) => progressSink.emit?.(chunk),
        })],
      })

      opened = session
      return new SdkPiAgentSession(
        session,
        options.modelId,
        runDir,
        progressSink,
        modelRuntime,
        options.providerId,
        workflows,
        eventBus,
        interactions,
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
  private initialized: Promise<void> | undefined

  constructor(
    private readonly session: Awaited<ReturnType<typeof createAgentSession>>['session'],
    modelId: string,
    private readonly runDir: string,
    private readonly progressSink: { emit?: (chunk: string) => void } = {},
    private readonly modelRuntime: ModelRuntime,
    private readonly providerId: string,
    private readonly workflows: PiWorkflows,
    private readonly eventBus: EventBus,
    private readonly interactions: PiInteractions,
  ) {
    this.currentModelId = modelId
    workflows.bindResultDelivery((workflow, result) => session.sendCustomMessage({
      customType: 'workflow-notification', display: false,
      content: `Workflow ${workflow.name ?? workflow.workflowRunId} ${workflow.status}. ${workflow.summary ?? ''}\n${result}`,
      details: { ...workflow, result },
    }, { deliverAs: 'followUp', triggerTurn: true }))
  }

  initialize(): Promise<void> {
    // Startup hooks can ask questions. Bind only after the runtime has subscribed
    // and published run.started, so the first dialog can be answered as well.
    this.initialized ??= (async () => {
      await this.session.bindExtensions({ mode: 'rpc', uiContext: this.interactions.ui(this.session.extensionRunner.getUIContext()) })
      if (piSessionNeedsModelSwitch(this.session.model, this.providerId, this.currentModelId)) {
        const model = this.modelRuntime.getModel(this.providerId, this.currentModelId)
        if (!model) throw new Error(`Unknown model ${this.currentModelId}`)
        await this.session.setModel(model)
      }
    })()
    return this.initialized
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
    const stopInteractions = this.interactions.subscribe(listener)
    const stopWorkflow = this.workflows.subscribe(listener)
    const stopSession = this.session.subscribe(listener)
    const stopAgents = ['started', 'completed', 'failed'].map((phase) => this.eventBus.on(`subagents:${phase}`, (value) => {
      const raw = asRecord(value) ?? {}
      const taskId = stringField(raw, 'id')
      if (!taskId) return
      listener({ type: phase === 'started' ? 'task.updated' : 'task.notification', task: {
        taskId, kind: 'agent', status: phase === 'started' ? 'running' : raw['status'] === 'error' ? 'failed' : raw['status'] === 'aborted' ? 'cancelled' : taskStatus(raw['status'] ?? phase),
        ...(typeof raw['description'] === 'string' ? { description: raw['description'] } : {}),
        ...(typeof raw['error'] === 'string' ? { summary: raw['error'] } : {}),
      } })
    }))
    return () => { stopInteractions(); stopWorkflow(); stopSession(); for (const stop of stopAgents) stop() }
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

  respondPermission(response: InteractionResponse): void { this.interactions.respond(response) }

  abort(): Promise<void> {
    this.interactions.cancel()
    return this.session.abort()
  }

  async stopTask(taskId: string): Promise<void> {
    if (this.workflows.stop(taskId)) return
    await new Promise<void>((resolve, reject) => {
      const requestId = randomUUID()
      const timer = setTimeout(() => { off(); reject(new Error('Subagent stop timed out')) }, 5000)
      const off = this.eventBus.on(`subagents:rpc:stop:reply:${requestId}`, (reply) => {
        clearTimeout(timer); off()
        const result = asRecord(reply)
        if (result?.['success'] === true) resolve()
        else reject(new Error(stringField(result ?? {}, 'error') ?? 'Subagent stop failed'))
      })
      this.eventBus.emit('subagents:rpc:stop', { requestId, agentId: taskId })
    })
  }

  getContextUsage(): { tokens: number | null; contextWindow: number } | undefined {
    return this.session.getContextUsage()
  }

  dispose(): Promise<void> {
    this.closing ??= this.close()
    return this.closing
  }

  private async close(): Promise<void> {
    this.interactions.cancel()
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

import { asRecord } from '../../core/event/json-record.js'
import { taskStatus } from '../../core/resource/background-task.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { ModelRegistry, SessionManager, SettingsManager, type ModelRuntime } from '@earendil-works/pi-coding-agent'
import { WorkflowAgent, WorkflowManager, createWorkflowTool } from '@quintinshaw/pi-dynamic-workflows'
import type { WorkflowState } from '../../core/resource/workflow.js'
import type { PiSessionEvent } from './pi-event-mapper.js'
import { piWorkflowState, internalTool } from './pi-workflow-data.js'
import { piWorkflowRoot, savePiWorkflow, loadPiWorkflow, type PiWorkflowTranscript } from './pi-workflow-files.js'

/** Owns plugin executions for one host session, including detached tool calls. */
export class PiWorkflows {
  readonly tool: ReturnType<typeof createWorkflowTool>
  private readonly manager: WorkflowManager
  private readonly toolContext = new AsyncLocalStorage<string>()
  private readonly recordingContext = new AsyncLocalStorage<{ manager: SessionManager; id: string; start: number }>()
  private readonly toolIds = new Map<string, string>()
  private readonly pending = new Set<string>()
  private readonly states = new Map<string, WorkflowState>()
  private readonly transcripts = new Map<string, Record<string, PiWorkflowTranscript[]>>()
  private readonly threads = new Map<string, SessionManager>()
  private readonly listeners = new Set<(event: PiSessionEvent) => void>()
  private readonly startedAt = new Map<string, number>()
  private readonly endedAt = new Map<string, number>()
  private readonly finishedAt = new Map<string, number>()
  private writes: Promise<void> = Promise.resolve()
  private writeError: unknown
  private disposed = false
  private readonly background = new Set<string>()
  private readonly delivered = new Set<string>()
  private resultDelivery: ((state: WorkflowState, result: string) => Promise<void>) | undefined

  constructor(private readonly options: { cwd: string; agentDir: string; sessionId: string; modelRuntime: ModelRuntime; providerId: string; modelId: string }) {
    const registry = new ModelRegistry(options.modelRuntime)
    const runner: Pick<WorkflowAgent, 'run'> = {
      run: (prompt, opts = {}) => {
        // Each call has its own raw transcript. Named threads reuse their session,
        // while each agent's history callback carries its exact journal identity.
        const threadKey = opts.thread ? `${opts.sessionName ?? ''}:${opts.thread}` : undefined
        const recording = (threadKey ? this.threads.get(threadKey) : undefined)
          ?? SessionManager.create(options.cwd, join(piWorkflowRoot(options.agentDir, options.sessionId), 'agents'))
        if (threadKey) this.threads.set(threadKey, recording)
        const leaf = recording.getLeafId()
        const capture = { manager: recording, id: randomUUID(), start: recording.getEntries().length }
        const model = options.modelRuntime.getModel(options.providerId, options.modelId)
        if (!model) throw new Error(`Unknown workflow model ${options.modelId}`)
        const worker = new WorkflowAgent({
          cwd: options.cwd,
          modelRegistry: registry,
          mainModel: `${options.providerId}/${options.modelId}`,
          session: {
            agentDir: options.agentDir,
            model,
            thinkingLevel: 'off',
            sessionManager: recording,
            modelRuntime: options.modelRuntime,
            settingsManager: SettingsManager.inMemory(),
          },
        })
        const { thread: _thread, ...runOptions } = opts
        void _thread
        return worker.run(prompt, {
          ...runOptions,
          onHistory: (history) => this.recordingContext.run(capture, () => opts.onHistory?.(history)),
        }).catch((error: unknown) => {
          if (threadKey) {
            if (leaf) recording.branch(leaf)
            else recording.resetLeaf()
          }
          throw error
        })
      },
    }
    this.manager = new WorkflowManager({
      cwd: options.cwd, sessionId: options.sessionId, agent: runner, modelRegistry: registry,
      mainModel: `${options.providerId}/${options.modelId}`,
    })
    for (const name of ['phase', 'agentStart', 'agentModel', 'agentUsage', 'agentHistory', 'agentEnd', 'tokenUsage', 'complete', 'paused', 'error']) {
      this.manager.on(name, (event: { runId: string; id?: string; agentId?: number }) => {
        const toolId = this.toolIds.get(event.runId) ?? this.toolContext.getStore()
        if (!toolId || this.disposed) return
        this.toolIds.set(event.runId, toolId)
        this.pending.add(event.runId)
        if (name === 'agentStart' && event.id) this.startedAt.set(event.id, Date.now())
        if (name === 'agentEnd' && event.id) this.endedAt.set(event.id, Date.now())
        if (['complete', 'paused', 'error'].includes(name)) this.finishedAt.set(event.runId, Date.now())
        const recording = this.recordingContext.getStore()
        if (name === 'agentHistory' && event.id && recording) {
          const file = recording.manager.getSessionFile()
          if (file) {
            const files = this.transcripts.get(event.runId) ?? {}
            const paths = files[event.id] ?? []
            const entries = recording.manager.getEntries().slice(recording.start)
            const toolCalls = entries.reduce((count, entry) => entry.type === 'message' && entry.message.role === 'assistant'
              ? count + entry.message.content.filter((b) => b.type === 'toolCall' && !internalTool(b.name)).length : count, 0)
            const transcript = { id: recording.id, file, entryIds: entries.map((entry) => entry.id), toolCalls }
            const index = paths.findIndex((item) => item.id === recording.id)
            if (index === -1) paths.push(transcript)
            else paths[index] = transcript
            files[event.id] = paths
            this.transcripts.set(event.runId, files)
          }
        }
        this.publish(event.runId)
      })
    }
    const tool = createWorkflowTool({ cwd: options.cwd, manager: this.manager })
    this.tool = {
      ...tool,
      execute: (id, args, signal, onUpdate, context) => this.toolContext.run(id, async () => {
        if (args.resumeFromRunId) {
          const saved = await loadPiWorkflow(options.agentDir, options.sessionId, args.resumeFromRunId)
          if (!saved || this.manager.getPersistence().load(args.resumeFromRunId)?.sessionId !== options.sessionId) {
            throw new Error('Workflow does not belong to this session')
          }
          this.states.set(args.resumeFromRunId, saved.state)
          this.transcripts.set(args.resumeFromRunId, Object.fromEntries(Object.entries(saved.transcripts).map(([key, value]) => [key, [...value]])))
          this.toolIds.set(args.resumeFromRunId, id)
          this.finishedAt.delete(args.resumeFromRunId)
        }
        const result = await tool.execute(id, args, signal, onUpdate, context)
        const runId = asRecord(result.details)?.['runId']
        if (typeof runId === 'string' && asRecord(result.details)?.['background'] === true) this.background.add(runId)
        if (typeof runId === 'string') { this.toolIds.set(runId, id); this.pending.add(runId); this.publish(runId) }
        return result
      }),
    }
  }

  bindResultDelivery(deliver: (state: WorkflowState, result: string) => Promise<void>): void { this.resultDelivery = deliver }

  stop(taskId: string): boolean {
    if (!this.manager.getRun(taskId)) return false
    this.manager.stop(taskId)
    this.publish(taskId)
    return true
  }

  setModel(modelId: string): void {
    this.options.modelId = modelId
    this.manager.setMainModel(`${this.options.providerId}/${modelId}`)
  }

  subscribe(listener: (event: PiSessionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async flush(): Promise<void> {
    await this.writes
    if (this.writeError !== undefined) throw this.writeError instanceof Error ? this.writeError : new Error('Could not persist Pi workflow', { cause: this.writeError })
  }

  abort(): void {
    for (const id of this.pending) this.manager.stop(id)
  }

  dispose(): void {
    this.abort()
    this.disposed = true
    this.listeners.clear()
    this.manager.removeAllListeners()
    this.threads.clear()
  }

  private publish(runId: string): void {
    const run = this.manager.getRun(runId)
    const toolId = this.toolIds.get(runId)
    if (!run || !toolId) return
    const raw = {
      ...run.snapshot, runId, status: run.status,
      durationMs: Math.max(0, (this.finishedAt.get(runId) ?? Date.now()) - run.startedAt.getTime()),
      agents: run.snapshot.agents.map((a) => ({ ...a,
        startedAt: this.startedAt.get(a.callId ?? ''), endedAt: this.endedAt.get(a.callId ?? ''),
      })),
    }
    let state = piWorkflowState(toolId, raw, this.states.get(runId))
    state = { ...state, agents: state.agents.map((agent) => {
      const transcripts = this.transcripts.get(runId)?.[agent.agentId ?? '']
      if (!transcripts) return agent
      const toolCalls = transcripts.reduce((count, transcript) => count + (transcript.toolCalls ?? 0), 0)
      return { ...agent, toolCalls }
    }) }
    if (state.agents.every((a) => a.toolCalls !== undefined)) state = { ...state, totalToolCalls: state.agents.reduce((sum, a) => sum + (a.toolCalls ?? 0), 0) }
    this.states.set(runId, state)
    for (const listener of this.listeners) listener({ type: 'workflow_progress', workflow: state })
    const terminal = ['completed', 'failed', 'cancelled'].includes(state.status)
    if (terminal) this.pending.delete(runId)
    if (this.background.has(runId)) for (const listener of this.listeners) listener({
      type: terminal ? 'task.notification' : 'task.updated', task: {
        taskId: runId, toolUseId: toolId, kind: 'workflow', status: taskStatus(state.status),
        ...(state.name ? { description: state.name } : {}), ...(state.summary ? { summary: state.summary } : {}),
      },
    })
    if (this.background.has(runId) && terminal && !this.delivered.has(runId) && this.resultDelivery) {
      this.delivered.add(runId)
      const result = run.result?.result
      void this.resultDelivery(state, (typeof result === 'string' ? result : result === undefined ? '' : JSON.stringify(result)).slice(0, 8000)).catch((error: unknown) => {
        for (const listener of this.listeners) listener({ type: 'background_error', errorMessage: error instanceof Error ? error.message : String(error) })
      })
    }
    // Serialize snapshots; an older write must never overwrite terminal state.
    const record = structuredClone({ sessionId: this.options.sessionId, state, transcripts: this.transcripts.get(runId) ?? {} })
    this.writes = this.writes.then(() => savePiWorkflow(this.options.agentDir, record)).catch((error: unknown) => { this.writeError = error })
  }
}

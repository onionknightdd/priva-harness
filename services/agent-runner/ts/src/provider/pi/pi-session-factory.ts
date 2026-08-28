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
import type { ToolDefinition, ToolImageDelta } from '../../core/tool/define-tool.js'
import { imageToolsFromSpec } from '../../core/tool/image-tool-shared.js'
import { buildPiModelsConfig } from './pi-models-config.js'
import { piSessionBucketDir } from './pi-paths.js'
import { createPiSessionManager } from './pi-session-open.js'
import type { PiSessionFactory } from './pi-provider.js'
import type { PiAgentSession } from './pi-runtime.js'
import type { PiSessionEvent } from './pi-event-mapper.js'
import { compilePiCustomTools } from './tools/compile-custom-tools.js'

export class CodingAgentSessionFactory implements PiSessionFactory {
  constructor(
    private readonly agentDir: string,
    private readonly tools: readonly ToolDefinition[] = [],
  ) {}

  async open(spec: ProviderRunSpec, target: SessionTarget): Promise<PiAgentSession> {
    const providerId = spec.profileId ?? 'custom'
    const runDir = join(tmpdir(), 'pi-model-runtime', randomUUID())
    await mkdir(runDir, { recursive: true, mode: 0o700 })
    const authPath = join(runDir, 'auth.json')
    const modelsPath = join(runDir, 'models.json')
    await writeFile(authPath, '{}\n', { mode: 0o600 })
    // Overlay the runner model profile as a native Pi custom provider for this
    // turn only. agentDir keeps Pi's own files; credentials stay in bambuddy.settings.json.
    await writeFile(
      modelsPath,
      `${JSON.stringify(buildPiModelsConfig(spec.baseUrl, spec.model, providerId), null, 2)}\n`,
      { mode: 0o600 },
    )

    const sessionDir = piSessionBucketDir(this.agentDir, spec.cwd)
    await mkdir(sessionDir, { recursive: true, mode: 0o700 })

    const imageSink: { emit?: (image: ToolImageDelta) => void } = {}
    const progressSink: { emit?: (chunk: string) => void } = {}

    try {
      const modelRuntime = await ModelRuntime.create({ authPath, modelsPath })
      await modelRuntime.setRuntimeApiKey(providerId, spec.authToken)
      const model = modelRuntime.getModel(providerId, spec.model)
      if (model === undefined) {
        throw new Error(`Unknown model ${spec.model}`)
      }

      const { session } = await createAgentSession({
        cwd: spec.cwd,
        agentDir: this.agentDir,
        model,
        modelRuntime,
        sessionManager: await createPiSessionManager(this.agentDir, spec, target),
        settingsManager: SettingsManager.create(spec.cwd, this.agentDir),
        thinkingLevel: 'off',
        ...(this.tools.length === 0
          ? {}
          : {
              customTools: compilePiCustomTools(this.tools, {
                cwd: spec.cwd,
                session: { provider: 'pi', id: '' },
                signal: new AbortController().signal,
                profile: imageToolsFromSpec(spec),
                streamImages: spec.streamImages === true,
                emitImage: (image) => imageSink.emit?.(image),
                emitProgress: (chunk) => progressSink.emit?.(chunk),
              }),
            }),
      })

      return new SdkPiAgentSession(session, spec.model, runDir, imageSink, progressSink)
    } catch (error) {
      await rm(runDir, { recursive: true, force: true })
      throw error
    }
  }
}

class SdkPiAgentSession implements PiAgentSession {
  constructor(
    private readonly session: Awaited<ReturnType<typeof createAgentSession>>['session'],
    readonly modelId: string,
    private readonly runDir: string,
    private readonly imageSink: { emit?: (image: ToolImageDelta) => void } = {},
    private readonly progressSink: { emit?: (chunk: string) => void } = {},
  ) {}

  bindImageEmit(emit: ((image: ToolImageDelta) => void) | undefined): void {
    this.imageSink.emit = emit
  }

  bindProgressEmit(emit: ((chunk: string) => void) | undefined): void {
    this.progressSink.emit = emit
  }

  get sessionId(): string {
    return this.session.sessionId
  }

  get isStreaming(): boolean {
    return this.session.isStreaming
  }

  subscribe(listener: (event: PiSessionEvent) => void): () => void {
    return this.session.subscribe((event) => {
      listener(event)
    })
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

  abort(): Promise<void> {
    return this.session.abort()
  }

  dispose(): void {
    this.session.dispose()
    void rm(this.runDir, { recursive: true, force: true })
  }
}

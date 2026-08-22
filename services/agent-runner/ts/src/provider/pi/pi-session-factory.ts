import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'

import type { ProviderRunSpec } from '../../core/contract/agent-provider.js'
import {
  BAMBUDDY_PI_PROVIDER_ID,
  buildBambuddyModelsConfig,
} from './pi-models-config.js'
import { piSessionBucketDir } from './pi-paths.js'
import type { PiSessionFactory } from './pi-provider.js'
import type { PiAgentSession } from './pi-runtime.js'
import type { PiSessionEvent } from './pi-event-mapper.js'

export class CodingAgentSessionFactory implements PiSessionFactory {
  constructor(private readonly agentDir: string) {}

  async open(spec: ProviderRunSpec): Promise<PiAgentSession> {
    const runDir = join(this.agentDir, 'runs', randomUUID())
    await mkdir(runDir, { recursive: true, mode: 0o700 })
    const authPath = join(runDir, 'auth.json')
    const modelsPath = join(runDir, 'models.json')
    await writeFile(authPath, '{}\n', { mode: 0o600 })
    await writeFile(
      modelsPath,
      `${JSON.stringify(buildBambuddyModelsConfig(spec.baseUrl, spec.model), null, 2)}\n`,
      { mode: 0o600 },
    )

    const sessionDir = piSessionBucketDir(this.agentDir, spec.cwd)
    await mkdir(sessionDir, { recursive: true, mode: 0o700 })

    try {
      const modelRuntime = await ModelRuntime.create({ authPath, modelsPath })
      await modelRuntime.setRuntimeApiKey(BAMBUDDY_PI_PROVIDER_ID, spec.authToken)
      const model = modelRuntime.getModel(BAMBUDDY_PI_PROVIDER_ID, spec.model)
      if (model === undefined) {
        throw new Error(`Unknown model ${spec.model}`)
      }

      const { session } = await createAgentSession({
        cwd: spec.cwd,
        agentDir: this.agentDir,
        model,
        modelRuntime,
        sessionManager: SessionManager.create(spec.cwd, sessionDir),
        settingsManager: SettingsManager.inMemory(),
        thinkingLevel: 'off',
      })

      return new SdkPiAgentSession(session, spec.model, runDir)
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
  ) {}

  get sessionId(): string {
    return this.session.sessionId
  }

  subscribe(listener: (event: PiSessionEvent) => void): () => void {
    return this.session.subscribe((event) => {
      listener(event)
    })
  }

  prompt(text: string): Promise<void> {
    return this.session.prompt(text)
  }

  abort(): Promise<void> {
    return this.session.abort()
  }

  dispose(): void {
    this.session.dispose()
    void rm(this.runDir, { recursive: true, force: true })
  }
}

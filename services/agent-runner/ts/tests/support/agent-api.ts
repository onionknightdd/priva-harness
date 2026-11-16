import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'

import type { AgentEvent } from '../../src/core/event/agent-event.js'
import { AgentApiService } from '../../src/harness/agent-api/agent-api-service.js'
import { AgentHarness } from '../../src/harness/agent-harness.js'
import { LiveRunRegistry } from '../../src/harness/run/live-run-registry.js'
import { SessionService } from '../../src/harness/session/session-service.js'
import type { ModelProfileService } from '../../src/harness/config/model-profile-service.js'
import { JsonAgentApiSessionRegistry } from '../../src/infrastructure/agent-api/json-agent-api-session-registry.js'
import { JsonlAgentApiEventStore } from '../../src/infrastructure/agent-api/jsonl-agent-api-event-store.js'
import { NodeAgentApiWorkspace } from '../../src/infrastructure/agent-api/node-agent-api-workspace.js'
import { NodeUserFileSystem } from '../../src/infrastructure/filesystem/node-user-file-system.js'
import { buildHttpServer } from '../../src/transport/http/server.js'
import { FakeAgentProvider } from './fake-agent-provider.js'
import { MemorySessionMetadataRepository } from './memory-session-metadata.js'
import { createTestAgentServices } from './model-profile.js'

export const AGENT_API = '/api/agent/v1/sandbox'

export interface AgentApiFixture {
  readonly root: string
  readonly workspace: string
  readonly runtimeHome: string
  readonly claude: FakeAgentProvider
  readonly pi: FakeAgentProvider
  readonly metadata: MemorySessionMetadataRepository
  readonly harness: AgentHarness
  readonly service: AgentApiService
  readonly server: FastifyInstance
  readonly profileId: string
  readonly modelProfiles: ModelProfileService
  /** Failures reported outside a request, e.g. by a projector. Tests assert it stays empty. */
  readonly errors: unknown[]
  close(): Promise<void>
}

export async function createAgentApiFixture(
  events: { claude?: readonly AgentEvent[]; pi?: readonly AgentEvent[] } = {},
  options: { readonly maxWaitMs?: number } = {},
): Promise<AgentApiFixture> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'agent-api-')))
  const workspace = join(root, 'workspace')
  const runtimeHome = join(root, 'runtime')
  await mkdir(join(workspace, 'projects', 'shop-web'), { recursive: true })
  const claude = new FakeAgentProvider('claude', events.claude ?? [])
  const pi = new FakeAgentProvider('pi', events.pi ?? [])
  const providers = { claude, pi }
  const metadata = new MemorySessionMetadataRepository()
  const liveRuns = new LiveRunRegistry()
  const { modelProfileService, agentProfileService } = createTestAgentServices(runtimeHome)
  const profile = await modelProfileService.createProfile({
    label: 'Default', baseUrl: 'https://api.example.com/v1', authToken: 'secret', defaultModel: 'claude-sonnet-4-5',
  })
  const sessions = new SessionService({ providers, metadata, liveRuns, modelProfiles: modelProfileService, activeCwd: workspace })
  const harness = new AgentHarness({ providers, cwd: workspace, liveRuns, sessions })
  const fileSystem = new NodeUserFileSystem({ initialDirectory: workspace, maxUploadBytes: 1024 })
  const errors: unknown[] = []
  const sessionsDir = join(runtimeHome, 'agent-api', 'sessions')
  const service = new AgentApiService({
    providers,
    harness,
    sessions,
    registry: new JsonAgentApiSessionRegistry(sessionsDir),
    events: new JsonlAgentApiEventStore(sessionsDir),
    workspace: new NodeAgentApiWorkspace(fileSystem),
    modelProfiles: modelProfileService,
    agentProfiles: agentProfileService,
    reportError: (error) => { errors.push(error) },
    ...(options.maxWaitMs === undefined ? {} : { maxWaitMs: options.maxWaitMs }),
  })
  const server = buildHttpServer({ userFileSystem: fileSystem, modelProfileService, agentProfileService, agentHarness: harness, agentApi: service, sessionService: sessions })
  await server.ready()
  return {
    root, workspace, runtimeHome, claude, pi, metadata, harness, service, server, profileId: profile.id, modelProfiles: modelProfileService, errors,
    async close() {
      await server.close()
      await service.dispose()
      await harness.disposePool()
      await rm(root, { recursive: true, force: true })
    },
  }
}

/** Parse an SSE body into its events, keeping the `id:` line of durable ones. */
export function parseSse(body: string): { id?: string; event: string; data: Record<string, unknown> }[] {
  return body.split('\n\n').flatMap((chunk) => {
    const lines = chunk.split('\n').filter((line) => line !== '' && !line.startsWith(':'))
    if (lines.length === 0) return []
    const field = (name: string) => lines.find((line) => line.startsWith(`${name}: `))?.slice(name.length + 2)
    const id = field('id')
    return [{ ...(id === undefined ? {} : { id }), event: field('event') ?? 'message', data: JSON.parse(field('data') ?? '{}') as Record<string, unknown> }]
  })
}

export function multipartFile(name: string, content: string): { payload: string; headers: Record<string, string> } {
  const boundary = '----agent-api-test'
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`,
  }
}

import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AgentHarness } from '../../../../src/harness/agent-harness.js'
import { LiveRunRegistry } from '../../../../src/harness/run/live-run-registry.js'
import { SessionService } from '../../../../src/harness/session/session-service.js'
import { NodeUserFileSystem } from '../../../../src/infrastructure/filesystem/node-user-file-system.js'
import { buildHttpServer } from '../../../../src/transport/http/server.js'
import { FakeAgentProvider } from '../../../support/fake-agent-provider.js'
import type { FakeSessionStore } from '../../../support/fake-session-store.js'
import { MemorySessionMetadataRepository } from '../../../support/memory-session-metadata.js'
import { createTestAgentServices } from '../../../support/model-profile.js'

describe('/api/sandbox/agent/sessions', () => {
  let testRoot: string
  let server: FastifyInstance
  let claude: FakeAgentProvider
  let pi: FakeAgentProvider
  let liveRuns: LiveRunRegistry
  let metadata: MemorySessionMetadataRepository
  let extraDir: string
  let sessionService: SessionService

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'priva-sessions-http-test-'))
    await mkdir(join(testRoot, 'extra'))
    extraDir = await realpath(join(testRoot, 'extra'))
    claude = new FakeAgentProvider('claude', [])
    pi = new FakeAgentProvider('pi', [])
    liveRuns = new LiveRunRegistry()
    metadata = new MemorySessionMetadataRepository()
    const { modelProfileService, agentProfileService } = createTestAgentServices(join(testRoot, 'runtime'))
    const profile = await modelProfileService.createProfile({
      label: 'Gateway',
      baseUrl: 'https://api.example.com/v1',
      authToken: 'secret',
      defaultModel: 'unique-model',
    })
    seedClaude(claude.sessions, testRoot)
    seedPi(pi.sessions)
    await metadata.upsert({ provider: 'claude', id: 'claude-1' }, {
      pinned: true,
      runMode: 'agent',
      lastResponseModel: {
        profileId: profile.id,
        model: { id: 'unique-model', capabilities: { context: null } },
        modelSource: 'profile',
        observedAt: 123,
      },
    })
    await metadata.upsert({ provider: 'claude', id: 'claude-archived' }, {
      archived: true,
    })
    const providers = { claude, pi }
    sessionService = new SessionService({
      providers,
      metadata,
      liveRuns,
      modelProfiles: modelProfileService,
      activeCwd: testRoot,
    })
    const agentHarness = new AgentHarness({
      providers,
      cwd: testRoot,
      liveRuns,
      sessions: sessionService,
    })
    sessionService.bindWarmListing((harness) => agentHarness.listWarm(harness))
    sessionService.bindContextUsageReader((ref, spec) => agentHarness.readContextUsage(ref, spec))
    server = buildHttpServer({
      userFileSystem: new NodeUserFileSystem({ initialDirectory: testRoot }),
      modelProfileService,
      agentProfileService,
      agentHarness,
      sessionService,
    })
    await server.ready()
  })

  afterEach(async () => {
    await server.close()
    await rm(testRoot, { recursive: true, force: true })
  })

  it('returns grouped, flat, and archived Python-shaped lists', async () => {
    const groupedResponse = await server.inject({
      method: 'GET',
      url: '/api/sandbox/agent/sessions?harness=claude',
    })
    expect(groupedResponse.statusCode).toBe(200)
    const grouped = parseJson(groupedResponse)
    expect(grouped['active_cwd']).toBe(testRoot)
    const groups = grouped['groups'] as {
      cwd: string
      pinned: boolean
      has_more: boolean
      sessions: Record<string, unknown>[]
    }[]
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      cwd: testRoot,
      pinned: false,
      has_more: false,
    })
    expect(groups[0]?.sessions).toHaveLength(1)
    expect(groups[0]?.sessions[0]).toMatchObject({
      session_id: 'claude-1',
      session_source: 'project',
      pinned: true,
      run_mode: 'agent',
      last_response_model: {
        profile_id: expect.any(String) as string,
        model: {
          id: 'unique-model',
          capabilities: { context: null },
        },
      },
    })

    const flat = parseJson(await server.inject({
      method: 'GET',
      url: `/api/sandbox/agent/sessions?harness=claude&cwd=${encodeURIComponent(testRoot)}`,
    }))
    expect(flat).toMatchObject({
      cwd: testRoot,
      total: 1,
      limit: 20,
      offset: 0,
      sessions: [expect.objectContaining({ session_id: 'claude-1' })],
    })

    const archived = parseJson(await server.inject({
      method: 'GET',
      url: '/api/sandbox/agent/sessions?harness=claude&archived=true',
    }))
    expect(archived).toEqual({
      sessions: [
        expect.objectContaining({
          session_id: 'claude-archived',
          archived: true,
        }),
      ],
    })
  })

  it('lists live runs under /sessions/running before the param route', async () => {
    liveRuns.start({
      runId: 'run-1',
      provider: 'claude',
      cwd: testRoot,
    })
    liveRuns.attachSession('run-1', 'claude-1')
    const response = parseJson(await server.inject({
      method: 'GET',
      url: '/api/sandbox/agent/sessions/running?harness=claude',
    }))
    expect(response).toMatchObject({
      running: [{
        session_id: 'claude-1',
        run_id: 'run-1',
        status: 'running',
        last_seq: 0,
        first_seq: 0,
        first_user_uuid: null,
        pending_permission: null,
        run_mode: 'agent',
        harness: 'claude',
      }],
      warm: [],
    })
  })

  it('returns resume-faithful pi messages including tool_result and compaction', async () => {
    const response = parseJson(await server.inject({
      method: 'GET',
      url: '/api/sandbox/agent/sessions/bb-1/messages?harness=pi',
    }))
    expect(response).toMatchObject({
      add_dirs: [],
      run_mode: 'code',
      live_run_id: null,
      live_seq: 0,
      live_first_seq: 0,
      messages: [
        expect.objectContaining({ type: 'user', uuid: 'e1', session_id: 'bb-1' }),
        expect.objectContaining({
          type: 'assistant',
          uuid: 'e2',
          message: expect.objectContaining({ role: 'assistant' }) as unknown,
        }),
        expect.objectContaining({
          type: 'tool_result',
          uuid: 'e3',
          parent_tool_use_id: 'call-1',
        }),
        expect.objectContaining({
          type: 'compaction',
          uuid: 'e4',
          message: expect.objectContaining({ role: 'compactionSummary' }) as unknown,
        }),
      ],
    })
  })

  it('returns an aggregated thread matching the live assistant turn model', async () => {
    const piThread = parseJson(await server.inject({
      method: 'GET',
      url: '/api/sandbox/agent/sessions/bb-1/thread?harness=pi',
    }))
    expect(piThread).toMatchObject({
      add_dirs: [],
      run_mode: 'code',
      live_run_id: null,
      messages: [
        expect.objectContaining({
          role: 'user',
          content: 'tool me',
          transcript_uuid: 'e1',
        }),
        expect.objectContaining({
          role: 'assistant',
          content: '',
          transcript_uuid: 'e2',
          blocks: [
            expect.objectContaining({
              type: 'tool_use',
              id: 'call-1',
              tool: expect.objectContaining({ status: 'completed' }) as unknown,
            }),
          ],
        }),
        expect.objectContaining({
          role: 'user',
          content: '/compact',
          compact: { phase: 'compacted', summary: 'compacted' },
        }),
      ],
    })

    claude.sessions.seed(
      await claude.sessions.read({ provider: 'claude', id: 'claude-1' }),
      [
        sessionMessage('user', 'u1', 'claude-1', 'hello'),
        sessionMessage('assistant', 'a1', 'claude-1', 'hi'),
      ],
    )
    const thread = parseJson(await server.inject({
      method: 'GET',
      url: '/api/sandbox/agent/sessions/claude-1/thread?harness=claude',
    }))
    expect(thread['messages']).toEqual([
      expect.objectContaining({ role: 'user', content: 'hello', transcript_uuid: 'u1' }),
      expect.objectContaining({ role: 'assistant', content: 'hi', transcript_uuid: 'a1' }),
    ])
  })

  it('returns a stored recap without generating one', async () => {
    const empty = parseJson(await server.inject({
      method: 'GET',
      url: '/api/sandbox/agent/sessions/claude-1/recap?harness=claude',
    }))
    expect(empty).toEqual({ recap: null, turns: 0 })

    await metadata.upsert({ provider: 'claude', id: 'claude-1' }, {
      recap: { text: 'Did the thing', turns: 2 },
    })
    const stored = parseJson(await server.inject({
      method: 'GET',
      url: '/api/sandbox/agent/sessions/claude-1/recap?harness=claude',
    }))
    expect(stored).toEqual({ recap: 'Did the thing', turns: 2 })
  })

  it('renames, tags, pins, archives, stores add_dirs, and deletes', async () => {
    const renamed = await server.inject({
      method: 'PATCH',
      url: '/api/sandbox/agent/sessions/claude-1?harness=claude',
      payload: { title: ' New title ' },
    })
    expect(renamed.statusCode).toBe(200)
    expect(parseJson(renamed)).toEqual({ status: 'ok' })
    expect(claude.sessions.renamed).toEqual([{ id: 'claude-1', title: 'New title' }])

    const tagged = parseJson(await server.inject({
      method: 'PUT',
      url: '/api/sandbox/agent/sessions/claude-1/tag?harness=claude',
      payload: { tags: ['Alpha', 'beta'] },
    }))
    expect(tagged).toMatchObject({
      status: 'ok',
      tags: ['Alpha', 'beta'],
    })
    expect(claude.sessions.tagged).toEqual([{ id: 'claude-1', tag: 'Alpha' }])
    expect(tagged['tag_colors']).toEqual(expect.objectContaining({
      Alpha: expect.any(Number) as number,
      beta: expect.any(Number) as number,
    }))

    const piTagged = await server.inject({
      method: 'PUT',
      url: '/api/sandbox/agent/sessions/bb-1/tag?harness=pi',
      payload: { tag: 'solo' },
    })
    expect(parseJson(piTagged)).toMatchObject({ status: 'ok', tags: ['solo'] })
    expect(pi.sessions.tagged).toEqual([{ id: 'bb-1', tag: 'solo' }])

    const pinned = parseJson(await server.inject({
      method: 'PUT',
      url: '/api/sandbox/agent/sessions/claude-1/pin?harness=claude',
      payload: { pinned: false },
    }))
    expect(pinned).toEqual({ status: 'ok', pinned: false, archived: false })

    const dirs = parseJson(await server.inject({
      method: 'PUT',
      url: '/api/sandbox/agent/sessions/claude-1/add_dirs?harness=claude',
      payload: { add_dirs: [extraDir] },
    }))
    expect(dirs).toEqual({ status: 'ok', add_dirs: [extraDir] })

    const archived = parseJson(await server.inject({
      method: 'PUT',
      url: '/api/sandbox/agent/sessions/claude-1/archive?harness=claude',
      payload: { archived: true },
    }))
    expect(archived).toEqual({ status: 'ok', pinned: false, archived: true })

    const missing = await server.inject({
      method: 'DELETE',
      url: '/api/sandbox/agent/sessions/missing?harness=claude',
    })
    expect(missing.statusCode).toBe(404)

    liveRuns.start({ runId: 'busy', provider: 'pi', cwd: testRoot })
    liveRuns.attachSession('busy', 'bb-1')
    const busy = await server.inject({
      method: 'DELETE',
      url: '/api/sandbox/agent/sessions/bb-1?harness=pi',
    })
    expect(busy.statusCode).toBe(409)
    liveRuns.finish('busy')

    const deleted = await server.inject({
      method: 'DELETE',
      url: '/api/sandbox/agent/sessions/bb-1?harness=pi',
    })
    expect(deleted.statusCode).toBe(200)
    expect(parseJson(deleted)).toEqual({ status: 'ok' })
    expect(pi.sessions.deleted).toEqual(['bb-1'])
  })

  it('rejects a non-directory add_dirs path', async () => {
    const filePath = join(testRoot, 'not-a-dir.txt')
    await writeFile(filePath, 'x')
    const response = await server.inject({
      method: 'PUT',
      url: '/api/sandbox/agent/sessions/claude-1/add_dirs?harness=claude',
      payload: { add_dirs: [filePath] },
    })
    expect(response.statusCode).toBe(400)
  })

  it('forks a claude session with numbered titles and optional truncation', async () => {
    const info = await claude.sessions.read({ provider: 'claude', id: 'claude-1' })
    claude.sessions.seed(info, [
      sessionMessage('user', 'u1', 'claude-1', 'first'),
      sessionMessage('assistant', 'a1', 'claude-1', 'one'),
      sessionMessage('user', 'u2', 'claude-1', 'second'),
      sessionMessage('assistant', 'a2', 'claude-1', 'two'),
    ])

    const first = await server.inject({
      method: 'POST',
      url: '/api/sandbox/agent/sessions/claude-1/fork?harness=claude',
      payload: { stem: 'Hello' },
    })
    expect(first.statusCode).toBe(200)
    const firstBody = parseJson(first)
    expect(firstBody).toMatchObject({
      custom_title: 'Hello (1)',
      cwd: testRoot,
    })
    expect(typeof firstBody['session_id']).toBe('string')
    expect(firstBody['session_id']).not.toBe('claude-1')

    const second = await server.inject({
      method: 'POST',
      url: '/api/sandbox/agent/sessions/claude-1/fork?harness=claude',
      payload: { stem: 'Hello' },
    })
    expect(parseJson(second)).toMatchObject({ custom_title: 'Hello (2)' })

    const truncated = await server.inject({
      method: 'POST',
      url: '/api/sandbox/agent/sessions/claude-1/fork?harness=claude',
      payload: { stem: 'Hello', up_to_message_id: 'a1' },
    })
    expect(truncated.statusCode).toBe(200)
    const truncatedBody = parseJson(truncated)
    expect(truncatedBody).toMatchObject({ custom_title: 'Hello (3)' })

    const messages = parseJson(await server.inject({
      method: 'GET',
      url: `/api/sandbox/agent/sessions/${String(truncatedBody['session_id'])}/messages?harness=claude`,
    }))
    expect((messages['messages'] as { uuid: string }[]).map((message) => message.uuid)).toEqual([
      'u1',
      'a1',
    ])
  })

  it('rejects pi fork', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/sandbox/agent/sessions/bb-1/fork?harness=pi',
      payload: { stem: 'BB' },
    })
    expect(response.statusCode).toBe(400)
    expect(parseJson(response)).toEqual({ detail: 'Pi does not support fork' })
  })

  it('measures a cold session without parking a warm runtime', async () => {
    claude.contextUsage = {
      used: 40,
      limit: 200000,
      categories: [
        { id: 'systemPrompt', tokens: 8 },
        { id: 'toolDefinitions', tokens: 20 },
        { id: 'skills', tokens: null },
        { id: 'mcpTools', tokens: null },
        { id: 'subagentDefinitions', tokens: null },
        { id: 'memory', tokens: null },
        { id: 'conversation', tokens: 12 },
      ],
    }
    const response = await server.inject({
      method: 'GET',
      url: '/api/sandbox/agent/sessions/claude-1/context-usage?harness=claude',
    })
    expect(response.statusCode).toBe(200)
    expect(parseJson(response)).toEqual(claude.contextUsage)
    expect(claude.targets).toEqual([{
      kind: 'resume',
      session: { provider: 'claude', id: 'claude-1' },
    }])
    expect(claude.released).toEqual(['dispose'])
    const running = parseJson(await server.inject({
      method: 'GET',
      url: '/api/sandbox/agent/sessions/running?harness=claude',
    }))
    expect(running['warm']).toEqual([])
  })

  it('returns the bound context usage snapshot for a live session', async () => {
    sessionService.bindContextUsageReader((ref) => Promise.resolve({
      used: ref.id === 'claude-1' ? 22998 : null,
      limit: ref.id === 'claude-1' ? 200000 : null,
      categories: [
        { id: 'systemPrompt', tokens: 2089 },
        { id: 'toolDefinitions', tokens: 20825 },
        { id: 'skills', tokens: null },
        { id: 'mcpTools', tokens: null },
        { id: 'subagentDefinitions', tokens: null },
        { id: 'memory', tokens: null },
        { id: 'conversation', tokens: 84 },
      ],
    }))
    const response = await server.inject({
      method: 'GET',
      url: '/api/sandbox/agent/sessions/claude-1/context-usage?harness=claude',
    })
    expect(response.statusCode).toBe(200)
    expect(parseJson(response)).toEqual({
      used: 22998,
      limit: 200000,
      categories: [
        { id: 'systemPrompt', tokens: 2089 },
        { id: 'toolDefinitions', tokens: 20825 },
        { id: 'skills', tokens: null },
        { id: 'mcpTools', tokens: null },
        { id: 'subagentDefinitions', tokens: null },
        { id: 'memory', tokens: null },
        { id: 'conversation', tokens: 84 },
      ],
    })
  })
})

function seedClaude(store: FakeSessionStore, cwd: string): void {
  store.seed({
    ref: { provider: 'claude', id: 'claude-1' },
    summary: 'hello',
    lastModified: 200,
    fileSize: 10,
    customTitle: 'Hello',
    firstPrompt: 'hi',
    gitBranch: 'main',
    cwd,
    tag: 'sdk-tag',
  })
  store.seed({
    ref: { provider: 'claude', id: 'claude-archived' },
    summary: 'old',
    lastModified: 10,
    fileSize: 4,
    customTitle: null,
    firstPrompt: 'bye',
    gitBranch: null,
    cwd,
    tag: null,
  })
}

function seedPi(store: FakeSessionStore): void {
  store.seed({
    ref: { provider: 'pi', id: 'bb-1' },
    summary: 'bb',
    lastModified: 50,
    fileSize: 8,
    customTitle: 'BB',
    firstPrompt: 'tool me',
    gitBranch: null,
    cwd: '/tmp/bb',
    tag: null,
  }, [
    {
      type: 'user',
      uuid: 'e1',
      sessionId: 'bb-1',
      message: { role: 'user', content: 'tool me' },
      parentToolUseId: null,
      metadata: null,
      timestamp: null,
    },
    {
      type: 'assistant',
      uuid: 'e2',
      sessionId: 'bb-1',
      message: { role: 'assistant', content: [{ type: 'toolCall', id: 'call-1' }] },
      parentToolUseId: null,
      metadata: null,
      timestamp: null,
    },
    {
      type: 'tool_result',
      uuid: 'e3',
      sessionId: 'bb-1',
      message: { role: 'toolResult', toolCallId: 'call-1', toolName: 'bash' },
      parentToolUseId: 'call-1',
      metadata: null,
      timestamp: null,
    },
    {
      type: 'compaction',
      uuid: 'e4',
      sessionId: 'bb-1',
      message: { role: 'compactionSummary', summary: 'compacted' },
      parentToolUseId: null,
      metadata: null,
      timestamp: null,
    },
  ])
}

function parseJson(response: { readonly body: string }): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>
}

function sessionMessage(
  type: 'user' | 'assistant',
  uuid: string,
  sessionId: string,
  content: string,
) {
  return {
    type,
    uuid,
    sessionId,
    message: { role: type, content },
    parentToolUseId: null,
    metadata: null,
    timestamp: null,
  }
}

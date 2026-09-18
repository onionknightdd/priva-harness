import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { emptyContextUsage } from '../../../../src/core/resource/context-usage.js'
import { SessionError, SESSION_GROUP_PAGE_SIZE } from '../../../../src/core/resource/session.js'
import { LiveRunRegistry } from '../../../../src/harness/run/live-run-registry.js'
import { SessionService } from '../../../../src/harness/session/session-service.js'
import { FakeAgentProvider } from '../../../support/fake-agent-provider.js'
import { MemorySessionMetadataRepository } from '../../../support/memory-session-metadata.js'
import { createTestModelProfileService } from '../../../support/model-profile.js'

describe('SessionService last_response_model', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })))
  })

  it('uses metadata profile source, unique transcript mapping, and omits unmapped stored ids', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'priva-session-service-'))
    roots.push(runtimeHome)
    const modelProfiles = createTestModelProfileService(runtimeHome)
    const profile = await modelProfiles.createProfile({
      label: 'One',
      baseUrl: 'https://api.example.com/v1',
      authToken: 't',
      defaultModel: 'owned',
    })
    await modelProfiles.createProfile({
      label: 'Two',
      baseUrl: 'https://api.example.com/v1',
      authToken: 't',
      defaultModel: 'shared',
      imageUnderstandingModel: 'shared',
    })

    const claude = new FakeAgentProvider('claude', [])
    claude.sessions.seed({
      ref: { provider: 'claude', id: 'profile-src' },
      summary: 'a',
      lastModified: 3,
      fileSize: 1,
      customTitle: null,
      firstPrompt: 'a',
      gitBranch: null,
      cwd: '/a',
      tag: null,
    })
    claude.sessions.seed({
      ref: { provider: 'claude', id: 'transcript-src' },
      summary: 'b',
      lastModified: 2,
      fileSize: 1,
      customTitle: null,
      firstPrompt: 'b',
      gitBranch: null,
      cwd: '/b',
      tag: null,
    })
    claude.sessions.seed({
      ref: { provider: 'claude', id: 'shared-src' },
      summary: 'c',
      lastModified: 1,
      fileSize: 1,
      customTitle: null,
      firstPrompt: 'c',
      gitBranch: null,
      cwd: '/c',
      tag: null,
    })
    claude.sessions.setAssistantModel('transcript-src', { modelId: 'owned', observedAt: 8 })
    claude.sessions.setAssistantModel('shared-src', { modelId: 'owned', observedAt: 8 })

    const metadata = new MemorySessionMetadataRepository()
    await metadata.upsert({ provider: 'claude', id: 'profile-src' }, {
      lastResponseModel: {
        profileId: profile.id,
        model: { id: 'owned', capabilities: { context: '1m' } },
        modelSource: 'profile',
        observedAt: 4,
      },
    })
    await metadata.upsert({ provider: 'claude', id: 'shared-src' }, {
      lastResponseModel: {
        profileId: null,
        model: { id: 'gateway-backend', capabilities: { context: null } },
        modelSource: 'transcript',
        observedAt: 4,
      },
    })

    const service = new SessionService({
      providers: {
        claude,
        pi: new FakeAgentProvider('pi', []),
      },
      metadata,
      liveRuns: new LiveRunRegistry(),
      modelProfiles,
      activeCwd: '/a',
    })

    const listed = await service.list({ harness: 'claude' })
    expect(listed.kind).toBe('grouped')
    if (listed.kind !== 'grouped') return
    const byId = new Map(
      listed.groups.flatMap((group) => group.sessions).map((session) => [session.sessionId, session]),
    )
    expect(byId.get('profile-src')?.lastResponseModel).toEqual({
      profileId: profile.id,
      model: { id: 'owned', capabilities: { context: '1m' } },
      observedAt: 4,
    })
    expect(byId.get('transcript-src')?.lastResponseModel).toEqual({
      profileId: profile.id,
      model: { id: 'owned', capabilities: { context: null } },
      observedAt: 8,
    })
    expect(byId.get('shared-src')?.lastResponseModel).toBeNull()
  })

  it('numbers fork titles from the current stem in the same cwd', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'priva-session-fork-'))
    roots.push(runtimeHome)
    const claude = new FakeAgentProvider('claude', [])
    claude.sessions.seed({
      ref: { provider: 'claude', id: 'orig' },
      summary: '设计 API',
      lastModified: 2,
      fileSize: 1,
      customTitle: '设计 API',
      firstPrompt: 'hi',
      gitBranch: null,
      cwd: '/work',
      tag: null,
    })
    const service = new SessionService({
      providers: {
        claude,
        pi: new FakeAgentProvider('pi', []),
      },
      metadata: new MemorySessionMetadataRepository(),
      liveRuns: new LiveRunRegistry(),
      modelProfiles: createTestModelProfileService(runtimeHome),
      activeCwd: '/work',
    })

    const first = await service.fork('claude', 'orig', { stem: '设计 API' })
    expect(first.customTitle).toBe('设计 API (1)')
    const nested = await service.fork('claude', first.sessionId, { stem: '设计 API (1)' })
    expect(nested.customTitle).toBe('设计 API (1) (1)')
    const second = await service.fork('claude', 'orig', { stem: '设计 API' })
    expect(second.customTitle).toBe('设计 API (2)')
  })
})

describe('SessionService warm listing', () => {
  it('lists bound warm sessions for the requested harness', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'priva-session-warm-'))
    const service = new SessionService({
      providers: {
        claude: new FakeAgentProvider('claude', []),
        pi: new FakeAgentProvider('pi', []),
      },
      metadata: new MemorySessionMetadataRepository(),
      liveRuns: new LiveRunRegistry(),
      modelProfiles: createTestModelProfileService(runtimeHome),
      activeCwd: '/work',
    })
    service.bindWarmListing((harness) =>
      harness === 'claude' ? [{ provider: 'claude', id: 'warm-1' }] : []
    )
    expect(service.listWarm('claude')).toEqual([
      { sessionId: 'warm-1', status: 'warm', harness: 'claude' },
    ])
    expect(service.listWarm('pi')).toEqual([])
    await rm(runtimeHome, { recursive: true, force: true })
  })
})

describe('SessionService context usage', () => {
  it('returns an empty snapshot unless a live reader is bound', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'priva-session-usage-'))
    const claude = new FakeAgentProvider('claude', [])
    seedSession(claude, 'cold-1')
    seedSession(claude, 'warm-1')
    const service = new SessionService({
      providers: {
        claude,
        pi: new FakeAgentProvider('pi', []),
      },
      metadata: new MemorySessionMetadataRepository(),
      liveRuns: new LiveRunRegistry(),
      modelProfiles: createTestModelProfileService(runtimeHome),
      activeCwd: '/work',
    })
    expect(await service.contextUsage('claude', 'cold-1')).toEqual(emptyContextUsage())
    service.bindContextUsageReader((ref) => Promise.resolve({
      ...emptyContextUsage(),
      used: ref.id === 'warm-1' ? 20 : null,
      limit: ref.id === 'warm-1' ? 200 : null,
    }))
    expect(await service.contextUsage('claude', 'warm-1')).toEqual({
      ...emptyContextUsage(),
      used: 20,
      limit: 200,
    })
    await expect(service.contextUsage('claude', '  ')).rejects.toThrow(SessionError)
    await expect(service.contextUsage('claude', 'missing')).rejects.toThrow(SessionError)
    await rm(runtimeHome, { recursive: true, force: true })
  })

  it('resolves a detached run spec from the last response model', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'priva-session-usage-spec-'))
    const modelProfiles = createTestModelProfileService(runtimeHome)
    const profile = await modelProfiles.createProfile({
      label: 'Gateway',
      baseUrl: 'https://api.example.com/v1',
      authToken: 'secret',
      defaultModel: 'owned',
    })
    const claude = new FakeAgentProvider('claude', [])
    seedSession(claude, 'cold-1', '/repo')
    const metadata = new MemorySessionMetadataRepository()
    await metadata.upsert({ provider: 'claude', id: 'cold-1' }, {
      lastResponseModel: {
        profileId: profile.id,
        model: { id: 'owned', capabilities: { context: '1m' } },
        modelSource: 'profile',
        observedAt: 8,
      },
    })
    const service = new SessionService({
      providers: {
        claude,
        pi: new FakeAgentProvider('pi', []),
      },
      metadata,
      liveRuns: new LiveRunRegistry(),
      modelProfiles,
      activeCwd: '/work',
    })
    const seen: { id: string; cwd?: string | undefined; model?: string | undefined }[] = []
    service.bindContextUsageReader((ref, spec) => {
      seen.push({ id: ref.id, cwd: spec?.cwd, model: spec?.model })
      return Promise.resolve(emptyContextUsage())
    })
    await service.contextUsage('claude', 'cold-1')
    expect(seen).toEqual([{
      id: 'cold-1',
      cwd: '/repo',
      model: 'owned[1m]',
    }])
    await rm(runtimeHome, { recursive: true, force: true })
  })
})

function seedSession(
  provider: FakeAgentProvider,
  id: string,
  cwd = '/work',
  lastModified = 1,
): void {
  provider.sessions.seed({
    ref: { provider: provider.id, id },
    summary: id,
    lastModified,
    fileSize: 1,
    customTitle: null,
    firstPrompt: id,
    gitBranch: null,
    cwd,
    tag: null,
  })
}

describe('SessionService list order', () => {
  it('pins sessions first, then orders by lastModified, ignoring activeCwd', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'priva-session-order-'))
    const claude = new FakeAgentProvider('claude', [])
    seedSession(claude, 'recent-unpinned', '/recent', 100)
    seedSession(claude, 'older-pinned', '/recent', 20)
    seedSession(claude, 'stale-unpinned', '/active', 50)
    seedSession(claude, 'oldest-pinned', '/active', 10)
    const metadata = new MemorySessionMetadataRepository()
    await metadata.upsert({ provider: 'claude', id: 'older-pinned' }, { pinned: true })
    await metadata.upsert({ provider: 'claude', id: 'oldest-pinned' }, { pinned: true })
    const service = new SessionService({
      providers: {
        claude,
        pi: new FakeAgentProvider('pi', []),
      },
      metadata,
      liveRuns: new LiveRunRegistry(),
      modelProfiles: createTestModelProfileService(runtimeHome),
      activeCwd: '/active',
    })

    const grouped = await service.list({ harness: 'claude' })
    expect(grouped.kind).toBe('grouped')
    if (grouped.kind !== 'grouped') return
    expect(grouped.groups.map((group) => group.cwd)).toEqual(['/recent', '/active'])
    expect(grouped.groups[0]?.sessions.map((session) => session.sessionId)).toEqual([
      'older-pinned',
      'recent-unpinned',
    ])
    expect(grouped.groups[1]?.sessions.map((session) => session.sessionId)).toEqual([
      'oldest-pinned',
      'stale-unpinned',
    ])

    const flat = await service.list({ harness: 'claude', cwd: '/recent' })
    expect(flat.kind).toBe('flat')
    if (flat.kind !== 'flat') return
    expect(flat.sessions.map((session) => session.sessionId)).toEqual([
      'older-pinned',
      'recent-unpinned',
    ])
    await rm(runtimeHome, { recursive: true, force: true })
  })

  it('keeps an older pinned session on the first grouped page', async () => {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'priva-session-page-'))
    const claude = new FakeAgentProvider('claude', [])
    for (let stamp = 1; stamp <= SESSION_GROUP_PAGE_SIZE + 1; stamp += 1) {
      seedSession(claude, `sess-${stamp}`, '/work', stamp)
    }
    const metadata = new MemorySessionMetadataRepository()
    await metadata.upsert({ provider: 'claude', id: 'sess-1' }, { pinned: true })
    const service = new SessionService({
      providers: {
        claude,
        pi: new FakeAgentProvider('pi', []),
      },
      metadata,
      liveRuns: new LiveRunRegistry(),
      modelProfiles: createTestModelProfileService(runtimeHome),
      activeCwd: '/other',
    })

    const grouped = await service.list({ harness: 'claude' })
    expect(grouped.kind).toBe('grouped')
    if (grouped.kind !== 'grouped') return
    expect(grouped.groups).toHaveLength(1)
    expect(grouped.groups[0]?.hasMore).toBe(true)
    expect(grouped.groups[0]?.sessions.map((session) => session.sessionId)).toEqual([
      'sess-1',
      ...Array.from({ length: SESSION_GROUP_PAGE_SIZE - 1 }, (_, index) => `sess-${SESSION_GROUP_PAGE_SIZE + 1 - index}`),
    ])
    await rm(runtimeHome, { recursive: true, force: true })
  })
})

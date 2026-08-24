import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

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

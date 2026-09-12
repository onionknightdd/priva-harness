import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { defaultDataRetention } from '../../../../src/core/resource/data-store.js'
import type { AuditPage, UsageOverview, UsageRangeSummary } from '../../../../src/core/resource/usage-overview.js'
import { NodeUserFileSystem } from '../../../../src/infrastructure/filesystem/node-user-file-system.js'
import { SqliteDataStore } from '../../../../src/infrastructure/data/sqlite-data-store.js'
import { WorkerDataRecorder } from '../../../../src/infrastructure/data/worker-data-recorder.js'
import { buildHttpServer } from '../../../../src/transport/http/server.js'
import { createTestAgentServices } from '../../../support/model-profile.js'

describe('/api/sandbox/usage', () => {
  let testRoot: string
  let server: FastifyInstance
  let recorder: WorkerDataRecorder

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'priva-usage-http-test-'))
    const workspace = join(testRoot, 'workspace')
    await mkdir(workspace)
    const dbPath = join(testRoot, '.data.db')

    const seed = SqliteDataStore.open(dbPath)
    const ts = new Date(Date.now() - 60_000).toISOString()
    seed.writeBatch([
      {
        kind: 'run.started', tsUtc: ts, runId: 'r1', sessionId: 's1', provider: 'claude', model: 'sonnet', source: 'web', cwd: '/work/demo',
        promptChars: 3, attachmentCount: 0, details: null,
      },
      {
        kind: 'run.finished', tsUtc: ts, runId: 'r1', outcome: 'completed', durationMs: 5,
        usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, costUsd: 0.5, details: null,
      },
      { kind: 'audit', tsUtc: ts, action: 'session.renamed', sessionId: 's1', details: { title: 'T' } },
    ])
    seed.close()

    recorder = new WorkerDataRecorder({ dbPath, retention: defaultDataRetention(), pruneIntervalMs: 60_000, logger: { info: () => undefined, warn: () => undefined, error: () => undefined } })
    recorder.start()
    const services = createTestAgentServices(join(testRoot, 'runtime'))
    server = buildHttpServer({
      userFileSystem: new NodeUserFileSystem({ initialDirectory: workspace }),
      modelProfileService: services.modelProfileService,
      agentProfileService: services.agentProfileService,
      recorder,
      usageReader: recorder,
    })
    await server.ready()
  })

  afterEach(async () => {
    await server.close()
    await recorder.close()
    await rm(testRoot, { recursive: true, force: true })
  })

  it('serves the overview for the requested time zone', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/sandbox/usage/overview?tz=Asia/Shanghai&days=7' })
    expect(response.statusCode).toBe(200)
    const overview = response.json<UsageOverview>()
    expect(overview.timeZone).toBe('Asia/Shanghai')
    expect(overview.heatmap).toHaveLength(7)
    expect(overview.ranges[0]).toMatchObject({ days: 7, runs: 1, completed: 1, processedTokens: 10, costUsd: 0.5, activeSessions: 1 })
    expect(overview.models).toEqual([expect.objectContaining({ model: 'sonnet', processedTokens: 10, share: 1 })])
    expect(overview.currentStreak).toBe(1)
  })

  it('rejects an unknown time zone and a missing one', async () => {
    expect((await server.inject({ method: 'GET', url: '/api/sandbox/usage/overview?tz=Mars/Olympus' })).statusCode).toBe(422)
    expect((await server.inject({ method: 'GET', url: '/api/sandbox/usage/overview' })).statusCode).toBe(422)
    expect((await server.inject({ method: 'GET', url: '/api/sandbox/usage/overview?tz=UTC&days=9999' })).statusCode).toBe(422)
  })

  it('summarises an inclusive local date range with projects, peak day and streak', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
    const response = await server.inject({ method: 'GET', url: `/api/sandbox/usage/range?tz=Asia/Shanghai&from=${today}&to=${today}` })
    expect(response.statusCode).toBe(200)
    const summary = response.json<UsageRangeSummary>()
    expect(summary).toMatchObject({
      from: today, to: today, days: 1, runs: 1, completed: 1, activeSessions: 1, activeDays: 1, projects: 1,
      processedTokens: 10, costUsd: 0.5, runsWithoutCost: 0,
      peakDay: { date: today, processedTokens: 10 }, longestStreak: { days: 1, from: today, to: today },
    })
    const empty = (await server.inject({ method: 'GET', url: '/api/sandbox/usage/range?tz=Asia/Shanghai&from=2020-01-01&to=2020-01-31' })).json<UsageRangeSummary>()
    expect(empty).toMatchObject({ days: 31, runs: 0, projects: 0, peakDay: null, longestStreak: null })
  })

  it('rejects malformed, inverted and oversized ranges', async () => {
    const status = async (query: string) => (await server.inject({ method: 'GET', url: `/api/sandbox/usage/range?${query}` })).statusCode
    expect(await status('tz=UTC&from=2026-02-30&to=2026-03-01')).toBe(422)
    expect(await status('tz=UTC&from=2026-09-02&to=2026-09-01')).toBe(422)
    expect(await status('tz=UTC&from=2000-01-01&to=2026-09-01')).toBe(422)
    expect(await status('tz=Mars/Olympus&from=2026-09-01&to=2026-09-02')).toBe(422)
    expect(await status('tz=UTC&from=2026-09-01')).toBe(422)
  })

  it('pages the audit log', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/sandbox/usage/audit?limit=2' })
    expect(response.statusCode).toBe(200)
    const page = response.json<AuditPage>()
    expect(page.entries.map((entry) => entry.action)).toEqual(['session.renamed', 'run.finished'])
    expect(page.nextBefore).toBe(page.entries[1]?.id)

    const rest = (await server.inject({ method: 'GET', url: `/api/sandbox/usage/audit?limit=2&before=${String(page.nextBefore)}` })).json<AuditPage>()
    expect(rest.entries.map((entry) => entry.action)).toEqual(['run.started'])
    expect(rest.nextBefore).toBeNull()

    const filtered = (await server.inject({ method: 'GET', url: '/api/sandbox/usage/audit?session_id=s1&action=session.' })).json<AuditPage>()
    expect(filtered.entries).toEqual([expect.objectContaining({ action: 'session.renamed', details: { title: 'T' } })])
  })
})

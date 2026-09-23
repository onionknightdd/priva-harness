import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { JsonSessionMetadataStore } from '../../../../src/infrastructure/session/json-session-metadata-store.js'

describe('JsonSessionMetadataStore', () => {
  let runtimeHome: string
  let store: JsonSessionMetadataStore

  beforeEach(async () => {
    runtimeHome = await mkdtemp(join(tmpdir(), 'priva-session-meta-'))
    store = new JsonSessionMetadataStore({ runtimeHome })
  })

  afterEach(async () => {
    await rm(runtimeHome, { recursive: true, force: true })
  })

  it('repairs old Claude mode labels once while preserving Pi and unrelated metadata', async () => {
    await writeFile(store.filePath, JSON.stringify({ version: 1,
      sessions: { 'claude:old': { runMode: 'agent', pinned: true, tags: ['work'] }, 'pi:old': { runMode: 'agent' } },
      recaps: { 'claude:old': { text: 'summary', turns: 1 } }, lastResponseModels: {}, tagColors: { work: 2 } }))
    expect(await store.get({ provider: 'claude', id: 'old' })).toMatchObject({ runMode: 'code', flags: { pinned: true }, tags: ['work'], recap: { text: 'summary' } })
    expect((await store.get({ provider: 'pi', id: 'old' })).runMode).toBe('agent')
    await store.upsert({ provider: 'claude', id: 'new' }, { runMode: 'agent' })
    const reopened = new JsonSessionMetadataStore({ runtimeHome })
    expect((await reopened.get({ provider: 'claude', id: 'new' })).runMode).toBe('agent')
    expect(JSON.parse(await readFile(store.filePath, 'utf8'))).toMatchObject({ version: 2, tagColors: { work: 2 } })
  })

  it('allows only one of two conflicting concurrent first bindings', async () => {
    const ref = { provider: 'claude', id: 'race' } as const
    const other = new JsonSessionMetadataStore({ runtimeHome })
    const results = await Promise.allSettled([store.upsert(ref, { runMode: 'agent' }), other.upsert(ref, { runMode: 'code' })])
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((item) => item.status === 'rejected')).toMatchObject({ reason: { kind: 'run-mode-conflict' } })
    const winner = (await store.get(ref)).runMode
    await other.upsert(ref, { pinned: true })
    expect((await store.get(ref)).runMode).toBe(winner)
  })

  it('stores flags, tags, recap, and last_response_model under a provider-scoped key', async () => {
    const ref = { provider: 'claude' as const, id: 'sess-1' }
    await store.upsert(ref, {
      pinned: true,
      tags: ['work'],
      runMode: 'agent',
      recap: { text: 'summary', turns: 2 },
      lastResponseModel: {
        profileId: 'p1',
        model: { id: 'm1', capabilities: { context: null } },
        modelSource: 'profile',
        observedAt: 9,
      },
    })

    const record = await store.get(ref)
    expect(record.flags.pinned).toBe(true)
    expect(record.tags).toEqual(['work'])
    expect(record.runMode).toBe('agent')
    expect(record.recap).toEqual({ text: 'summary', turns: 2 })
    expect(record.lastResponseModel?.model.id).toBe('m1')

    const serialized = JSON.parse(await readFile(store.filePath, 'utf8')) as {
      sessions: Record<string, unknown>
    }
    expect(serialized.sessions['claude:sess-1']).toMatchObject({
      pinned: true,
      tags: ['work'],
      runMode: 'agent',
    })
    expect(serialized.sessions['sess-1']).toBeUndefined()

    await store.delete(ref)
    const deleted = await store.get(ref)
    expect(deleted.flags.pinned).toBe(false)
    expect(deleted.recap).toBeNull()
  })

  it('persists task identity and terminal status across store instances and metadata edits', async () => {
    const ref = { provider: 'claude' as const, id: 'background' }
    const tasks = [{ taskId: 'job', kind: 'bash' as const, status: 'cancelled' as const, toolUseId: 'tool', outputFile: '/tmp/job.output' }]
    await store.upsert(ref, { backgroundTasks: tasks })
    await store.upsert(ref, { pinned: true })
    expect((await new JsonSessionMetadataStore({ runtimeHome }).get(ref)).backgroundTasks).toEqual(tasks)
    expect((await store.get({ provider: 'pi', id: ref.id })).backgroundTasks).toEqual([])
    await store.delete(ref)
    expect((await store.get(ref)).backgroundTasks).toEqual([])
  })
})

import { mkdtemp, readFile, rm } from 'node:fs/promises'
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

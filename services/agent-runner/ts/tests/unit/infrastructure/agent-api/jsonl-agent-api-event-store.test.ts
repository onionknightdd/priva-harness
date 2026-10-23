import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { DurableEventDraft } from '../../../../src/core/agent-api/events.js'
import { JsonlAgentApiEventStore } from '../../../../src/infrastructure/agent-api/jsonl-agent-api-event-store.js'

const STATUS: DurableEventDraft = { type: 'session.status_changed', status: { state: 'idle', active_tasks: 0 } }

describe('JsonlAgentApiEventStore', () => {
  let root: string
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'agent-api-events-')) })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('continues seq after the runner restarts', async () => {
    const first = await new JsonlAgentApiEventStore(root).openLog('ses_A')
    expect(first.append([STATUS, STATUS]).map((event) => event.seq)).toEqual([1, 2])
    await first.flush()
    const reopened = await new JsonlAgentApiEventStore(root).openLog('ses_A')
    expect([reopened.firstSeq, reopened.lastSeq]).toEqual([1, 2])
    expect(reopened.append([STATUS])[0]?.seq).toBe(3)
    expect((await reopened.read(1)).map((event) => event.seq)).toEqual([2, 3])
  })

  it('keeps the newest events within the retention limit', async () => {
    const log = await new JsonlAgentApiEventStore(root, { maxEvents: 5, maxAgeMs: 60_000 }).openLog('ses_B')
    for (let index = 0; index < 7; index += 1) log.append([STATUS])
    await log.flush()
    expect([log.firstSeq, log.lastSeq]).toEqual([3, 7])
    expect((await log.read(0)).map((event) => event.seq)).toEqual([3, 4, 5, 6, 7])
    const reopened = await new JsonlAgentApiEventStore(root, { maxEvents: 5, maxAgeMs: 60_000 }).openLog('ses_B')
    expect([reopened.firstSeq, reopened.lastSeq]).toEqual([3, 7])
  })

  it('stores projection state beside the log', async () => {
    const store = new JsonlAgentApiEventStore(root)
    expect(await store.loadState('ses_C')).toEqual({ runs: [], memory: null })
    await store.saveState('ses_C', { runs: [{ id: 'run_1' }], memory: { objects: { 'run:run_1': 'T:x' }, status: null, settings: null } })
    expect(await store.loadState('ses_C')).toEqual({ runs: [{ id: 'run_1' }], memory: { objects: { 'run:run_1': 'T:x' }, status: null, settings: null } })
  })
})

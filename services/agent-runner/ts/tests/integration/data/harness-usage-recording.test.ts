import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { defaultDataRetention } from '../../../src/core/resource/data-store.js'
import { AgentHarness } from '../../../src/harness/agent-harness.js'
import { WorkerDataRecorder } from '../../../src/infrastructure/data/worker-data-recorder.js'
import { FakeAgentProvider } from '../../support/fake-agent-provider.js'
import { testRunSpec } from '../../support/run-spec.js'

describe('harness usage recording end to end', () => {
  let dir: string
  let recorder: WorkerDataRecorder

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'priva-usage-e2e-'))
    recorder = new WorkerDataRecorder({
      dbPath: join(dir, '.data.db'), retention: defaultDataRetention(), pruneIntervalMs: 60_000,
      logger: { info: () => undefined, warn: () => undefined, error: (message) => { throw new Error(message) } },
    })
    recorder.start()
  })

  afterEach(async () => {
    await recorder.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('lands a completed and a failed turn in run_fact with per-model usage', async () => {
    const completed = new FakeAgentProvider('claude', [{
      type: 'run.completed', model: 'sonnet', durationMs: 3, numTurns: 2,
      usage: { input: 10, output: 20, cacheRead: 300, cacheWrite: 40 }, costUsd: 0.02,
      byModel: {
        sonnet: { input: 10, output: 15, cacheRead: 300, cacheWrite: 40, costUsd: 0.019 },
        haiku: { input: 0, output: 5, cacheRead: 0, cacheWrite: 0, costUsd: 0.001 },
      },
    }])
    const failed = new FakeAgentProvider('pi', [{ type: 'run.failed', message: '429 too many', code: 'api_error', model: 'gpt' }])
    const harness = new AgentHarness({ providers: { claude: completed, pi: failed }, cwd: '/tmp', recorder })

    const consume = async (spec: ReturnType<typeof testRunSpec>, runId: string): Promise<void> => {
      for await (const frame of harness.run({ text: 'go' }, { signal: new AbortController().signal }, spec, { source: 'web', runId })) {
        expect(frame.runId).toBe(runId)
      }
    }
    await consume(testRunSpec({ provider: 'claude', model: 'sonnet', profileId: 'p' }), 'r-ok')
    await consume(testRunSpec({ provider: 'pi', model: 'gpt' }), 'r-bad')
    expect(await recorder.flush()).toBe(true)

    const db = new DatabaseSync(join(dir, '.data.db'), { readOnly: true })
    try {
      expect(db.prepare(`
        SELECT run_id, session_id, provider, profile_id, source, outcome, failure_code, num_turns,
               input_tokens, cache_read_tokens, cost_usd
          FROM run_fact ORDER BY id`).all()).toEqual([
        {
          run_id: 'r-ok', session_id: 'session-1', provider: 'claude', profile_id: 'p', source: 'web', outcome: 'completed',
          failure_code: null, num_turns: 2, input_tokens: 10, cache_read_tokens: 300, cost_usd: 0.02,
        },
        {
          run_id: 'r-bad', session_id: 'session-1', provider: 'pi', profile_id: null, source: 'web', outcome: 'failed',
          failure_code: 'api_error', num_turns: null, input_tokens: null, cache_read_tokens: null, cost_usd: null,
        },
      ])
      expect(db.prepare('SELECT model, output_tokens, cost_usd FROM run_model_usage ORDER BY model').all()).toEqual([
        { model: 'haiku', output_tokens: 5, cost_usd: 0.001 },
        { model: 'sonnet', output_tokens: 15, cost_usd: 0.019 },
      ])
      expect(db.prepare('SELECT action, run_id, session_id FROM audit_event ORDER BY id').all()).toEqual([
        { action: 'run.started', run_id: 'r-ok', session_id: null },
        { action: 'session.created', run_id: 'r-ok', session_id: 'session-1' },
        { action: 'run.finished', run_id: 'r-ok', session_id: 'session-1' },
        { action: 'run.started', run_id: 'r-bad', session_id: null },
        { action: 'session.created', run_id: 'r-bad', session_id: 'session-1' },
        { action: 'run.finished', run_id: 'r-bad', session_id: 'session-1' },
      ])
    } finally {
      db.close()
    }
  })
})

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
import { RunLedger } from '../../../src/harness/run/run-ledger.js'
import { TerminalInteractions } from '../../../src/harness/terminal/terminal-interactions.js'
import type { InteractionRequest } from '../../../src/core/resource/interaction.js'

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

  it('persists interrupted usage and cost in the same facts and audit as completed turns', async () => {
    const provider = new FakeAgentProvider('claude', [{ type: 'run.aborted', message: 'Interrupted', apiDurationMs: 100, numTurns: 1,
      usage: { input: 10, output: 5, cacheRead: 20, cacheWrite: 30 }, costUsd: 0.02,
      byModel: { sonnet: { input: 10, output: 5, cacheRead: 20, cacheWrite: 30 } } }])
    const harness = new AgentHarness({ providers: { claude: provider, pi: new FakeAgentProvider('pi', []) }, cwd: '/tmp', recorder })
    for await (const frame of harness.run({ text: 'work' }, { signal: new AbortController().signal }, testRunSpec(), { source: 'web', runId: 'r-interrupted' })) {
      expect(frame.runId).toBe('r-interrupted')
    }
    expect(await recorder.flush()).toBe(true)
    const today = new Date().toISOString().slice(0, 10)
    expect(await recorder.range({ timeZone: 'UTC', from: today, to: today })).toMatchObject({
      aborted: 1, inputTokens: 10, outputTokens: 5, cacheReadTokens: 20, cacheWriteTokens: 30, costUsd: 0.02, runsWithoutCost: 0,
    })
    const db = new DatabaseSync(join(dir, '.data.db'), { readOnly: true })
    try {
      expect(db.prepare('SELECT outcome, num_turns, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd FROM run_fact').get())
        .toEqual({ outcome: 'aborted', num_turns: 1, input_tokens: 10, output_tokens: 5, cache_read_tokens: 20, cache_write_tokens: 30, cost_usd: 0.02 })
      expect(db.prepare('SELECT model, input_tokens, output_tokens FROM run_model_usage').all()).toEqual([{ model: 'sonnet', input_tokens: 10, output_tokens: 5 }])
      expect(db.prepare("SELECT COUNT(*) AS count FROM audit_event WHERE action = 'run.finished' AND run_id = 'r-interrupted'").get()).toEqual({ count: 1 })
    } finally { db.close() }
  })

  it('stores one authoritative native answer rather than the mirror cancellation', async () => {
    const ledger = new RunLedger(recorder, { runId: 'native-answer', sessionId: 's', spec: testRunSpec(), turn: { text: 'Ask' },
      source: 'web', sessionTarget: { kind: 'resume', session: { provider: 'claude', id: 's' } } })
    const interactions = new TerminalInteractions((event) => ledger.observe(event))
    const request: InteractionRequest = { kind: 'question', requestId: 'request', toolUseId: 'ask', tool: 'AskUserQuestion', expiresAt: 0,
      questions: [{ id: 'q0', question: 'Color?', options: [{ label: 'Blue' }], multiSelect: false }] }
    interactions.mirror({ type: 'permission.requested', request })
    interactions.mirror({ type: 'permission.resolved', resolution: { request, decision: 'deny', reason: 'cancelled' } })
    const resolution = { request: { ...request, requestId: 'history:ask' }, decision: 'allow' as const, reason: 'answered' as const,
      answers: { q0: { selected: [], text: 'Blue' } } }
    interactions.native({ type: 'permission.resolved', resolution }, 'hook')
    interactions.native({ type: 'permission.resolved', resolution }, 'transcript')
    interactions.finish()
    ledger.observe({ type: 'run.completed', model: 'm', durationMs: 1 })
    expect(await recorder.flush()).toBe(true)
    const page = await recorder.auditPage({ limit: 10, action: 'question.answered', sessionId: 's' })
    expect(page.entries).toHaveLength(1)
    expect(page.entries[0]).toMatchObject({ runId: 'native-answer', details: { requestId: 'request', toolUseId: 'ask', decision: 'allow',
      reason: 'answered', answers: { q0: { selected: [], text: 'Blue' } } } })
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

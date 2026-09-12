import { describe, expect, it } from 'vitest'

import type { AgentEvent, StreamFrame } from '../../../../src/core/event/agent-event.js'
import { AgentHarness } from '../../../../src/harness/agent-harness.js'
import { FakeAgentProvider } from '../../../support/fake-agent-provider.js'
import { MemoryDataRecorder } from '../../../support/memory-data-recorder.js'
import { testRunSpec } from '../../../support/run-spec.js'

function harnessWith(events: readonly AgentEvent[], recorder: MemoryDataRecorder): { harness: AgentHarness; provider: FakeAgentProvider } {
  const provider = new FakeAgentProvider('claude', events)
  const harness = new AgentHarness({
    providers: { claude: provider, pi: new FakeAgentProvider('pi', []) },
    cwd: '/tmp',
    recorder,
  })
  return { harness, provider }
}

async function drain(harness: AgentHarness, signal = new AbortController().signal, text = 'hello there'): Promise<StreamFrame[]> {
  const frames: StreamFrame[] = []
  for await (const frame of harness.run(
    { text, attachments: [{ path: '/tmp/a.txt', name: 'a.txt', mimeType: 'text/plain', size: 3 }] },
    { signal },
    testRunSpec({ cwd: '/work', profileId: 'p1', model: 'sonnet' }),
    { source: 'subagent-test', runId: 'run-1' },
  )) frames.push(frame)
  return frames
}

describe('RunLedger through AgentHarness', () => {
  it('records started, session back-fill and a completed finish with accounting', async () => {
    const recorder = new MemoryDataRecorder()
    const { harness } = harnessWith([
      { type: 'assistant.delta', messageId: 'm', blockId: 'm:0', index: 0, text: 'Hi' },
      {
        type: 'run.completed', sessionId: 'sess-1', model: 'sonnet', durationMs: 5, apiDurationMs: 4, numTurns: 2,
        usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, costUsd: 0.5,
        byModel: { sonnet: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, costUsd: 0.5 } },
      },
    ], recorder)
    await drain(harness)

    expect(recorder.records.map((record) => record.kind)).toEqual(['run.started', 'run.session', 'run.finished'])
    expect(recorder.ofKind('run.started')[0]).toMatchObject({
      runId: 'run-1', provider: 'claude', profileId: 'p1', model: 'sonnet', source: 'subagent-test',
      promptChars: 'hello there'.length, attachmentCount: 1,
      details: { promptPreview: 'hello there', attachments: ['a.txt'], cwd: '/work' },
    })
    expect(recorder.ofKind('run.started')[0]).not.toHaveProperty('sessionId')
    expect(recorder.ofKind('run.session')[0]).toEqual({ kind: 'run.session', runId: 'run-1', sessionId: 'session-1' })
    expect(recorder.ofKind('run.finished')[0]).toMatchObject({
      runId: 'run-1', outcome: 'completed', apiDurationMs: 4, numTurns: 2,
      usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, costUsd: 0.5,
      byModel: { sonnet: { input: 1, output: 2 } },
      details: { type: 'run.completed' },
    })
    expect(recorder.ofKind('run.finished')[0]).not.toHaveProperty('failureCode')
    expect(recorder.ofKind('run.finished')[0]?.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('carries the session id on run.started when the target is known up front', async () => {
    const recorder = new MemoryDataRecorder()
    const { harness } = harnessWith([{ type: 'run.completed', sessionId: 'sess-9', model: 'm', durationMs: 1 }], recorder)
    const frames = harness.run(
      { text: 'again' }, { signal: new AbortController().signal }, testRunSpec(),
      { source: 'web', session: { kind: 'resume', session: { provider: 'claude', id: 'sess-9' } } },
    )
    for await (const frame of frames) expect(frame.runId).toBeDefined()
    expect(recorder.ofKind('run.started')[0]?.sessionId).toBe('sess-9')
    expect(recorder.ofKind('run.session')).toEqual([])
  })

  it('maps run.failed, run.aborted and error events onto outcomes and codes', async () => {
    const cases: [AgentEvent, Record<string, unknown>][] = [
      [{ type: 'run.failed', message: 'nope', code: 'api_error', model: 'm', durationMs: 1, usage: { input: 5, output: 0 } },
        { outcome: 'failed', failureCode: 'api_error', usage: { input: 5, output: 0 } }],
      [{ type: 'run.failed', message: 'nope', model: 'm' }, { outcome: 'failed', failureCode: 'unknown' }],
      [{ type: 'run.aborted', message: 'stop' }, { outcome: 'aborted' }],
      [{ type: 'error', message: 'socket gone' }, { outcome: 'failed', failureCode: 'transport_error' }],
    ]
    for (const [event, expected] of cases) {
      const recorder = new MemoryDataRecorder()
      const { harness } = harnessWith([event], recorder)
      await drain(harness)
      expect(recorder.ofKind('run.finished')).toHaveLength(1)
      expect(recorder.ofKind('run.finished')[0]).toMatchObject(expected)
    }
  })

  it('closes the run as runtime_crash when the provider stream throws', async () => {
    const recorder = new MemoryDataRecorder()
    const { harness, provider } = harnessWith([], recorder)
    provider.lastRuntime = undefined
    const boom = new Error('provider exploded')
    provider.openSession = async (target, spec) => {
      const runtime = await FakeAgentProvider.prototype.openSession.call(provider, target, spec)
      runtime.run = async function* failing(): AsyncIterable<AgentEvent> {
        yield { type: 'assistant.delta', messageId: 'm', blockId: 'm:0', index: 0, text: 'x' }
        await Promise.resolve()
        throw boom
      }
      return runtime
    }
    const frames = await drain(harness)

    expect(frames.at(-1)).toMatchObject({ type: 'run.failed', message: 'provider exploded', code: 'runtime_crash' })
    expect(recorder.ofKind('run.finished')).toEqual([
      expect.objectContaining({ outcome: 'failed', failureCode: 'runtime_crash', details: { message: 'provider exploded' } }),
    ])
  })

  it('still records a failed turn when the session cannot be opened', async () => {
    const recorder = new MemoryDataRecorder()
    const { harness, provider } = harnessWith([], recorder)
    provider.openSession = () => Promise.reject(new Error('no such session'))
    await expect(drain(harness)).rejects.toThrow('no such session')

    expect(recorder.records.map((record) => record.kind)).toEqual(['run.started', 'run.finished'])
    expect(recorder.ofKind('run.finished')[0]).toMatchObject({ outcome: 'failed', failureCode: 'runtime_crash' })
  })

  it('settles as aborted when the stream closes after an abort without a terminal event', async () => {
    const recorder = new MemoryDataRecorder()
    const { harness, provider } = harnessWith([
      { type: 'assistant.delta', messageId: 'm', blockId: 'm:0', index: 0, text: 'x' },
    ], recorder)
    let release: () => void = () => undefined
    provider.afterEventsGate = new Promise<void>((resolve) => { release = resolve })
    const controller = new AbortController()
    const pending = drain(harness, controller.signal)
    await new Promise((resolve) => setTimeout(resolve, 10))
    controller.abort()
    release()
    await pending

    expect(recorder.ofKind('run.finished')).toEqual([
      expect.objectContaining({ outcome: 'aborted', details: { reason: 'stream closed after abort' } }),
    ])
  })

  it('records nothing when no recorder is configured', async () => {
    const provider = new FakeAgentProvider('claude', [{ type: 'run.completed', model: 'm', durationMs: 1 }])
    const harness = new AgentHarness({ providers: { claude: provider, pi: new FakeAgentProvider('pi', []) }, cwd: '/tmp' })
    const frames = await drain(harness)
    expect(frames.at(-1)?.type).toBe('run.completed')
  })
})

import type { CanUseTool, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../../../src/core/event/agent-event.js'
import { AsyncQueue } from '../../../../src/core/stream/async-queue.js'
import { ClaudeRuntime, type ClaudeQuery } from '../../../../src/provider/claude/claude-runtime.js'
import { testRunSpec } from '../../../support/run-spec.js'

async function fixture() {
  const source = new AsyncQueue<SDKMessage>()
  const controller = new AbortController()
  const events: AgentEvent[] = []
  let callback: CanUseTool | undefined
  const query: ClaudeQuery = { [Symbol.asyncIterator]: () => source.iterate()[Symbol.asyncIterator](),
    close: () => source.close(), interrupt: () => Promise.resolve(undefined), setModel: () => Promise.resolve(), getContextUsage: () => Promise.reject(new Error('unused')) }
  const runtime = new ClaudeRuntime(testRunSpec(), { kind: 'new', provider: 'claude', sessionId: 'interaction-test' }, '/tmp/priva-interaction-tests', ({ options }) => {
    callback = options.canUseTool
    return query
  })
  const consuming = (async () => { for await (const event of runtime.run({ text: 'ask' }, { signal: controller.signal })) events.push(event) })()
  await vi.waitFor(() => expect(callback).toBeTypeOf('function'))
  const request = async () => {
    await vi.waitFor(() => expect(events.some((event) => event.type === 'permission.requested')).toBe(true))
    const event = [...events].reverse().find((event) => event.type === 'permission.requested')
    if (event?.type !== 'permission.requested') throw new Error('Missing request')
    return event.request
  }
  const call: CanUseTool = (...args) => {
    if (!callback) throw new Error('Missing SDK callback')
    return callback(...args)
  }
  const close = async () => { source.push({ type: 'result', subtype: 'success', session_id: 'interaction-test', duration_ms: 1 } as SDKMessage); await consuming; await runtime.release('dispose') }
  return { runtime, call, request, close, controller }
}

describe('Claude interaction callback', () => {
  it('returns the real SDK answers map without parsing free-text separators', async () => {
    const { runtime, call, request, close } = await fixture()
    const questions = [{ question: 'Where?', header: 'Region', options: [{ label: 'Asia' }] }]
    const waiting = call('AskUserQuestion', { questions }, { signal: new AbortController().signal, toolUseID: 'q-tool', requestId: 'sdk-request' })
    const pending = await request()
    expect(pending).toMatchObject({ kind: 'question', toolUseId: 'q-tool' })
    runtime.respondPermission({ requestId: pending.requestId, decision: 'allow', answers: { q0: { selected: [], text: '日本 -> 东京\n含 "引号"' } } })
    expect(await waiting).toEqual({ behavior: 'allow', updatedInput: { questions, answers: { 'Where?': '日本 -> 东京\n含 "引号"' } } })
    await close()
  })

  it('asks even without a reason in bypass mode and resumes with a denial on skip', async () => {
    const { runtime, call, request, close } = await fixture()
    const waiting = call('Bash', { command: 'echo checked' }, { signal: new AbortController().signal, toolUseID: 'tool', requestId: 'sdk-rule', matchedAskRule: { source: 'user', toolName: 'Bash' } })
    const pending = await request()
    expect(pending.kind).toBe('tool')
    runtime.respondPermission({ requestId: pending.requestId, decision: 'deny' })
    expect(await waiting).toMatchObject({ behavior: 'deny', message: expect.stringContaining('skipped') as unknown })
    await close()
  })

  it('cancels outstanding requests on run abort and rejects malformed questions', async () => {
    const { call, request, controller, close } = await fixture()
    const context = { signal: new AbortController().signal, toolUseID: 'tool', requestId: 'sdk' }
    expect(await call('AskUserQuestion', { questions: [] }, context)).toMatchObject({ behavior: 'deny' })
    const waiting = call('Bash', { command: 'echo waiting' }, context)
    await request()
    controller.abort()
    expect(await waiting).toMatchObject({ behavior: 'deny', message: expect.stringContaining('cancelled') as unknown })
    await close()
  })
})

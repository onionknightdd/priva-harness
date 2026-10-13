import type { ExtensionToolContext, ExtensionUIContext } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../../../src/core/event/agent-event.js'
import { PiInteractions } from '../../../../src/provider/pi/pi-interactions.js'

const executeTool: ExtensionToolContext['executeTool'] = () => Promise.reject(new Error('Unexpected nested tool call'))
const toolContext = { tools: [] as ExtensionToolContext['tools'], executeTool } as ExtensionToolContext

function fixture() {
  const bridge = new PiInteractions()
  const events: AgentEvent[] = []
  bridge.subscribe((event) => events.push(event))
  const request = () => {
    const event = [...events].reverse().find((event) => event.type === 'permission.requested')
    if (event?.type !== 'permission.requested') throw new Error('Missing request')
    return event.request
  }
  return { bridge, ui: bridge.ui({} as ExtensionUIContext), request, events }
}

describe('Pi native interaction bridge', () => {
  it('registers a question tool that suspends execution and returns the submitted answers', async () => {
    const { bridge, request } = fixture()
    const result = bridge.tool.execute('call-1', { questions: [{ question: 'Details?' }] }, undefined, undefined, toolContext)
    expect(request()).toMatchObject({ kind: 'question', tool: 'ask_user_question', toolUseId: 'call-1' })
    bridge.respond({ requestId: request().requestId, decision: 'allow', answers: { q0: { selected: [], text: '中文 -> "answer"' } } })
    expect(await result).toMatchObject({ content: [{ type: 'text', text: JSON.stringify({ answers: { 'Details?': '中文 -> "answer"' } }) }] })
    const skipped = bridge.tool.execute('call-2', { questions: [{ question: 'Details?' }] }, undefined, undefined, toolContext)
    bridge.respond({ requestId: request().requestId, decision: 'deny' })
    await expect(skipped).rejects.toThrow('User interaction skipped')
  })

  it('bridges select and free-text input to question cards', async () => {
    const { bridge, ui, request } = fixture()
    const selected = ui.select('Region?', [' Asia ', 'Europe'])
    expect(request()).toMatchObject({ kind: 'question', questions: [{ question: 'Region?' }] })
    expect(() => bridge.respond({ requestId: request().requestId, decision: 'allow', answers: { q0: { selected: [], text: 'Invalid region' } } })).toThrow('available options')
    bridge.respond({ requestId: request().requestId, decision: 'allow', answers: { q0: { selected: [' Asia '], text: '' } } })
    expect(await selected).toBe(' Asia ')
    const input = ui.input('Details?')
    bridge.respond({ requestId: request().requestId, decision: 'allow', answers: { q0: { selected: [], text: '中文自定义内容' } } })
    expect(await input).toBe('中文自定义内容')
  })

  it('bridges confirmations to tool approval and preserves skip/cancel semantics', async () => {
    const { bridge, ui, request } = fixture()
    const confirm = ui.confirm('Run tool?', 'Touches a protected file')
    expect(request()).toMatchObject({ kind: 'tool', title: 'Run tool?', reason: 'Touches a protected file' })
    bridge.respond({ requestId: request().requestId, decision: 'deny' })
    expect(await confirm).toBe(false)
    const waiting = ui.input('Answer?')
    bridge.cancel()
    expect(await waiting).toBeUndefined()
  })

  it('keeps editor prefill editable and preserves whitespace in native text responses', async () => {
    const { bridge, ui, request } = fixture()
    const result = ui.editor('Edit instructions', '  first line\nsecond line\n')
    expect(request()).toMatchObject({ questions: [{ question: 'Edit instructions', initialText: '  first line\nsecond line\n', multiline: true }] })
    bridge.respond({ requestId: request().requestId, decision: 'allow', answers: { q0: { selected: [], text: '  edited line\nnext line\n' } } })
    expect(await result).toBe('  edited line\nnext line\n')
  })

  it('fails explicitly for terminal-only custom UI', async () => {
    const { ui } = fixture()
    await expect(ui.custom(() => { throw new Error('should not execute') })).rejects.toThrow('terminal UI')
  })
})

it('keeps repeated native UI binding idempotent and cancels the terminal dialog when Chat answers first', async () => {
  const { bridge, request, events } = fixture()
  let nativeSignal: AbortSignal | undefined
  const base = { select: (_title: string, _options: string[], opts?: { signal?: AbortSignal }) => {
    nativeSignal = opts?.signal
    return new Promise<string | undefined>((resolve) => opts?.signal?.addEventListener('abort', () => resolve(undefined), { once: true }))
  } } as ExtensionUIContext
  const ui = bridge.ui(base, true)
  expect(bridge.ui(ui, true)).toBe(ui)
  expect(bridge.ui(base, true)).toBe(ui)
  const answer = ui.select('Choose', ['One', 'Two'])
  await Promise.resolve()
  bridge.respond({ requestId: request().requestId, decision: 'allow', answers: { q0: { selected: ['Two'], text: '' } } })
  expect(await answer).toBe('Two')
  expect(nativeSignal?.aborted).toBe(true)
  expect(events.filter((event) => event.type === 'permission.requested')).toHaveLength(1)
})

it('accepts a native terminal answer and ignores a late Chat response', async () => {
  const { bridge, request, events } = fixture()
  const ui = bridge.ui({ select: () => Promise.resolve('One') } as unknown as ExtensionUIContext, true)
  expect(await ui.select('Choose', ['One', 'Two'])).toBe('One')
  bridge.respond({ requestId: request().requestId, decision: 'allow', answers: { q0: { selected: ['Two'], text: '' } } })
  const resolutions = events.filter((event) => event.type === 'permission.resolved')
  expect(resolutions).toHaveLength(2)
  expect(resolutions[1]?.resolution.answers?.['q0']?.selected).toEqual(['One'])
})

import type { Options, SDKControlGetContextUsageResponse, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it, vi } from 'vitest'

import type { AgentEvent } from '../../../../src/core/event/agent-event.js'
import { consumeRunEvents } from '../../../../src/harness/run/consume-run-events.js'
import { emptyContextUsage } from '../../../../src/core/resource/context-usage.js'
import {
  ClaudeRuntime,
  resolveClaudeQueryOptions,
  type ClaudeQuery,
} from '../../../../src/provider/claude/claude-runtime.js'
import { testRunSpec } from '../../../support/run-spec.js'
import { userTurnFromText } from '../../../../src/core/run/user-turn.js'
import { defineTool } from '../../../../src/core/tool/define-tool.js'

describe('ClaudeRuntime stream input', () => {
  it('rejects Pi-only effort levels before calling the Claude SDK', () => {
    for (const effort of ['off', 'minimal'] as const) {
      expect(() => resolveClaudeQueryOptions(testRunSpec({ effort }))).toThrow('Unsupported Claude effort')
    }
  })

  it('sets a native title for a new attachment-only session and preserves empty user text', async () => {
    let options: Options | undefined
    let query: FakeClaudeQuery | undefined
    const runtime = new ClaudeRuntime(testRunSpec(), { kind: 'new', provider: 'claude' }, '/tmp/claude', (args) => {
      options = args.options
      query = new FakeClaudeQuery(args.prompt)
      return query
    })
    const turn = { text: '', attachments: [{ path: '/tmp/README.md', name: 'README.md', mimeType: 'text/markdown', size: 1 }] }
    await collect(runtime.run(turn, { signal: new AbortController().signal }))
    expect(options?.title).toBe('README.md')
    expect(userTurnFromText(userTexts(query?.received)[0] ?? '')).toEqual(turn)
    await runtime.release('dispose')
  })

  it('does not override a resumed session title for an attachment-only follow-up', async () => {
    let options: Options | undefined
    const runtime = new ClaudeRuntime(testRunSpec(), { kind: 'resume', session: { provider: 'claude', id: 'sess-stream' } }, '/tmp/claude', (args) => {
      options = args.options
      return new FakeClaudeQuery(args.prompt)
    })
    await collect(runtime.run({ text: '', attachments: [{ path: '/tmp/README.md', name: 'README.md', mimeType: 'text/markdown', size: 1 }] }, { signal: new AbortController().signal }))
    expect(options?.title).toBeUndefined()
    await runtime.release('dispose')
  })
  it('reports product tool progress on the call that produced it', async () => {
    const imageRead = defineTool({
      name: 'image_read', description: 'Progress fixture', inputSchema: { type: 'object', properties: {} },
      execute: (_args, context) => {
        context.emitProgress?.('half')
        return Promise.resolve({ ok: true, text: 'done' })
      },
    })
    const runtime = new ClaudeRuntime(testRunSpec(), { kind: 'new', provider: 'claude' }, '/tmp/claude', ({ prompt, options }) =>
      new FakeClaudeQuery(prompt, false, async function* () {
        // Another tool starts after the image read and before its progress.
        yield { type: 'assistant', session_id: 'sess-stream', message: { id: 'msg_1', content: [
          { type: 'tool_use', id: 'read-1', name: 'mcp__agentWorkshop__image_read', input: {} },
          { type: 'tool_use', id: 'bash-1', name: 'Bash', input: {} },
        ] } } as unknown as SDKMessage
        await productToolHandler(options, 'image_read')({}, {})
      }), [imageRead])

    const events = await collect(runtime.run({ text: 'look' }, { signal: new AbortController().signal }))
    expect(events.filter((event) => event.type === 'tool.progress')).toEqual([
      { type: 'tool.progress', id: 'read-1', channel: 'log', chunk: 'half' },
    ])
    await runtime.release('dispose')
  })

  it('includes attached files in the actual SDK user message', async () => {
    let query: FakeClaudeQuery | undefined
    const runtime = new ClaudeRuntime(testRunSpec(), { kind: 'new', provider: 'claude' }, '/tmp/claude', ({ prompt, options }) => {
      expect(options.title).toBeUndefined()
      query = new FakeClaudeQuery(prompt)
      return query
    })
    const turn = { text: 'read it', attachments: [{ path: '/tmp/report.txt', name: 'report.txt', mimeType: 'text/plain', size: 1 }] }
    await collect(runtime.run(turn, { signal: new AbortController().signal }))
    expect(userTurnFromText(userTexts(query?.received)[0] ?? '')).toEqual(turn)
    await runtime.release('dispose')
  })
  it('keeps the prompt iterable open after the first turn until release', async () => {
    let query: FakeClaudeQuery | undefined
    let started = 0
    const runtime = new ClaudeRuntime(
      testRunSpec(),
      { kind: 'new', provider: 'claude' },
      '/tmp/claude',
      ({ prompt }) => {
        started += 1
        query = new FakeClaudeQuery(prompt)
        return query
      },
    )

    const first = await collect(runtime.run(
      { text: 'hello' },
      { signal: new AbortController().signal },
    ))
    expect(first).toEqual([
      expect.objectContaining({
        type: 'run.completed',
        sessionId: 'sess-stream',
      }),
    ])
    await query?.turnReady
    expect(query?.waitingForMore).toBe(true)
    expect(userTexts(query?.received)).toEqual(['hello'])
    expect(started).toBe(1)

    const second = await collect(runtime.run(
      { text: 'again' },
      { signal: new AbortController().signal },
    ))
    expect(second).toEqual([
      expect.objectContaining({
        type: 'run.completed',
        sessionId: 'sess-stream',
      }),
    ])
    expect(userTexts(query?.received)).toEqual(['hello', 'again'])
    expect(started).toBe(1)
    expect(query?.waitingForMore).toBe(true)

    await runtime.release('dispose')
    await query?.promptEnded
    expect(query?.waitingForMore).toBe(false)
  })

  it('keeps the query open on warm release', async () => {
    let query: FakeClaudeQuery | undefined
    const runtime = new ClaudeRuntime(
      testRunSpec(),
      { kind: 'new', provider: 'claude' },
      '/tmp/claude',
      ({ prompt }) => {
        query = new FakeClaudeQuery(prompt)
        return query
      },
    )
    await collect(runtime.run(
      { text: 'hello' },
      { signal: new AbortController().signal },
    ))
    await query?.turnReady
    await runtime.release('warm')
    expect(query?.waitingForMore).toBe(true)
    await runtime.release('dispose')
    await query?.promptEnded
    expect(query?.waitingForMore).toBe(false)
  })

  it('switches the warm query model without starting a new query', async () => {
    let query: FakeClaudeQuery | undefined
    let started = 0
    const runtime = new ClaudeRuntime(
      testRunSpec({ model: 'm1' }),
      { kind: 'new', provider: 'claude' },
      '/tmp/claude',
      ({ prompt }) => {
        started += 1
        query = new FakeClaudeQuery(prompt)
        return query
      },
    )

    await collect(runtime.run(
      { text: 'hello' },
      { signal: new AbortController().signal },
    ))
    await query?.turnReady
    await runtime.applyRunSpec(testRunSpec({ model: 'm2' }))
    expect(query?.models).toEqual(['m2'])
    expect(query?.settings).toHaveLength(1)
    expect(query?.settings[0]?.model).toBe('m2')
    expect(query?.settings[0]?.env).toMatchObject({
      ANTHROPIC_MODEL: 'm2',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'm2',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'm2',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'm2',
      ANTHROPIC_DEFAULT_FABLE_MODEL: 'm2',
    })

    const second = await collect(runtime.run(
      { text: 'again' },
      { signal: new AbortController().signal },
    ))
    expect(second).toEqual([
      expect.objectContaining({
        type: 'run.completed',
        sessionId: 'sess-stream',
      }),
    ])
    expect(userTexts(query?.received)).toEqual(['hello', 'again'])
    expect(started).toBe(1)
    await runtime.release('dispose')
  })

  it('resumes the session in a new query after the previous process exits', async () => {
    const started: Options[] = []
    const runtime = new ClaudeRuntime(testRunSpec(), { kind: 'new', provider: 'claude', sessionId: 'sess-stream' }, '/tmp/claude', ({ prompt, options }) => {
      started.push(options)
      return new FakeClaudeQuery(prompt, started.length === 1)
    })
    const idle: AgentEvent[] = []
    runtime.listenIdle((events) => idle.push(...events))

    expect(await collect(runtime.run({ text: 'one' }, { signal: new AbortController().signal })))
      .toEqual([expect.objectContaining({ type: 'run.completed' })])
    await runtime.release('warm')
    await vi.waitFor(() => expect(idle).toEqual([
      expect.objectContaining({ type: 'run.failed', message: 'Claude session process ended unexpectedly' }),
    ]))
    expect(runtime.hasBackgroundTasks).toBe(false)

    expect(await collect(runtime.run({ text: 'two' }, { signal: new AbortController().signal })))
      .toEqual([expect.objectContaining({ type: 'run.completed' })])
    expect(started).toHaveLength(2)
    expect(started[0]).toMatchObject({ sessionId: 'sess-stream' })
    expect(started[1]).toMatchObject({ resume: 'sess-stream' })
    expect(started[1]?.sessionId).toBeUndefined()
    await runtime.release('dispose')
  })

  it('reads context usage from the live query after a turn', async () => {
    let query: FakeClaudeQuery | undefined
    const runtime = new ClaudeRuntime(
      testRunSpec(),
      { kind: 'new', provider: 'claude' },
      '/tmp/claude',
      ({ prompt }) => {
        query = new FakeClaudeQuery(prompt)
        return query
      },
    )
    expect(await runtime.getContextUsage()).toEqual(emptyContextUsage())
    await collect(runtime.run(
      { text: 'hello' },
      { signal: new AbortController().signal },
    ))
    await query?.turnReady
    expect(await runtime.getContextUsage()).toEqual({
      used: 20,
      limit: 200,
      categories: [
        { id: 'systemPrompt', tokens: 5 },
        { id: 'toolDefinitions', tokens: 10 },
        { id: 'skills', tokens: null },
        { id: 'mcpTools', tokens: null },
        { id: 'subagentDefinitions', tokens: null },
        { id: 'memory', tokens: null },
        { id: 'conversation', tokens: 5 },
      ],
    })
    await runtime.release('dispose')
  })
})

// The SDK keeps the handlers it was given on its in-process MCP server.
function productToolHandler(options: Options, name: string): (args: unknown, extra: unknown) => Promise<unknown> {
  const server = options.mcpServers?.['agentWorkshop'] as unknown as {
    instance: { _registeredTools: Record<string, { handler(args: unknown, extra: unknown): Promise<unknown> }> }
  } | undefined
  const tool = server?.instance._registeredTools[name]
  if (!tool) throw new Error(`Product tool ${name} is not registered`)
  return (args, extra) => tool.handler(args, extra)
}

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const collected: AgentEvent[] = []
  for await (const event of consumeRunEvents(events)) collected.push(event)
  return collected
}

function userTexts(messages: readonly SDKUserMessage[] | undefined): string[] {
  if (messages === undefined) return []
  return messages.map((message) => {
    const content = message.message.content
    return typeof content === 'string' ? content : ''
  })
}

class FakeClaudeQuery implements ClaudeQuery {
  waitingForMore = false
  readonly received: SDKUserMessage[] = []
  readonly turnReady: Promise<void>
  readonly promptEnded: Promise<void>
  readonly models: string[] = []
  readonly settings: Parameters<ClaudeQuery['applyFlagSettings']>[0][] = []
  readonly interrupt = (): Promise<undefined> => Promise.resolve(undefined)
  readonly close = (): void => undefined
  readonly applyFlagSettings: ClaudeQuery['applyFlagSettings'] = (settings) => {
    this.settings.push(settings)
    this.models.push(settings.model ?? '')
    return Promise.resolve()
  }
  readonly getContextUsage = (): Promise<SDKControlGetContextUsageResponse> => Promise.resolve({
    categories: [
      { name: 'System prompt', tokens: 5, color: '', kind: 'used' },
      { name: 'System tools', tokens: 10, color: '', kind: 'used' },
      { name: 'Messages', tokens: 5, color: '', kind: 'used' },
    ],
    totalTokens: 20,
    maxTokens: 200,
    rawMaxTokens: 200,
    percentage: 10,
    gridRows: [],
    model: 'm',
    memoryFiles: [],
    mcpTools: [],
    agents: [],
    isAutoCompactEnabled: true,
    apiUsage: null,
  })

  private readonly resolveTurnReady: () => void
  private readonly resolvePromptEnded: () => void

  constructor(
    private readonly prompt: AsyncIterable<SDKUserMessage>,
    private readonly exitAfterFirstTurn = false,
    // What the CLI reports for a turn before its result.
    private readonly turnMessages: () => Iterable<SDKMessage> | AsyncIterable<SDKMessage> = () => [],
  ) {
    let resolveTurnReady = (): void => undefined
    let resolvePromptEnded = (): void => undefined
    this.turnReady = new Promise((resolve) => {
      resolveTurnReady = resolve
    })
    this.promptEnded = new Promise((resolve) => {
      resolvePromptEnded = resolve
    })
    this.resolveTurnReady = resolveTurnReady
    this.resolvePromptEnded = resolvePromptEnded
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKMessage> {
    for await (const message of this.prompt) {
      this.received.push(message)
      this.waitingForMore = false
      yield* this.turnMessages()
      yield {
        type: 'result',
        subtype: 'success',
        session_id: 'sess-stream',
        duration_ms: 1,
      } as SDKMessage
      this.waitingForMore = true
      this.resolveTurnReady()
      // Stands in for the CLI process exiting between turns.
      if (this.exitAfterFirstTurn) break
    }
    this.waitingForMore = false
    this.resolvePromptEnded()
  }
}

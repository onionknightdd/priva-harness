import { expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { StreamFrame } from '../../../../src/core/event/agent-event.js'
import { MemoryDataRecorder } from '../../../support/memory-data-recorder.js'
import { modelMessage, nativeClaudeAvailable, nativeClaudeFixture } from '../../../fixtures/terminal/claude-tui-fixture.js'

it.skipIf(!nativeClaudeAvailable()).each(['allow', 'deny'] as const)('resumes a pending native question after browser reconnect and handles %s', async (decision) => {
  let calls = 0
  const fixture = await nativeClaudeFixture((body, reply) => modelMessage(body, reply, (body.stream ? ++calls : 0) === 1
    ? [{ type: 'tool_use', id: 'ask-1', name: 'AskUserQuestion', input: { questions: [
      { question: '选择测试颜色？', header: '颜色', options: [{ label: '红色', description: 'Red' }, { label: '蓝色', description: 'Blue' }], multiSelect: false },
    ] } }]
    : [{ type: 'text', text: '已收到回答' }], `question-${calls}`))
  let reader: WebSocket | undefined
  try {
    fixture.send('请问我一个颜色问题', 'ask-bubble')
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'permission.requested'), { timeout: 30000 }).toBe(true)
    const frame = fixture.frames.find((frame) => frame.type === 'permission.requested')
    if (frame?.type !== 'permission.requested') throw new Error('Missing question')
    expect(frame.request.kind).toBe('question')
    reader = new WebSocket(`${fixture.base}/session`)
    const reconnected: StreamFrame[] = []
    reader.on('message', (raw) => reconnected.push(JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : Buffer.from(raw as ArrayBuffer).toString('utf8')) as StreamFrame))
    await new Promise<void>((resolve) => reader?.once('open', resolve))
    fixture.socket.close()
    reader.send(JSON.stringify({ type: 'session.subscribe', harness: 'claude', sessionId: fixture.ref.id, sinceSeq: 0 }))
    await expect.poll(() => reconnected.some((event) => event.type === 'session.snapshot' && event.interactions?.some((request) => request.requestId === frame.request.requestId))).toBe(true)
    reader.send(JSON.stringify({ type: 'permission.respond', harness: 'claude', sessionId: fixture.ref.id,
      requestId: frame.request.requestId, decision, ...(decision === 'allow' ? { answers: { q0: { selected: ['蓝色'], text: '' } } } : {}) }))
    await expect.poll(() => reconnected.some((event) => event.type === 'run.completed' && event.runId === 'ask-bubble'), { timeout: 30000 }).toBe(true)
    const result = fixture.requests.at(-1)?.messages.at(-1)
    if (decision === 'allow') expect(JSON.stringify(result)).toContain('蓝色')
    else expect(result?.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'tool_result', is_error: true })]))
    expect(fixture.frames.filter((event) => event.type === 'permission.requested')).toHaveLength(1)
    expect(fixture.sdkOpen).not.toHaveBeenCalled()
  } catch (error) {
    if (fixture.ref.id) console.error(await fixture.terminals.capture(fixture.ref))
    console.error(fixture.frames.filter((frame) => frame.type === 'run.failed' || frame.type === 'error'))
    throw error
  } finally { reader?.close(); await fixture.dispose() }
}, 60000)

it.skipIf(!nativeClaudeAvailable())('retires the mirrored question when answered directly in the native TUI', async () => {
  let calls = 0
  const recorder = new MemoryDataRecorder()
  const fixture = await nativeClaudeFixture((body, reply) => modelMessage(body, reply, (body.stream ? ++calls : 0) === 1
    ? [{ type: 'tool_use', id: 'ask-native', name: 'AskUserQuestion', input: { questions: [
      { question: 'Choose a color?', header: 'Color', options: [{ label: 'Red', description: 'Red' }, { label: 'Blue', description: 'Blue' }], multiSelect: false },
    ] } }]
    : [{ type: 'text', text: 'Native answer received' }], `native-question-${calls}`), recorder)
  try {
    fixture.send('Ask a color question', 'ask-native')
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'permission.requested'), { timeout: 30000 }).toBe(true)
    await expect.poll(async () => (await fixture.terminals.capture(fixture.ref)).includes('Choose a color?')).toBe(true)
    await fixture.terminals.sendKeys(fixture.ref, ['Down'])
    await expect.poll(async () => (await fixture.terminals.capture(fixture.ref)).includes('❯ 2. Blue')).toBe(true)
    await fixture.terminals.sendKeys(fixture.ref, ['Enter'])
    await expect.poll(() => fixture.frames.some((frame) => frame.type === 'run.completed'), { timeout: 10000 }).toBe(true)
    expect(JSON.stringify(fixture.requests.at(-1)?.messages.at(-1))).toContain('Blue')
    expect(fixture.harness.sessionStream(fixture.ref).snapshot().interactions).toHaveLength(0)
    await expect.poll(() => fixture.harness.sessionStream(fixture.ref).snapshot().messages.some((message) => message.interactions?.some((item) => item.answers?.['q0']?.text === 'Blue'))).toBe(true)
    expect(fixture.frames.some((frame) => frame.type === 'permission.resolved')).toBe(true)
    expect(recorder.ofKind('audit').filter((record) => record.action === 'question.answered')).toEqual([
      expect.objectContaining({ runId: 'ask-native', sessionId: fixture.ref.id,
        details: expect.objectContaining({ decision: 'allow', reason: 'answered', answers: { q0: { selected: [], text: 'Blue' } } }) as unknown }),
    ])
    expect(fixture.sdkOpen).not.toHaveBeenCalled()
  } catch (error) {
    console.error(await fixture.terminals.capture(fixture.ref), fixture.frames.filter((frame) => ['error', 'run.failed'].includes(frame.type)))
    throw error
  } finally { await fixture.dispose() }
}, 60000)

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { consumeAgentTestStream, type TestFrame } from '../../../src/features/resources/agent-resource-api.ts'

test('agent test stream preserves split UTF-8 and SSE frames', async () => {
  const bytes = new TextEncoder().encode(': keepalive\r\n\r\ndata: {"type":"assistant.delta","text":"记忆"}\r\n\r\ndata: {"type":"run.completed"}\n\n')
  const frames: TestFrame[] = []
  const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close() } })
  await consumeAgentTestStream(stream, (frame) => frames.push(frame))
  assert.deepEqual(frames, [{ type: 'assistant.delta', text: '记忆' }, { type: 'run.completed' }])
})

test('agent test stream reports interrupted event data', async () => {
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"type":')); controller.close() } })
  await assert.rejects(consumeAgentTestStream(stream, () => {}), /incomplete event/)
})

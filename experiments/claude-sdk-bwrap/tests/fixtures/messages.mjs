import { randomUUID } from 'node:crypto'

export function replyMessage(response, request, content) {
  const stop_reason = content.some((block) => block.type === 'tool_use') ? 'tool_use' : 'end_turn'
  const message = { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant',
    model: request.model, content, stop_reason, stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20 } }
  if (!request.stream) {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(message))
    return
  }
  const events = [{ type: 'message_start', message: { ...message, content: [], stop_reason: null } }]
  content.forEach((block, index) => {
    const isTool = block.type === 'tool_use'
    events.push(
      { type: 'content_block_start', index, content_block: isTool ? { ...block, input: {} } : { ...block, text: '' } },
      { type: 'content_block_delta', index, delta: isTool
        ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) }
        : { type: 'text_delta', text: block.text } },
      { type: 'content_block_stop', index },
    )
  })
  events.push({ type: 'message_delta', delta: { stop_reason, stop_sequence: null }, usage: { output_tokens: 20 } },
    { type: 'message_stop' })
  if (!response.headersSent) response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  response.end(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
}

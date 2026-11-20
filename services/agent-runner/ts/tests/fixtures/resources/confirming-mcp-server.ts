// An MCP server that asks its client before acting, the way the desktop worker asks to use an
// application: `confirm` sends a form without fields, `form` asks for a value.
import { createInterface } from 'node:readline'

interface Message { id?: number | string; method?: string; result?: unknown; error?: unknown
  params?: { protocolVersion?: string; name?: string; capabilities?: { elicitation?: { form?: unknown } } } }

const send = (message: unknown) => process.stdout.write(JSON.stringify(message) + '\n')
const text = (id: number | string, value: string, isError = false) =>
  send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: value }], isError } })
const waiting = new Map<string, number | string>()
let canConfirm = false

for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line) as Message
  if (message.method === undefined) {
    // The client's answer to one of this server's requests.
    const call = typeof message.id === 'string' ? waiting.get(message.id) : undefined
    if (call !== undefined) text(call, JSON.stringify(message.error === undefined ? { result: message.result } : { error: message.error }))
    continue
  }
  if (message.id === undefined) continue
  if (message.method === 'initialize') {
    canConfirm = message.params?.capabilities?.elicitation?.form !== undefined
    send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: message.params?.protocolVersion,
      capabilities: { tools: {} }, serverInfo: { name: 'confirming', version: '1' } } })
  } else if (message.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: message.id, result: { tools: ['confirm', 'form'].map((name) => ({ name, inputSchema: { type: 'object' } })) } })
  } else if (message.method === 'tools/call') {
    if (!canConfirm) { text(message.id, 'The MCP client does not support form elicitation', true); continue }
    const request = `ask-${waiting.size + 1}`
    waiting.set(request, message.id)
    send({ jsonrpc: '2.0', id: request, method: 'elicitation/create', params: { mode: 'form', message: 'Allow the fixture to continue?',
      requestedSchema: { type: 'object', properties: message.params?.name === 'form' ? { count: { type: 'integer' } } : {} } } })
  } else send({ jsonrpc: '2.0', id: message.id, result: {} })
}

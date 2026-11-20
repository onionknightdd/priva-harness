// Stands in for a computer's desktop worker: the `js`, `js_reset` and `turn_ended` tools,
// answering with its process id so a test can tell one worker from the next.
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const log = process.env['WORKER_LOG']
const send = (message: unknown) => process.stdout.write(JSON.stringify(message) + '\n')
const tools = ['js', 'js_reset', 'turn_ended'].map((name) => ({ name, inputSchema: { type: 'object' } }))
let bindings = 0

for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line) as { id?: number | string; method?: string
    params?: { protocolVersion?: string; name?: string; arguments?: { code?: string } } }
  if (request.id === undefined || request.method === undefined) continue
  let result: unknown = {}
  if (request.method === 'initialize') result = { protocolVersion: request.params?.protocolVersion,
    capabilities: { tools: {} }, serverInfo: { name: 'desktop-worker', version: '1' } }
  if (request.method === 'tools/list') result = { tools }
  if (request.method === 'tools/call') {
    const name = request.params?.name
    if (log) appendFileSync(log, JSON.stringify({ pid: process.pid, tool: name, arguments: request.params?.arguments }) + '\n')
    if (name === 'js') bindings += 1
    if (name === 'js_reset') bindings = 0
    result = { content: [
      { type: 'text', text: JSON.stringify({ worker: process.pid, bindings, code: request.params?.arguments?.code }) },
      ...(name === 'js' ? [{ type: 'image', data: Buffer.from('fixture-image').toString('base64'), mimeType: 'image/png' }] : []),
    ] }
  }
  send({ jsonrpc: '2.0', id: request.id, result })
}

import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const [log, server] = process.argv.slice(2)
if (!log || !server) throw new Error('Expected a fixture log and server name')
const properties = Object.fromEntries(['hook_event_name', 'session_id', 'turn_id'].map((key) => [key, { type: 'string', minLength: 1 }]))
const tools = [{ name: 'turn_ended', description: 'Host lifecycle event', inputSchema: {
  type: 'object', properties, required: Object.keys(properties),
} }, { name: 'marker', description: 'Fixture marker', inputSchema: { type: 'object' } }]

for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line) as { id?: number; method: string; params?: {
    protocolVersion?: string; name?: string; arguments?: unknown
  } }
  if (request.id === undefined) continue
  appendFileSync(log, JSON.stringify({ server, pid: process.pid, method: request.method,
    tool: request.params?.name, input: request.params?.arguments }) + '\n', { mode: 0o600 })
  let result: unknown = {}
  if (request.method === 'initialize') result = { protocolVersion: request.params?.protocolVersion,
    capabilities: { tools: {} }, serverInfo: { name: server, version: '1' } }
  if (request.method === 'tools/list') result = { tools }
  if (request.method === 'tools/call') result = { content: [] }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n')
}
